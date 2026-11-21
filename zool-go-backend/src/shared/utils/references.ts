import { randomInt } from 'node:crypto';
import { calendarDateInZone } from './timezone';

/** Unambiguous alphabet (no 0/O, 1/I/L) — references are read aloud and typed by staff. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function randomCode(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/**
 * Human booking reference shown to staff and passengers, e.g. `BK-20261122-7Q4KMX`.
 * Date part is the Sudan calendar day; 31^6 ≈ 887M codes per day, guarded by the DB unique index.
 */
export function newBookingRef(timeZone: string, now = new Date()): string {
  return `BK-${calendarDateInZone(now, timeZone).replace(/-/g, '')}-${randomCode(6)}`;
}
