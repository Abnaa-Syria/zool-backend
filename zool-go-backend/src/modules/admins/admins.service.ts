import { AdminStatus } from '@prisma/client';
import { getPrisma } from '../../infrastructure/database/prisma';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import {
  invalidatePermissionCache,
  setAuthzVersion,
} from '../../shared/security/authz-cache';
import { normalizePhone } from '../../shared/utils/phone';
import { paginationMeta, parsePagination } from '../../shared/utils/pagination';
import { auditService } from '../audit/audit.service';
import { authRepository } from '../auth/auth.repository';
import { adminsRepository } from './admins.repository';

function toDto(admin: NonNullable<Awaited<ReturnType<typeof adminsRepository.findById>>>) {
  return {
    id: admin.id,
    employeeCode: admin.employeeCode,
    displayName: admin.displayName,
    status: admin.status,
    isBootstrap: admin.isBootstrap,
    authzVersion: admin.authzVersion,
    lastLoginAt: admin.lastLoginAt?.toISOString() ?? null,
    createdAt: admin.createdAt.toISOString(),
    updatedAt: admin.updatedAt.toISOString(),
    identities: admin.identities.map((i) => ({
      type: i.type,
      value: i.valueNormalized,
      isPrimary: i.isPrimary,
    })),
    roles: admin.userRoles.map((ur) => ({
      id: ur.role.id,
      key: ur.role.key,
      name: ur.role.name,
    })),
  };
}

export class AdminsService {
  async list(query: { page?: number; pageSize?: number }) {
    const { page, pageSize, skip, take } = parsePagination(query);
    const [items, total] = await adminsRepository.list({ skip, take });
    return {
      items: items.map(toDto),
      meta: paginationMeta(page, pageSize, total),
    };
  }

  async getById(adminId: string) {
    const admin = await adminsRepository.findById(adminId);
    if (!admin) throw AppError.notFound('Admin not found');
    return toDto(admin);
  }

  async create(input: {
    displayName: string;
    employeeCode: string;
    phone: string;
    roleIds: string[];
    actorAdminId: string;
    requestId?: string;
  }) {
    const phone = normalizePhone(input.phone);
    const roles = await adminsRepository.findRolesByIds(input.roleIds);
    if (roles.length !== input.roleIds.length) {
      throw AppError.validation('One or more roles are invalid or inactive');
    }

    const existing = await authRepository.findActiveAdminByPhone(phone);
    if (existing) {
      throw AppError.conflict('Phone identity already registered');
    }

    try {
      const admin = await getPrisma().$transaction(async (tx) =>
        adminsRepository.create(
          {
            displayName: input.displayName,
            employeeCode: input.employeeCode,
            phoneNormalized: phone,
            roleIds: input.roleIds,
            assignedBy: input.actorAdminId,
          },
          tx,
        ),
      );

      await setAuthzVersion(admin.id, admin.authzVersion);
      await auditService.record({
        actorAdminId: input.actorAdminId,
        action: 'admin.created',
        resourceType: 'admin_user',
        resourceId: admin.id,
        requestId: input.requestId,
        metadata: { employeeCode: admin.employeeCode, roleIds: input.roleIds },
      });

      return toDto(admin);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'P2002') {
        throw AppError.conflict('Admin employee code or phone already exists');
      }
      throw error;
    }
  }

  async updateStatus(input: {
    adminId: string;
    status: 'ACTIVE' | 'SUSPENDED';
    actorAdminId: string;
    requestId?: string;
  }) {
    const admin = await adminsRepository.findById(input.adminId);
    if (!admin) throw AppError.notFound('Admin not found');

    if (admin.isBootstrap && input.status === 'SUSPENDED') {
      const activeBootstrap = await adminsRepository.countBootstrapAdmins();
      if (activeBootstrap <= 1) {
        throw new AppError({
          message: 'Cannot suspend the last active bootstrap Super Admin',
          statusCode: 409,
          code: ErrorCodes.BOOTSTRAP_PROTECTED,
        });
      }
    }

    if (admin.id === input.actorAdminId && input.status === 'SUSPENDED') {
      throw AppError.conflict('Cannot suspend your own account');
    }

    const updated = await adminsRepository.updateStatus(
      input.adminId,
      input.status === 'ACTIVE' ? AdminStatus.ACTIVE : AdminStatus.SUSPENDED,
    );

    await setAuthzVersion(updated.id, updated.authzVersion);
    await invalidatePermissionCache(updated.id);

    if (input.status === 'SUSPENDED') {
      await authRepository.revokeAllSessions(updated.id, 'admin_suspended');
    }

    await auditService.record({
      actorAdminId: input.actorAdminId,
      action: input.status === 'ACTIVE' ? 'admin.reactivated' : 'admin.suspended',
      resourceType: 'admin_user',
      resourceId: updated.id,
      requestId: input.requestId,
      metadata: { before: admin.status, after: updated.status },
    });

    return toDto(updated);
  }

  async setRoles(input: {
    adminId: string;
    roleIds: string[];
    actorAdminId: string;
    requestId?: string;
  }) {
    const admin = await adminsRepository.findById(input.adminId);
    if (!admin) throw AppError.notFound('Admin not found');

    const roles = await adminsRepository.findRolesByIds(input.roleIds);
    if (roles.length !== input.roleIds.length) {
      throw AppError.validation('One or more roles are invalid or inactive');
    }

    if (admin.isBootstrap) {
      const stillHasSystem = roles.some((r) => r.isSystem || r.key === 'super_admin');
      if (!stillHasSystem) {
        throw new AppError({
          message: 'Bootstrap Super Admin must retain the super_admin role',
          statusCode: 409,
          code: ErrorCodes.BOOTSTRAP_PROTECTED,
        });
      }
    }

    const updated = await getPrisma().$transaction(async (tx) =>
      adminsRepository.replaceRoles(input.adminId, input.roleIds, input.actorAdminId, tx),
    );

    await setAuthzVersion(updated.id, updated.authzVersion);
    await invalidatePermissionCache(updated.id);

    await auditService.record({
      actorAdminId: input.actorAdminId,
      action: 'admin.roles_updated',
      resourceType: 'admin_user',
      resourceId: updated.id,
      requestId: input.requestId,
      metadata: {
        before: admin.userRoles.map((ur) => ur.roleId),
        after: input.roleIds,
      },
    });

    return toDto(updated);
  }

  /**
   * Display name only (`admins.update`). Phone is self-service via
   * authenticated OTP and cannot be changed here, even by the actor.
   */
  async updateProfile(input: {
    adminId: string;
    displayName: string;
    actorAdminId: string;
    requestId?: string;
  }) {
    const admin = await adminsRepository.findById(input.adminId);
    if (!admin) throw AppError.notFound('Admin not found');

    if (input.displayName === admin.displayName) {
      return toDto(admin);
    }

    const updated = await adminsRepository.updateProfile(admin.id, {
      displayName: input.displayName,
    });

    await auditService.record({
      actorAdminId: input.actorAdminId,
      action: 'admin.updated',
      resourceType: 'admin_user',
      resourceId: updated.id,
      requestId: input.requestId,
      metadata: {
        before: { displayName: admin.displayName },
        after: { displayName: updated.displayName },
      },
    });

    return toDto(updated);
  }
}

export const adminsService = new AdminsService();
