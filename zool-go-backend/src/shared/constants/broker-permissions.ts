export const BROKER_PERMISSION_KEYS = [
  'broker.book',
  'broker.wallet.topup',
  'broker.reports.view',
  'broker.staff.manage',
] as const;

export type BrokerPermissionKey = (typeof BROKER_PERMISSION_KEYS)[number];

export interface BrokerEmployeeFlags {
  canBook: boolean;
  canTopUp: boolean;
  canViewReports: boolean;
  canManageStaff: boolean;
}

export function isBrokerPermissionKey(value: string): value is BrokerPermissionKey {
  return (BROKER_PERMISSION_KEYS as readonly string[]).includes(value);
}

/** Derive effective broker permissions from the employee capability flags. */
export function brokerPermissionsFromFlags(flags: BrokerEmployeeFlags): BrokerPermissionKey[] {
  const permissions: BrokerPermissionKey[] = [];
  if (flags.canBook) permissions.push('broker.book');
  if (flags.canTopUp) permissions.push('broker.wallet.topup');
  if (flags.canViewReports) permissions.push('broker.reports.view');
  if (flags.canManageStaff) permissions.push('broker.staff.manage');
  return permissions;
}

export function brokerFlagsFromPermissions(permissions: readonly string[]): BrokerEmployeeFlags {
  return {
    canBook: permissions.includes('broker.book'),
    canTopUp: permissions.includes('broker.wallet.topup'),
    canViewReports: permissions.includes('broker.reports.view'),
    canManageStaff: permissions.includes('broker.staff.manage'),
  };
}
