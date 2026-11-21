export const PERMISSION_CATALOG = [
  { key: 'admins.view', module: 'admins', description: 'View administrators' },
  { key: 'admins.create', module: 'admins', description: 'Create administrators' },
  { key: 'admins.update', module: 'admins', description: 'Update administrators' },
  { key: 'admins.suspend', module: 'admins', description: 'Suspend or reactivate administrators' },
  { key: 'roles.view', module: 'roles', description: 'View roles' },
  { key: 'roles.create', module: 'roles', description: 'Create roles' },
  { key: 'roles.update', module: 'roles', description: 'Update roles' },
  { key: 'roles.assign', module: 'roles', description: 'Assign roles to administrators' },
  { key: 'roles.delete', module: 'roles', description: 'Delete non-system roles' },
  { key: 'permissions.view', module: 'permissions', description: 'View permission catalog' },
  { key: 'permissions.assign', module: 'permissions', description: 'Assign permissions to roles' },
  { key: 'sessions.view', module: 'sessions', description: 'View refresh sessions' },
  { key: 'sessions.revoke', module: 'sessions', description: 'Revoke refresh sessions' },
  { key: 'audit.view', module: 'audit', description: 'View audit logs' },
  { key: 'brokers.manage', module: 'brokers', description: 'Manage broker offices and assignments' },
  { key: 'brokers.view', module: 'brokers', description: 'View broker offices' },
  { key: 'carriers.manage', module: 'carriers', description: 'Manage transport companies' },
  { key: 'carriers.view', module: 'carriers', description: 'View transport companies' },
  { key: 'wallets.view', module: 'wallets', description: 'View broker wallets (admin)' },
  { key: 'wallets.topups.view', module: 'wallets', description: 'View broker top-up intents (admin)' },
  { key: 'wallets.topups.create_for_office', module: 'wallets', description: 'Initiate manual top-up fallback on behalf of an office' },
  { key: 'wallets.topups.review', module: 'wallets', description: 'View pending top-up review queue' },
  { key: 'wallets.topups.approve', module: 'wallets', description: 'Approve a pending top-up (credits intent amount only)' },
  { key: 'wallets.topups.reject', module: 'wallets', description: 'Reject a pending top-up' },
  { key: 'wallets.topups.evidence.view', module: 'wallets', description: 'Download top-up receipt evidence' },
  { key: 'commissions.payout', module: 'commissions', description: 'Finalize commission settlements' },
  { key: 'commissions.view', module: 'commissions', description: 'View broker commission accruals' },
  { key: 'catalog.view', module: 'catalog', description: 'View trips and seats (admin)' },
  { key: 'catalog.manage', module: 'catalog', description: 'Manage trips and seats (admin)' },
  { key: 'bookings.view', module: 'bookings', description: 'List and inspect bookings across offices' },
  { key: 'bookings.cancel', module: 'bookings', description: 'Cancel a booking as admin with a required reason' },
  { key: 'bookings.override', module: 'bookings', description: 'Reserved: booking override (unimplemented in M1)' },
  { key: 'geo.view', module: 'geo', description: 'View cities, stations and amenities' },
  { key: 'geo.manage', module: 'geo', description: 'Create and update cities, stations and amenities' },
  { key: 'fleet.view', module: 'fleet', description: 'View vehicles and drivers' },
  { key: 'fleet.manage', module: 'fleet', description: 'Create and update vehicles and drivers' },
] as const;

export type PermissionKey = (typeof PERMISSION_CATALOG)[number]['key'];

export const PERMISSION_KEYS: PermissionKey[] = PERMISSION_CATALOG.map((p) => p.key);

export function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSION_KEYS as string[]).includes(value);
}

export const SUPER_ADMIN_ROLE_KEY = 'super_admin';
