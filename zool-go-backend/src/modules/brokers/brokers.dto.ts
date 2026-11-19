import {
  brokerPermissionsFromFlags,
  type BrokerEmployeeFlags,
} from '../../shared/constants/broker-permissions';
import type { EmployeeRow, OfficeDetailRow, OfficeListRow } from './brokers.repository';

export interface EmployeeDto {
  id: string;
  officeId: string;
  displayName: string;
  role: 'MANAGER' | 'CLERK';
  status: string;
  phone: string | null;
  flags: BrokerEmployeeFlags;
  permissions: string[];
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toEmployeeDto(employee: EmployeeRow): EmployeeDto {
  const flags: BrokerEmployeeFlags = {
    canBook: employee.canBook,
    canTopUp: employee.canTopUp,
    canViewReports: employee.canViewReports,
    canManageStaff: employee.canManageStaff,
  };
  const primary =
    employee.identities.find((i) => i.type === 'PHONE' && i.isPrimary) ??
    employee.identities.find((i) => i.type === 'PHONE');
  return {
    id: employee.id,
    officeId: employee.officeId,
    displayName: employee.displayName,
    role: employee.role,
    status: employee.status,
    phone: primary?.valueNormalized ?? null,
    flags,
    permissions: brokerPermissionsFromFlags(flags),
    lastLoginAt: employee.lastLoginAt?.toISOString() ?? null,
    createdAt: employee.createdAt.toISOString(),
    updatedAt: employee.updatedAt.toISOString(),
  };
}

export function toOfficeDto(office: OfficeListRow) {
  return {
    id: office.id,
    code: office.code,
    name: office.name,
    status: office.status,
    settlementPeriod: office.settlementPeriod,
    minTopUpMinorOverride: office.minTopUpMinorOverride,
    exposureCeilingOverride: office.exposureCeilingOverride,
    lowBalanceThresholdMinorOverride: office.lowBalanceThresholdMinorOverride,
    timeZone: office.timeZone,
    lastSettledAt: office.lastSettledAt?.toISOString() ?? null,
    wallet: office.wallet
      ? {
          id: office.wallet.id,
          balanceMinor: office.wallet.balance,
          currency: office.wallet.currency,
        }
      : null,
    createdAt: office.createdAt.toISOString(),
    updatedAt: office.updatedAt.toISOString(),
  };
}

export function toOfficeDetailDto(office: OfficeDetailRow) {
  return {
    ...toOfficeDto(office),
    employees: office.employees.map(toEmployeeDto),
    carrierAssignments: office.carrierAssignments.map((a) => ({
      id: a.id,
      companyId: a.companyId,
      companyKey: a.company.key,
      companyName: a.company.name,
      commissionPercent: Number(a.commissionPercent.toString()),
    })),
  };
}
