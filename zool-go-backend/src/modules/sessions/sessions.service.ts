import { getPrisma } from '../../infrastructure/database/prisma';
import { AppError } from '../../shared/errors/app-error';
import { invalidatePermissionCache, setAuthzVersion } from '../../shared/security/authz-cache';
import { paginationMeta, parsePagination } from '../../shared/utils/pagination';
import { auditService } from '../audit/audit.service';
import { authRepository } from '../auth/auth.repository';

export class SessionsService {
  async list(query: { page?: number; pageSize?: number; adminId?: string }) {
    const { page, pageSize, skip, take } = parsePagination(query);
    const where = {
      ...(query.adminId ? { adminUserId: query.adminId } : {}),
      revokedAt: null,
    };

    const [items, total] = await Promise.all([
      getPrisma().refreshSession.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          adminUserId: true,
          familyId: true,
          userAgent: true,
          ipAddress: true,
          expiresAt: true,
          createdAt: true,
          lastUsedAt: true,
          revokedAt: true,
        },
      }),
      getPrisma().refreshSession.count({ where }),
    ]);

    return {
      items: items.map((s) => ({
        id: s.id,
        adminUserId: s.adminUserId,
        familyId: s.familyId,
        userAgent: s.userAgent,
        ipAddress: s.ipAddress,
        expiresAt: s.expiresAt.toISOString(),
        createdAt: s.createdAt.toISOString(),
        lastUsedAt: s.lastUsedAt?.toISOString() ?? null,
        // Never expose tokenHash
      })),
      meta: paginationMeta(page, pageSize, total),
    };
  }

  async revoke(input: { sessionId: string; actorAdminId: string; requestId?: string }) {
    const session = await getPrisma().refreshSession.findUnique({ where: { id: input.sessionId } });
    if (!session) throw AppError.notFound('Session not found');
    if (session.revokedAt) {
      return { revoked: true };
    }

    await getPrisma().refreshSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), revokeReason: 'admin_revoke' },
    });

    const updated = await getPrisma().adminUser.update({
      where: { id: session.adminUserId },
      data: { authzVersion: { increment: 1 } },
    });
    await setAuthzVersion(session.adminUserId, updated.authzVersion);
    await invalidatePermissionCache(session.adminUserId);

    await auditService.record({
      actorAdminId: input.actorAdminId,
      action: 'session.revoked',
      resourceType: 'refresh_session',
      resourceId: session.id,
      requestId: input.requestId,
      metadata: { targetAdminId: session.adminUserId },
    });

    return { revoked: true };
  }

  /**
   * Revoke every active refresh session for a target admin (`sessions.revoke`).
   * Same invalidation path as suspend: refresh rows + authzVersion bump.
   * Does not suspend the account. Bootstrap OTP login remains available.
   */
  async revokeAllForAdmin(input: {
    adminId: string;
    actorAdminId: string;
    requestId?: string;
  }) {
    const admin = await getPrisma().adminUser.findUnique({
      where: { id: input.adminId },
      select: { id: true, authzVersion: true },
    });
    if (!admin) throw AppError.notFound('Admin not found');

    const result = await authRepository.revokeAllSessions(admin.id, 'admin_revoke_all');

    if (result.count === 0) {
      return { revokedCount: 0 };
    }

    const updated = await getPrisma().adminUser.update({
      where: { id: admin.id },
      data: { authzVersion: { increment: 1 } },
    });
    await setAuthzVersion(admin.id, updated.authzVersion);
    await invalidatePermissionCache(admin.id);

    await auditService.record({
      actorAdminId: input.actorAdminId,
      action: 'admin.sessions.revoked_all',
      resourceType: 'admin_user',
      resourceId: admin.id,
      requestId: input.requestId,
      metadata: { revokedCount: result.count },
    });

    return { revokedCount: result.count };
  }
}

export const sessionsService = new SessionsService();
