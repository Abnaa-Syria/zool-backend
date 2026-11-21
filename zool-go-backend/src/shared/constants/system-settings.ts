import type { Env } from '../../config/env';

/**
 * D-SET-02: operational settings stored in `system_settings` and editable from the admin
 * dashboard. Secrets and infrastructure stay in `.env`. Each default comes from `.env`
 * (when an env var exists) so a fresh database behaves exactly like the configured env.
 */
export type SystemSettingDefinition = {
  key: string;
  type: 'integer' | 'boolean' | 'string';
  description: string;
  defaultValue: (env: Env) => number | boolean | string;
  min?: number;
  max?: number;
  options?: readonly string[];
};

export const SYSTEM_SETTINGS = [
  // Booking & holds
  { key: 'booking.seatHoldTtlSeconds', type: 'integer', min: 60, max: 3600, description: 'Seat hold lifetime', defaultValue: (e) => e.SEAT_HOLD_TTL_SECONDS },
  { key: 'booking.defaultExposureCeiling', type: 'integer', min: 1, description: 'Default daily booking cap per broker office', defaultValue: (e) => e.DEFAULT_BOOKING_EXPOSURE_CEILING },
  // Wallet
  { key: 'wallet.minTopUpMinor', type: 'integer', min: 1, description: 'Minimum broker top-up (minor units)', defaultValue: (e) => e.MIN_TOP_UP_AMOUNT },
  { key: 'wallet.lowBalanceThresholdMinor', type: 'integer', min: 0, description: 'Low-balance warning threshold (minor units)', defaultValue: (e) => e.LOW_BALANCE_WARNING_THRESHOLD },
  { key: 'settlement.defaultPeriod', type: 'string', options: ['WEEKLY', 'MONTHLY'], description: 'Default commission settlement period for new offices', defaultValue: (e) => e.DEFAULT_SETTLEMENT_PERIOD },
  // Online payment (D-PAY-01)
  { key: 'payment.onlineIntentTtlSeconds', type: 'integer', min: 120, max: 3600, description: 'Time to complete an online payment before seats are released', defaultValue: () => 900 },
  // Cash to driver (D-CASH-01)
  { key: 'cash.enabled', type: 'boolean', description: 'Allow cash-on-board payment platform-wide', defaultValue: () => true },
  { key: 'cash.maxSeatsPerBooking', type: 'integer', min: 1, max: 10, description: 'Max seats in one cash booking', defaultValue: () => 4 },
  { key: 'cash.maxOpenBookingsPerCustomer', type: 'integer', min: 1, max: 10, description: 'Max unpaid cash bookings a customer may hold', defaultValue: () => 2 },
  { key: 'cash.cutoffMinutesBeforeDeparture', type: 'integer', min: 0, max: 1440, description: 'Cash checkout closes this long before departure', defaultValue: () => 60 },
  { key: 'cash.noShowLimit', type: 'integer', min: 1, max: 10, description: 'Cash no-shows after which a customer loses cash eligibility', defaultValue: () => 2 },
  // Booking changes (D-CHG-01)
  { key: 'change.cutoffMinutesBeforeDeparture', type: 'integer', min: 0, max: 10080, description: 'Trip changes close this long before departure', defaultValue: () => 360 },
  { key: 'change.maxChangesPerBooking', type: 'integer', min: 0, max: 10, description: 'Max trip changes per booking chain', defaultValue: () => 2 },
  { key: 'change.feeMinor', type: 'integer', min: 0, description: 'Fee per trip change (minor units)', defaultValue: () => 0 },
  // Platform
  { key: 'platform.maintenanceMode', type: 'boolean', description: 'Block customer and broker bookings (admin still works)', defaultValue: () => false },
] as const satisfies readonly SystemSettingDefinition[];

export type SystemSettingKey = (typeof SYSTEM_SETTINGS)[number]['key'];

export function systemSettingDefaults(env: Env): Record<SystemSettingKey, number | boolean | string> {
  return Object.fromEntries(SYSTEM_SETTINGS.map((s) => [s.key, s.defaultValue(env)])) as Record<
    SystemSettingKey,
    number | boolean | string
  >;
}
