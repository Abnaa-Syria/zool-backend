import { IdentityType, type Prisma } from '@prisma/client';
import { getPrisma, type PrismaTx } from '../../infrastructure/database/prisma';

const db = (tx?: PrismaTx) => tx ?? getPrisma();

export const employeeInclude = {
  company: { select: { id: true, key: true, name: true, shortName: true, logoUrl: true, status: true } },
  identities: { where: { type: IdentityType.PHONE }, orderBy: { isPrimary: 'desc' }, take: 1 },
} satisfies Prisma.CarrierEmployeeInclude;

export type CarrierEmployeeRow = Prisma.CarrierEmployeeGetPayload<{ include: typeof employeeInclude }>;

export const carrierPortalRepository = {
  findEmployee(id: string, tx?: PrismaTx) {
    return db(tx).carrierEmployee.findUnique({ where: { id }, include: employeeInclude });
  },

  listEmployees(companyId: string) {
    return getPrisma().carrierEmployee.findMany({ where: { companyId }, include: employeeInclude, orderBy: [{ role: 'asc' }, { createdAt: 'asc' }] });
  },

  findIdentityByPhone(phone: string, tx?: PrismaTx) {
    return db(tx).carrierIdentity.findUnique({ where: { type_valueNormalized: { type: IdentityType.PHONE, valueNormalized: phone } } });
  },

  createEmployee(
    data: { companyId: string; displayName: string; role: 'MANAGER' | 'STAFF'; phone: string; flags: { canManageFleet: boolean; canManageSchedule: boolean; canViewFinance: boolean; canManageStaff: boolean } },
    tx?: PrismaTx,
  ) {
    return db(tx).carrierEmployee.create({
      data: {
        companyId: data.companyId,
        displayName: data.displayName,
        role: data.role,
        ...data.flags,
        identities: { create: { type: IdentityType.PHONE, valueNormalized: data.phone, isPrimary: true, verifiedAt: new Date() } },
      },
      include: employeeInclude,
    });
  },

  updateEmployee(id: string, data: Prisma.CarrierEmployeeUpdateInput, tx?: PrismaTx) {
    return db(tx).carrierEmployee.update({ where: { id }, data, include: employeeInclude });
  },

  revokeSessions(employeeId: string, reason: string, tx?: PrismaTx) {
    return db(tx).carrierRefreshSession.updateMany({ where: { carrierEmployeeId: employeeId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: reason } });
  },

  countManagers(companyId: string) {
    return getPrisma().carrierEmployee.count({ where: { companyId, role: 'MANAGER', status: 'ACTIVE' } });
  },

  // ---- ownership checks (company scope)
  async vehicleCompany(id: string) {
    return (await getPrisma().vehicle.findUnique({ where: { id }, select: { companyId: true } }))?.companyId ?? null;
  },
  async driverCompany(id: string) {
    return (await getPrisma().driver.findUnique({ where: { id }, select: { companyId: true } }))?.companyId ?? null;
  },
  async routeCompany(id: string) {
    return (await getPrisma().route.findUnique({ where: { id }, select: { companyId: true } }))?.companyId ?? null;
  },
  async tripCompany(id: string) {
    return (await getPrisma().trip.findUnique({ where: { id }, select: { companyId: true } }))?.companyId ?? null;
  },

  assignedOffices(companyId: string) {
    return getPrisma().brokerCarrierAssignment.findMany({
      where: { companyId },
      include: { office: { select: { id: true, code: true, name: true, status: true } } },
      orderBy: { office: { name: 'asc' } },
    });
  },
};
