import { paginationMeta, parsePagination } from '../../shared/utils/pagination';
import { auditRepository } from './audit.repository';
import type { AuditWriteInput } from './audit.types';
import type { PrismaTx } from '../../infrastructure/database/prisma';

const SENSITIVE_KEYS = new Set([
  'otp',
  'devOtp',
  'code',
  'token',
  'refreshToken',
  'accessToken',
  'password',
  'secret',
  'authorization',
  'cookie',
  'codeHash',
  'tokenHash',
]);

function sanitizeMetadata(metadata?: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!metadata) return null;
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(key.toLowerCase())) {
      continue;
    }
    clean[key] = value;
  }
  return clean;
}

export class AuditService {
  async record(input: AuditWriteInput, tx?: PrismaTx) {
    return auditRepository.create(
      {
        ...input,
        metadata: sanitizeMetadata(input.metadata),
      },
      tx,
    );
  }

  async list(query: {
    page?: number;
    pageSize?: number;
    actorAdminId?: string;
    action?: string;
    resourceType?: string;
    resourceId?: string;
    requestId?: string;
    from?: string;
    to?: string;
  }) {
    const { page, pageSize, skip, take } = parsePagination(query);
    const { items, total } = await auditRepository.list({
      skip,
      take,
      ...(query.actorAdminId ? { actorAdminId: query.actorAdminId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.resourceType ? { resourceType: query.resourceType } : {}),
      ...(query.resourceId ? { resourceId: query.resourceId } : {}),
      ...(query.requestId ? { requestId: query.requestId } : {}),
      ...(query.from ? { from: new Date(query.from) } : {}),
      ...(query.to ? { to: new Date(query.to) } : {}),
    });

    return {
      items: items.map((item) => ({
        id: item.id,
        actorAdminId: item.actorAdminId,
        action: item.action,
        resourceType: item.resourceType,
        resourceId: item.resourceId,
        requestId: item.requestId,
        ipAddress: item.ipAddress,
        userAgent: item.userAgent,
        createdAt: item.createdAt.toISOString(),
        metadata: item.metadataJson ? (JSON.parse(item.metadataJson) as unknown) : null,
      })),
      meta: paginationMeta(page, pageSize, total),
    };
  }
}

export const auditService = new AuditService();
