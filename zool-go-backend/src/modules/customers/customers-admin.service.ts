import { BookingStatus, CustomerStatus, type Prisma } from '@prisma/client';
import { getPrisma } from '../../infrastructure/database/prisma';
import { AppError } from '../../shared/errors/app-error';
import { setPrincipalAuthzVersion } from '../../shared/security/principal-authz-cache';
import { paginationMeta, parsePagination } from '../../shared/utils/pagination';
import { auditService } from '../audit/audit.service';
import { customersAdminRepository, type CustomerRow } from './customers-admin.repository';

function toDto(c: CustomerRow) {
  return {
    id: c.id,
    displayName: c.displayName,
    phone: c.identities[0]?.valueNormalized ?? null,
    email: c.email,
    status: c.status,
    preferredLanguage: c.preferredLanguage,
    cashNoShowCount: c.cashNoShowCount,
    bookingsCount: c._count.bookings,
    lastLoginAt: c.lastLoginAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}

/** Admin support view of customer accounts (read, suspend, reset cash no-shows). */
export class CustomersAdminService {
  async list(query: { page?: number; pageSize?: number; q?: string; status?: CustomerStatus }) {
    const { page, pageSize, skip, take } = parsePagination(query);
    const q = query.q?.trim();
    const where: Prisma.CustomerWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(q
        ? {
            OR: [
              { displayName: { contains: q } },
              { email: { contains: q } },
              { identities: { some: { valueNormalized: { contains: q } } } },
            ],
          }
        : {}),
    };
    const { items, total } = await customersAdminRepository.list({ where, skip, take });
    return { items: items.map(toDto), meta: paginationMeta(page, pageSize, total) };
  }

  async get(id: string) {
    const c = await customersAdminRepository.findById(id);
    if (!c) throw AppError.notFound('Customer not found');
    const [confirmed, cancelled] = await Promise.all([
      customersAdminRepository.countBookings(id, BookingStatus.CONFIRMED),
      customersAdminRepository.countBookings(id, BookingStatus.CANCELLED),
    ]);
    return { ...toDto(c), bookings: { confirmed, cancelled } };
  }

  /** Suspension revokes every session and bumps authzVersion (tokens stop working at once). */
  async update(input: {
    customerId: string;
    status?: 'ACTIVE' | 'SUSPENDED';
    resetCashNoShows?: boolean;
    actorAdminId: string;
    requestId?: string;
  }) {
    const existing = await customersAdminRepository.findById(input.customerId);
    if (!existing) throw AppError.notFound('Customer not found');
    if (existing.status === CustomerStatus.DELETED) throw AppError.conflict('Deleted accounts cannot be changed');
    const suspending = input.status === 'SUSPENDED' && existing.status !== CustomerStatus.SUSPENDED;

    const updated = await getPrisma().$transaction(async (tx) => {
      if (suspending) await customersAdminRepository.revokeSessions(existing.id, 'customer_suspended', tx);
      const row = await customersAdminRepository.update(
        existing.id,
        {
          ...(input.status ? { status: input.status } : {}),
          ...(input.resetCashNoShows ? { cashNoShowCount: 0 } : {}),
          ...(suspending ? { authzVersion: { increment: 1 } } : {}),
        },
        tx,
      );
      await auditService.record(
        {
          actorAdminId: input.actorAdminId,
          action: suspending ? 'customer.suspended' : 'customer.updated',
          resourceType: 'customer',
          resourceId: existing.id,
          requestId: input.requestId,
          metadata: { status: input.status ?? null, resetCashNoShows: input.resetCashNoShows ?? false },
        },
        tx,
      );
      return row;
    });
    if (suspending) await setPrincipalAuthzVersion('customer', updated.id, updated.authzVersion);
    return this.get(updated.id);
  }
}

export const customersAdminService = new CustomersAdminService();
