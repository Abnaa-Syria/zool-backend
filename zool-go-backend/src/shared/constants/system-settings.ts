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
  maxLength?: number;
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
  // Customer cancellation (D-REF-02 engineering default: full refund until the cutoff; PO may set a fee)
  { key: 'refund.customerCutoffMinutesBeforeDeparture', type: 'integer', min: 0, max: 10080, description: 'Customers can cancel until this long before departure', defaultValue: () => 60 },
  { key: 'refund.customerFeeBasisPoints', type: 'integer', min: 0, max: 10000, description: 'Cancellation fee kept from customer refunds (basis points, 1000 = 10%)', defaultValue: () => 0 },
  // Booking changes (D-CHG-01)
  { key: 'change.cutoffMinutesBeforeDeparture', type: 'integer', min: 0, max: 10080, description: 'Trip changes close this long before departure', defaultValue: () => 360 },
  { key: 'change.maxChangesPerBooking', type: 'integer', min: 0, max: 10, description: 'Max trip changes per booking chain', defaultValue: () => 2 },
  { key: 'change.feeMinor', type: 'integer', min: 0, description: 'Fee per trip change (minor units)', defaultValue: () => 0 },
  // Apps (GET /public/app-config)
  { key: 'support.phone', type: 'string', maxLength: 32, description: 'Support phone shown in the apps', defaultValue: () => '' },
  { key: 'support.whatsapp', type: 'string', maxLength: 32, description: 'Support WhatsApp number shown in the apps', defaultValue: () => '' },
  { key: 'support.email', type: 'string', maxLength: 191, description: 'Support email shown in the apps', defaultValue: () => '' },
  { key: 'app.customer.minVersion', type: 'string', maxLength: 16, description: 'Oldest customer app version allowed (forces update)', defaultValue: () => '1.0.0' },
  { key: 'app.driver.minVersion', type: 'string', maxLength: 16, description: 'Oldest driver app version allowed (forces update)', defaultValue: () => '1.0.0' },
  { key: 'app.broker.minVersion', type: 'string', maxLength: 16, description: 'Oldest broker app version allowed (forces update)', defaultValue: () => '1.0.0' },
  // Security (login codes). Windows stay in .env (OTP_*_WINDOW_SECONDS); counts are editable here.
  { key: 'security.otpRequestsPerPhone', type: 'integer', min: 1, max: 10000, description: 'Login code requests allowed per phone per window', defaultValue: (e) => e.OTP_REQUEST_RATE_LIMIT_MAX },
  { key: 'security.otpVerifiesPerPhone', type: 'integer', min: 1, max: 10000, description: 'Login code checks allowed per phone per window', defaultValue: (e) => e.OTP_VERIFY_RATE_LIMIT_MAX },
  { key: 'security.otpRequestsPerIp', type: 'integer', min: 1, max: 100000, description: 'Login code requests per IP per window (mobile networks share IPs: keep it high)', defaultValue: (e) => Math.max(60, e.OTP_REQUEST_RATE_LIMIT_MAX) },
  { key: 'security.otpResendCooldownSeconds', type: 'integer', min: 1, max: 600, description: 'Wait before a new login code can be sent to the same phone', defaultValue: (e) => e.OTP_RESEND_COOLDOWN_SECONDS },
  { key: 'security.otpMaxAttempts', type: 'integer', min: 1, max: 20, description: 'Wrong codes before a login code is locked', defaultValue: (e) => e.OTP_MAX_ATTEMPTS },
  { key: 'security.couponAttemptsPerHour', type: 'integer', min: 1, max: 1000, description: 'Coupon codes a customer may try per hour (stops code guessing)', defaultValue: () => 20 },
  // Customer seat holds (anti-hoarding)
  { key: 'booking.customerMaxSeatsPerHold', type: 'integer', min: 1, max: 20, description: 'Max seats a customer can hold on one trip', defaultValue: () => 10 },
  { key: 'booking.customerMaxHeldSeats', type: 'integer', min: 1, max: 50, description: 'Max seats a customer can hold across all trips at once', defaultValue: () => 12 },
  // Driver operations
  { key: 'driver.boardingWindowMinutes', type: 'integer', min: 10, max: 1440, description: 'Drivers can open boarding this long before departure', defaultValue: () => 360 },
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
