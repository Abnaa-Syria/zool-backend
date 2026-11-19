import { AppError } from '../errors/app-error';

const SUDAN_COUNTRY_CODE = '249';

/**
 * Normalize Sudan phone numbers to E.164 (+249XXXXXXXXX).
 * Accepts: +2499..., 2499..., 09..., 9...
 */
export function normalizeSudanPhone(input: string): string {
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw AppError.validation('Phone number is required', { field: 'phone' });
  }

  let digits = input.trim().replace(/[\s\-().]/g, '');

  if (digits.startsWith('+')) {
    digits = digits.slice(1);
  }

  if (!/^\d+$/.test(digits)) {
    throw AppError.validation('Phone number must contain only digits', { field: 'phone' });
  }

  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  if (digits.startsWith('0') && digits.length === 10) {
    digits = `${SUDAN_COUNTRY_CODE}${digits.slice(1)}`;
  } else if (digits.length === 9 && digits.startsWith('9')) {
    digits = `${SUDAN_COUNTRY_CODE}${digits}`;
  } else if (digits.startsWith(SUDAN_COUNTRY_CODE)) {
    // already country-coded
  } else {
    throw AppError.validation('Unsupported Sudan phone format', { field: 'phone', value: input });
  }

  if (!new RegExp(`^${SUDAN_COUNTRY_CODE}\\d{9}$`).test(digits)) {
    throw AppError.validation('Sudan phone must be +249 followed by 9 digits', {
      field: 'phone',
      value: input,
    });
  }

  return `+${digits}`;
}

/** Alias used by auth/admins modules. */
export function normalizePhone(input: string): string {
  return normalizeSudanPhone(input);
}

export function isSudanE164(phone: string): boolean {
  return /^\+249\d{9}$/.test(phone);
}
