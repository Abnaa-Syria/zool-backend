import { runtimeSettings } from '../../shared/settings/runtime-settings';
import {
  BrokerEmployeeRole,
  BrokerOfficeStatus,
  Prisma,
  type SettlementPeriod,
} from '@prisma/client';
import { getPrisma } from '../../infrastructure/database/prisma';
import { AppError } from '../../shared/errors/app-error';
import { setBrokerAuthzVersion } from '../../shared/security/broker-authz-cache';
import { normalizePhone } from '../../shared/utils/phone';
import { paginationMeta, parsePagination } from '../../shared/utils/pagination';
import { isIanaTimeZone } from '../../shared/utils/timezone';
import { auditService } from '../audit/audit.service';
import { toOfficeDetailDto, toOfficeDto } from './brokers.dto';
import { brokersRepository } from './brokers.repository';

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export class BrokersService {
  async list(query: {
    page?: number;
    pageSize?: number;
    status?: BrokerOfficeStatus;
    q?: string;
  }) {
    const { page, pageSize, skip, take } = parsePagination(query);
    const { items, total } = await brokersRepository.listOffices({
      skip,
      take,
      ...(query.status ? { status: query.status } : {}),
      ...(query.q ? { q: query.q } : {}),
    });
    return {
      items: items.map(toOfficeDto),
      meta: paginationMeta(page, pageSize, total),
    };
  }

  async getById(officeId: string) {
    const office = await brokersRepository.findOfficeById(officeId);
    if (!office) throw AppError.notFound('Broker office not found');
    return toOfficeDetailDto(office);
  }

  async create(input: {
    code: string;
    name: string;
    settlementPeriod?: SettlementPeriod;
    minTopUpMinorOverride?: number;
    exposureCeilingOverride?: number;
    lowBalanceThresholdMinorOverride?: number;
    timeZone?: string;
    manager?: { displayName: string; phone: string };
    actorAdminId: string;
    requestId?: string;
  }) {
    if (input.timeZone && !isIanaTimeZone(input.timeZone)) {
      throw AppError.validation('timeZone must be a valid IANA timezone');
    }

    const existingCode = await brokersRepository.findOfficeByCode(input.code);
    if (existingCode) throw AppError.conflict('Broker office code already exists');

    const managerPhone = input.manager ? normalizePhone(input.manager.phone) : null;
    if (managerPhone) {
      const existingIdentity = await brokersRepository.findIdentityByPhone(managerPhone);
      if (existingIdentity) throw AppError.conflict('Phone identity already registered');
    }

    try {
      const created = await getPrisma().$transaction(async (tx) => {
        const office = await brokersRepository.createOffice(
          {
            code: input.code,
            name: input.name,
            settlementPeriod:
              input.settlementPeriod ?? (runtimeSettings.get('settlement.defaultPeriod') as 'WEEKLY' | 'MONTHLY'),
            ...(input.minTopUpMinorOverride !== undefined
              ? { minTopUpMinorOverride: input.minTopUpMinorOverride }
              : {}),
            ...(input.exposureCeilingOverride !== undefined
              ? { exposureCeilingOverride: input.exposureCeilingOverride }
              : {}),
            ...(input.lowBalanceThresholdMinorOverride !== undefined
              ? { lowBalanceThresholdMinorOverride: input.lowBalanceThresholdMinorOverride }
              : {}),
            ...(input.timeZone !== undefined ? { timeZone: input.timeZone } : {}),
          },
          tx,
        );

        let manager: Awaited<ReturnType<typeof brokersRepository.createEmployee>> | null = null;
        if (input.manager && managerPhone) {
          manager = await brokersRepository.createEmployee(
            {
              officeId: office.id,
              displayName: input.manager.displayName,
              role: BrokerEmployeeRole.MANAGER,
              phoneNormalized: managerPhone,
              canBook: true,
              canTopUp: true,
              canViewReports: true,
              canManageStaff: true,
            },
            tx,
          );
        }

        await auditService.record(
          {
            actorAdminId: input.actorAdminId,
            action: 'broker.office.created',
            resourceType: 'broker_office',
            resourceId: office.id,
            requestId: input.requestId,
            metadata: {
              officeCode: office.code,
              settlementPeriod: office.settlementPeriod,
              managerEmployeeId: manager?.id ?? null,
            },
          },
          tx,
        );

        return { officeId: office.id, manager };
      });

      if (created.manager) {
        await setBrokerAuthzVersion(created.manager.id, created.manager.authzVersion);
      }

      return this.getById(created.officeId);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppError.conflict('Broker office code or phone identity already exists');
      }
      throw error;
    }
  }

  async replaceCarriers(input: {
    officeId: string;
    assignments: Array<{ companyId: string; commissionPercent: number }>;
    actorAdminId: string;
    requestId?: string;
  }) {
    const office = await brokersRepository.findOfficeById(input.officeId);
    if (!office) throw AppError.notFound('Broker office not found');

    const ids = input.assignments.map((a) => a.companyId);
    if (new Set(ids).size !== ids.length) {
      throw AppError.validation('Duplicate companyId in assignments');
    }
    if (ids.length > 0) {
      const companies = await brokersRepository.findCompaniesByIds(ids);
      if (companies.length !== ids.length) {
        throw AppError.validation('One or more transport companies do not exist');
      }
    }

    await getPrisma().$transaction(async (tx) => {
      await brokersRepository.replaceAssignments(input.officeId, input.assignments, tx);
      await auditService.record(
        {
          actorAdminId: input.actorAdminId,
          action: 'broker.office.carriers_replaced',
          resourceType: 'broker_office',
          resourceId: input.officeId,
          requestId: input.requestId,
          metadata: { assignments: input.assignments },
        },
        tx,
      );
    });

    return this.getById(input.officeId);
  }

  async updateStatus(input: {
    officeId: string;
    status: BrokerOfficeStatus;
    actorAdminId: string;
    requestId?: string;
  }) {
    const office = await brokersRepository.findOfficeById(input.officeId);
    if (!office) throw AppError.notFound('Broker office not found');

    await getPrisma().$transaction(async (tx) => {
      await brokersRepository.updateOfficeStatus(input.officeId, input.status, tx);
      if (input.status === BrokerOfficeStatus.SUSPENDED) {
        await brokersRepository.revokeSessionsForOffice(input.officeId, 'office_suspended', tx);
      }
      await auditService.record(
        {
          actorAdminId: input.actorAdminId,
          action: 'broker.office.status_changed',
          resourceType: 'broker_office',
          resourceId: input.officeId,
          requestId: input.requestId,
          metadata: { from: office.status, to: input.status },
        },
        tx,
      );
    });

    return this.getById(input.officeId);
  }

  async updatePolicy(input: {
    officeId: string;
    name?: string;
    settlementPeriod?: SettlementPeriod;
    minTopUpMinorOverride?: number | null;
    exposureCeilingOverride?: number | null;
    lowBalanceThresholdMinorOverride?: number | null;
    timeZone?: string | null;
    actorAdminId: string;
    requestId?: string;
  }) {
    const office = await brokersRepository.findOfficeById(input.officeId);
    if (!office) throw AppError.notFound('Broker office not found');
    if (input.timeZone && !isIanaTimeZone(input.timeZone)) {
      throw AppError.validation('timeZone must be a valid IANA timezone');
    }

    await getPrisma().$transaction(async (tx) => {
      await brokersRepository.updateOfficePolicy(
        input.officeId,
        {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.settlementPeriod !== undefined ? { settlementPeriod: input.settlementPeriod } : {}),
          ...(input.minTopUpMinorOverride !== undefined
            ? { minTopUpMinorOverride: input.minTopUpMinorOverride }
            : {}),
          ...(input.exposureCeilingOverride !== undefined
            ? { exposureCeilingOverride: input.exposureCeilingOverride }
            : {}),
          ...(input.lowBalanceThresholdMinorOverride !== undefined
            ? { lowBalanceThresholdMinorOverride: input.lowBalanceThresholdMinorOverride }
            : {}),
          ...(input.timeZone !== undefined ? { timeZone: input.timeZone } : {}),
        },
        tx,
      );
      await auditService.record(
        {
          actorAdminId: input.actorAdminId,
          action: 'broker.office.policy_updated',
          resourceType: 'broker_office',
          resourceId: input.officeId,
          requestId: input.requestId,
          metadata: {
            settlementPeriod: input.settlementPeriod,
            minTopUpMinorOverride: input.minTopUpMinorOverride,
            exposureCeilingOverride: input.exposureCeilingOverride,
            lowBalanceThresholdMinorOverride: input.lowBalanceThresholdMinorOverride,
            timeZone: input.timeZone,
          },
        },
        tx,
      );
    });

    return this.getById(input.officeId);
  }
}

export const brokersService = new BrokersService();
