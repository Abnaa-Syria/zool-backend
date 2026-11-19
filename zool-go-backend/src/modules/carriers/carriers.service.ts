import { Prisma, type TransportCompany, type TransportCompanyStatus } from '@prisma/client';
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
    actorAdminId: string;
    requestId?: string;
  }) {
    const existing = await carriersRepository.findById(input.companyId);
    if (!existing) throw AppError.notFound('Transport company not found');

    const nextName = input.name !== undefined ? input.name : existing.name;
    const nextStatus = input.status !== undefined ? input.status : existing.status;
    const nameChanged = nextName !== existing.name;
    const statusChanged = nextStatus !== existing.status;

    if (!nameChanged && !statusChanged) {
      return toDetailDto(existing);
    }

    const company = await carriersRepository.update(input.companyId, {
      ...(nameChanged ? { name: nextName } : {}),
      ...(statusChanged ? { status: nextStatus } : {}),
    });

    await auditService.record({
      actorAdminId: input.actorAdminId,
      action: statusChanged ? 'carrier.status_changed' : 'carrier.updated',
      resourceType: 'transport_company',
      resourceId: company.id,
      requestId: input.requestId,
      metadata: {
        before: { name: existing.name, status: existing.status },
        after: { name: company.name, status: company.status },
      },
    });
    return toDetailDto(company);
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
