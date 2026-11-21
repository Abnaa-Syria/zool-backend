import { Prisma, TransportCompanyStatus, type TransportCompany } from '@prisma/client';
import { getPrisma } from '../../infrastructure/database/prisma';
import { AppError } from '../../shared/errors/app-error';
import { paginationMeta, parsePagination } from '../../shared/utils/pagination';
import { auditService } from '../audit/audit.service';
import { carriersRepository } from './carriers.repository';

type CompanyWithCount = TransportCompany & { _count?: { brokerAssignments: number } };

function toDto(company: CompanyWithCount) {
  return {
    id: company.id,
    key: company.key,
    name: company.name,
    status: company.status,
    createdAt: company.createdAt.toISOString(),
    ...('_count' in company && company._count
      ? { assignmentCount: company._count.brokerAssignments }
      : {}),
  };
}

function toDetailDto(company: TransportCompany & { _count: { brokerAssignments: number } }) {
  return {
    id: company.id,
    key: company.key,
    name: company.name,
    status: company.status,
    shortName: company.shortName,
    legalName: company.legalName,
    logoUrl: company.logoUrl,
    rating: { average: company.ratingAvgX100 / 100, count: company.ratingCount },
    cashEnabled: company.cashEnabled,
    suspendedAt: company.suspendedAt?.toISOString() ?? null,
    assignmentCount: company._count.brokerAssignments,
    createdAt: company.createdAt.toISOString(),
  };
}

export class CarriersService {
  async create(input: { key: string; name: string; actorAdminId: string; requestId?: string }) {
    const existing = await carriersRepository.findByKey(input.key);
    if (existing) throw AppError.conflict('Transport company key already exists');

    try {
      const company = await carriersRepository.create({ key: input.key, name: input.name });
      await auditService.record({
        actorAdminId: input.actorAdminId,
        action: 'carrier.created',
        resourceType: 'transport_company',
        resourceId: company.id,
        requestId: input.requestId,
        metadata: { key: company.key, name: company.name },
      });
      return toDto(company);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw AppError.conflict('Transport company key already exists');
      }
      throw error;
    }
  }

  async list(query: {
    page?: number;
    pageSize?: number;
    status?: TransportCompanyStatus;
    q?: string;
  }) {
    const { page, pageSize, skip, take } = parsePagination(query);
    const { items, total } = await carriersRepository.list({
      skip,
      take,
      ...(query.status ? { status: query.status } : {}),
      ...(query.q ? { q: query.q } : {}),
    });
    return {
      items: items.map(toDto),
      meta: paginationMeta(page, pageSize, total),
    };
  }

  async getById(companyId: string) {
    const company = await carriersRepository.findById(companyId);
    if (!company) throw AppError.notFound('Transport company not found');
    return toDetailDto(company);
  }

  /**
   * Administrative name/status only. Does not affect bookings, trips, holds,
   * assignments, tickets, or settlements (D-SUS-01 not locked for carriers).
   */
  async update(input: {
    companyId: string;
    name?: string;
    status?: TransportCompanyStatus;
    shortName?: string | null;
    legalName?: string | null;
    logoUrl?: string | null;
    cashEnabled?: boolean;
    actorAdminId: string;
    requestId?: string;
  }) {
    const existing = await carriersRepository.findById(input.companyId);
    if (!existing) throw AppError.notFound('Transport company not found');

    const nextStatus = input.status !== undefined ? input.status : existing.status;
    const statusChanged = nextStatus !== existing.status;
    const suspending = statusChanged && nextStatus === TransportCompanyStatus.SUSPENDED;
    const profile = {
      ...(input.name !== undefined && input.name !== existing.name ? { name: input.name } : {}),
      ...(input.shortName !== undefined ? { shortName: input.shortName } : {}),
      ...(input.legalName !== undefined ? { legalName: input.legalName } : {}),
      ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
      ...(input.cashEnabled !== undefined ? { cashEnabled: input.cashEnabled } : {}),
    };

    if (!statusChanged && Object.keys(profile).length === 0) {
      return toDetailDto(existing);
    }

    // D-SUS-01: suspension stops sales at once (search/holds/booking filter on ACTIVE carriers)
    // and frees every held seat. Confirmed bookings are NOT cancelled automatically: admins review
    // GET /carriers/:id/affected-trips and cancel trips with a full refund.
    const company = await getPrisma().$transaction(async (tx) => {
      const updated = await carriersRepository.update(
        input.companyId,
        {
          ...profile,
          ...(statusChanged ? { status: nextStatus, suspendedAt: suspending ? new Date() : null } : {}),
        },
        tx,
      );
      const releasedHolds = suspending ? await carriersRepository.releaseFutureHolds(input.companyId, tx) : 0;
      await auditService.record(
        {
          actorAdminId: input.actorAdminId,
          action: statusChanged ? 'carrier.status_changed' : 'carrier.updated',
          resourceType: 'transport_company',
          resourceId: updated.id,
          requestId: input.requestId,
          metadata: {
            before: { name: existing.name, status: existing.status },
            after: { name: updated.name, status: updated.status },
            fields: Object.keys(profile),
            ...(suspending ? { releasedHolds } : {}),
          },
        },
        tx,
      );
      return updated;
    });
    return toDetailDto(company);
  }

  /** D-SUS-01 review list: future trips of the carrier that still carry confirmed bookings. */
  async listAffectedTrips(companyId: string, query: { page?: number; pageSize?: number }) {
    const existing = await carriersRepository.findById(companyId);
    if (!existing) throw AppError.notFound('Transport company not found');
    const { page, pageSize, skip, take } = parsePagination(query);
    const { items, total } = await carriersRepository.listAffectedTrips(companyId, { skip, take });
    return {
      items: items.map((t) => ({
        tripId: t.id,
        tripNumber: t.tripNumber,
        origin: t.origin,
        destination: t.destination,
        departureAt: t.departureAt.toISOString(),
        status: t.status,
        confirmedBookings: t.bookings.length,
        ticketCount: t.bookings.reduce((n, b) => n + b._count.tickets, 0),
        totalAmountMinor: t.bookings.reduce((n, b) => n + b.totalAmount, 0),
        byChannel: {
          BROKER: t.bookings.filter((b) => b.channel === 'BROKER').length,
          DIRECT: t.bookings.filter((b) => b.channel === 'DIRECT').length,
        },
      })),
      meta: paginationMeta(page, pageSize, total),
    };
  }

  /** Broker view: only companies assigned to the office, with commission percent. */
  async listAssignedForOffice(officeId: string) {
    const assignments = await carriersRepository.listActiveAssignmentsForOffice(officeId);
    return assignments.map((a) => ({
      companyId: a.companyId,
      key: a.company.key,
      name: a.company.name,
      commissionPercent: Number(a.commissionPercent.toString()),
    }));
  }
}

export const carriersService = new CarriersService();
