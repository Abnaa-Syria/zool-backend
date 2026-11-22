/** D-CARRIER-PORTAL-01 permissions. Every carrier employee can view dashboard, bookings, manifests and tracking. */
export const CARRIER_PERMISSIONS = ['carrier.fleet', 'carrier.schedule', 'carrier.finance', 'carrier.staff'] as const;
export type CarrierPermission = (typeof CARRIER_PERMISSIONS)[number];

export interface CarrierEmployeeFlags {
  canManageFleet: boolean;
  canManageSchedule: boolean;
  canViewFinance: boolean;
  canManageStaff: boolean;
}

export function carrierPermissions(e: CarrierEmployeeFlags & { role: 'MANAGER' | 'STAFF' }): CarrierPermission[] {
  if (e.role === 'MANAGER') return [...CARRIER_PERMISSIONS];
  return [
    ...(e.canManageFleet ? (['carrier.fleet'] as const) : []),
    ...(e.canManageSchedule ? (['carrier.schedule'] as const) : []),
    ...(e.canViewFinance ? (['carrier.finance'] as const) : []),
    ...(e.canManageStaff ? (['carrier.staff'] as const) : []),
  ];
}
