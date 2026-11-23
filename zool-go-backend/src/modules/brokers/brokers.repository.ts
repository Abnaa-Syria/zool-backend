import {
  BrokerEmployeeRole,
  BrokerEmployeeStatus,
  BrokerOfficeStatus,
  IdentityType,
  type Prisma,
  type SettlementPeriod,
} from '@prisma/client';
import { getPrisma, type PrismaTx } from '../../infrastructure/database/prisma';

function client(tx?: PrismaTx) {
  return tx ?? getPrisma();
}

export const officeListInclude = {
  wallet: true,
} satisfies Prisma.BrokerOfficeInclude;

export const officeDetailInclude = {
  wallet: true,
  employees: {
    include: { identities: true },
    orderBy: { createdAt: 'asc' },
  },
  carrierAssignments: {
    include: { company: true },
    orderBy: { company: { name: 'asc' } },
  },
} satisfies Prisma.BrokerOfficeInclude;

export const employeeInclude = {
  identities: true,
} satisfies Prisma.BrokerEmployeeInclude;

export type OfficeListRow = Prisma.BrokerOfficeGetPayload<{ include: typeof officeListInclude }>;
export type OfficeDetailRow = Prisma.BrokerOfficeGetPayload<{ include: typeof officeDetailInclude }>;
export type EmployeeRow = Prisma.BrokerEmployeeGetPayload<{ include: typeof employeeInclude }>;

export interface EmployeeCreateInput {
  officeId: string;
  displayName: string;
  role: BrokerEmployeeRole;
  phoneNormalized: string;
  canBook: boolean;
  canTopUp: boolean;
  canViewReports: boolean;
  canManageStaff: boolean;
}

export class BrokersRepository {
  async listOffices(params: {
    skip: number;
    take: number;
    status?: BrokerOfficeStatus;
    q?: string;
  }) {
    const where: Prisma.BrokerOfficeWhereInput = {
      ...(params.status ? { status: params.status } : {}),
      ...(params.q
        ? { OR: [{ code: { contains: params.q } }, { name: { contains: params.q } }] }
        : {}),
    };
    const [items, total] = await Promise.all([
      getPrisma().brokerOffice.findMany({
        where,
        include: officeListInclude,
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
      getPrisma().brokerOffice.count({ where }),
    ]);
    return { items, total };
  }

  findOfficeById(id: string, tx?: PrismaTx) {
    return client(tx).brokerOffice.findUnique({ where: { id }, include: officeDetailInclude });
  }

  findOfficeByCode(code: string) {
    return getPrisma().brokerOffice.findUnique({ where: { code } });
  }

  createOffice(
    data: {
      code: string;
      name: string;
      settlementPeriod: SettlementPeriod;
      minTopUpMinorOverride?: number;
      exposureCeilingOverride?: number;
      lowBalanceThresholdMinorOverride?: number;
      timeZone?: string;
    },
    tx: PrismaTx,
  ) {
    return tx.brokerOffice.create({
      data: {
        ...data,
        wallet: { create: { balance: 0 } },
      },
    });
  }

  createEmployee(input: EmployeeCreateInput, tx: PrismaTx) {
    return tx.brokerEmployee.create({
      data: {
        officeId: input.officeId,
        displayName: input.displayName,
        role: input.role,
        status: BrokerEmployeeStatus.ACTIVE,
        canBook: input.canBook,
        canTopUp: input.canTopUp,
        canViewReports: input.canViewReports,
        canManageStaff: input.canManageStaff,
        identities: {
          create: {
            type: IdentityType.PHONE,
            valueNormalized: input.phoneNormalized,
            isPrimary: true,
            verifiedAt: new Date(),
          },
        },
      },
      include: employeeInclude,
    });
  }

  findIdentityByPhone(phoneNormalized: string) {
    return getPrisma().brokerIdentity.findUnique({
      where: {
        type_valueNormalized: { type: IdentityType.PHONE, valueNormalized: phoneNormalized },
      },
    });
  }

  findCompaniesByIds(ids: string[]) {
    return getPrisma().transportCompany.findMany({ where: { id: { in: ids } } });
  }

  async replaceAssignments(
    officeId: string,
    assignments: Array<{ companyId: string; commissionPercent: number }>,
    tx: PrismaTx,
  ) {
    await tx.brokerCarrierAssignment.deleteMany({ where: { officeId } });
    if (assignments.length > 0) {
      await tx.brokerCarrierAssignment.createMany({
        data: assignments.map((a) => ({
          officeId,
          companyId: a.companyId,
          commissionPercent: a.commissionPercent,
        })),
      });
    }
  }

  updateOfficeStatus(id: string, status: BrokerOfficeStatus, tx: PrismaTx) {
    return tx.brokerOffice.update({ where: { id }, data: { status } });
  }

  updateOfficePolicy(
    id: string,
    data: {
      name?: string;
      settlementPeriod?: SettlementPeriod;
      minTopUpMinorOverride?: number | null;
      exposureCeilingOverride?: number | null;
      lowBalanceThresholdMinorOverride?: number | null;
      timeZone?: string | null;
    },
    tx: PrismaTx,
  ) {
    return tx.brokerOffice.update({ where: { id }, data });
  }

  employeeIdsForOffice(officeId: string, tx?: PrismaTx) {
    return client(tx).brokerEmployee.findMany({ where: { officeId }, select: { id: true } });
  }

  revokeSessionsForOffice(officeId: string, reason: string, tx: PrismaTx) {
    return tx.brokerRefreshSession.updateMany({
      where: { revokedAt: null, brokerEmployee: { officeId } },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }

  // ---- staff ----

  listEmployees(officeId: string) {
    return getPrisma().brokerEmployee.findMany({
      where: { officeId },
      include: employeeInclude,
      orderBy: { createdAt: 'asc' },
    });
  }

  findEmployeeInOffice(employeeId: string, officeId: string, tx?: PrismaTx) {
    return client(tx).brokerEmployee.findFirst({
      where: { id: employeeId, officeId },
      include: employeeInclude,
    });
  }

  updateEmployee(id: string, data: Prisma.BrokerEmployeeUpdateInput, tx: PrismaTx) {
    return tx.brokerEmployee.update({ where: { id }, data, include: employeeInclude });
  }

  revokeSessionsForEmployee(employeeId: string, reason: string, tx: PrismaTx) {
    return tx.brokerRefreshSession.updateMany({
      where: { brokerEmployeeId: employeeId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }
}

export const brokersRepository = new BrokersRepository();
