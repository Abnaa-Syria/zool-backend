import type { Prisma } from '@prisma/client';
import { getPrisma, type PrismaTx } from '../../infrastructure/database/prisma';
import type { AuditWriteInput } from './audit.types';

function client(tx?: PrismaTx) {
  return tx ?? getPrisma();
}

export class AuditRepository {
  async create(input: AuditWriteInput, tx?: PrismaTx) {
    return client(tx).auditLog.create({
      data: {
        actorAdminId: input.actorAdminId ?? null,
        actorType: input.actorType ?? null,
        actorId: input.actorId ?? null,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        requestId: input.requestId ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
      },
    });
  }

  async list(params: {
    skip: number;
    take: number;
    actorAdminId?: string;
    action?: string;
    resourceType?: string;
    resourceId?: string;
    requestId?: string;
    from?: Date;
    to?: Date;
  }) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (params.from) createdAt.gte = params.from;
    if (params.to) createdAt.lte = params.to;

    const where: Prisma.AuditLogWhereInput = {
      ...(params.actorAdminId ? { actorAdminId: params.actorAdminId } : {}),
      ...(params.action ? { action: params.action } : {}),
      ...(params.resourceType ? { resourceType: params.resourceType } : {}),
      ...(params.resourceId ? { resourceId: params.resourceId } : {}),
      ...(params.requestId ? { requestId: params.requestId } : {}),
      ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
    };

    const [items, total] = await Promise.all([
      getPrisma().auditLog.findMany({
        where,
        include: { actor: { select: { id: true, displayName: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: params.skip,
        take: params.take,
      }),
      getPrisma().auditLog.count({ where }),
    ]);

    return { items, total };
  }
}

export const auditRepository = new AuditRepository();
