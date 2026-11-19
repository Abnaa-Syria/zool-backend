import {
  BrokerEmployeeRole,
  BrokerEmployeeStatus,
  Prisma,
} from '@prisma/client';
import { getPrisma } from '../../infrastructure/database/prisma';
import { AppError } from '../../shared/errors/app-error';
import { setBrokerAuthzVersion } from '../../shared/security/broker-authz-cache';
import { normalizePhone } from '../../shared/utils/phone';
import { auditService } from '../audit/audit.service';
import { toEmployeeDto } from '../brokers/brokers.dto';
import { brokersRepository } from '../brokers/brokers.repository';

export class BrokerStaffService {
  async list(officeId: string) {
    const employees = await brokersRepository.listEmployees(officeId);
    return employees.map(toEmployeeDto);
  }

  async createClerk(input: {
    officeId: string;
    actorEmployeeId?: string;
    actorAdminId?: string;
    displayName: string;
    phone: string;
    canBook: boolean;
    canTopUp: boolean;
    canViewReports: boolean;
    canManageStaff: boolean;
    requestId?: string;
  }) {
    const office = await brokersRepository.findOfficeById(input.officeId);
    if (!office) throw AppError.notFound('Broker office not found');

    const phone = normalizePhone(input.phone);
    const existing = await brokersRepository.findIdentityByPhone(phone);
    if (existing) throw AppError.conflict('Phone identity already registered');

    try {
      const employee = await getPrisma().$transaction(async (tx) => {
        const created = await brokersRepository.createEmployee(
          {
            officeId: input.officeId,
            displayName: input.displayName,
            role: BrokerEmployeeRole.CLERK,
            phoneNormalized: phone,
            canBook: input.canBook,
            canTopUp: input.canTopUp,
            canViewReports: input.canViewReports,
            canManageStaff: input.canManageStaff,
          },
          tx,
        );
        await auditService.record(
          {
            action: 'broker.staff.created',
            resourceType: 'broker_employee',
            resourceId: created.id,
            requestId: input.requestId,
            actorAdminId: input.actorAdminId ?? null,
            metadata: {
              officeId: input.officeId,
              actorEmployeeId: input.actorEmployeeId ?? null,
              actorAdminId: input.actorAdminId ?? null,
              role: created.role,
              canBook: created.canBook,
              canTopUp: created.canTopUp,
              canViewReports: created.canViewReports,
              canManageStaff: created.canManageStaff,
            },
          },
          tx,
        );
        return created;
      });

      await setBrokerAuthzVersion(employee.id, employee.authzVersion);
      return toEmployeeDto(employee);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw AppError.conflict('Phone identity already registered');
      }
      throw error;
    }
  }

  async update(input: {
    officeId: string;
    actorEmployeeId?: string;
    actorAdminId?: string;
    employeeId: string;
    changes: {
      displayName?: string;
      canBook?: boolean;
      canTopUp?: boolean;
      canViewReports?: boolean;
      canManageStaff?: boolean;
      status?: BrokerEmployeeStatus;
    };
    requestId?: string;
  }) {
    const office = await brokersRepository.findOfficeById(input.officeId);
    if (!office) throw AppError.notFound('Broker office not found');

    const target = await brokersRepository.findEmployeeInOffice(input.employeeId, input.officeId);
    if (!target) throw AppError.notFound('Employee not found');

    const { changes } = input;
    const isSelf = Boolean(input.actorEmployeeId) && target.id === input.actorEmployeeId;
    if (
      isSelf &&
      (changes.status === BrokerEmployeeStatus.SUSPENDED || changes.canManageStaff === false)
    ) {
      throw AppError.validation('You cannot suspend yourself or remove your own staff management');
    }

    const data: Prisma.BrokerEmployeeUpdateInput = {};
    if (changes.displayName !== undefined) data.displayName = changes.displayName;
    if (changes.canBook !== undefined) data.canBook = changes.canBook;
    if (changes.canTopUp !== undefined) data.canTopUp = changes.canTopUp;
    if (changes.canViewReports !== undefined) data.canViewReports = changes.canViewReports;
    if (changes.canManageStaff !== undefined) data.canManageStaff = changes.canManageStaff;
    if (changes.status !== undefined) data.status = changes.status;

    const authzSensitive =
      (changes.canBook !== undefined && changes.canBook !== target.canBook) ||
      (changes.canTopUp !== undefined && changes.canTopUp !== target.canTopUp) ||
      (changes.canViewReports !== undefined && changes.canViewReports !== target.canViewReports) ||
      (changes.canManageStaff !== undefined && changes.canManageStaff !== target.canManageStaff) ||
      (changes.status !== undefined && changes.status !== target.status);

    if (authzSensitive) {
      data.authzVersion = { increment: 1 };
    }

    const updated = await getPrisma().$transaction(async (tx) => {
      const row = await brokersRepository.updateEmployee(target.id, data, tx);
      if (changes.status === BrokerEmployeeStatus.SUSPENDED) {
        await brokersRepository.revokeSessionsForEmployee(target.id, 'employee_suspended', tx);
      }
      await auditService.record(
          {
            actorAdminId: input.actorAdminId ?? null,
            action: 'broker.staff.updated',
            resourceType: 'broker_employee',
            resourceId: target.id,
            requestId: input.requestId,
            metadata: {
              officeId: input.officeId,
              actorEmployeeId: input.actorEmployeeId ?? null,
              actorAdminId: input.actorAdminId ?? null,
              changes,
            },
          },
        tx,
      );
      return row;
    });

    if (authzSensitive) {
      await setBrokerAuthzVersion(updated.id, updated.authzVersion);
    }

    return toEmployeeDto(updated);
  }
}

export const brokerStaffService = new BrokerStaffService();
