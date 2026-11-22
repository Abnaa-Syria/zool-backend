import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';

/**
 * Server-signed ticket QR payload (SCREEN_API_MAP §1 "My Ticket"): `ZG1.<ticketNumber>.<tripId>.<sig>`.
 * The driver app sends it back to `POST /driver/trips/:id/scan`; the server verifies the HMAC, so a
 * forged or edited code is rejected without any lookup. The key is derived from JWT_ACCESS_SECRET
 * with a fixed label, so it needs no extra secret yet is never the JWT key itself.
 */
const PREFIX = 'ZG1';

function key(): Buffer {
  return createHmac('sha256', env().JWT_ACCESS_SECRET).update('zoolgo:ticket-qr:v1').digest();
}

function sign(body: string): string {
  return createHmac('sha256', key()).update(body).digest('base64url').slice(0, 22);
}

export function ticketQrPayload(ticketNumber: string, tripId: string): string {
  const body = `${PREFIX}.${ticketNumber}.${tripId}`;
  return `${body}.${sign(body)}`;
}

/** Returns the ticket and trip the code was issued for, or null when the code is not genuine. */
export function verifyTicketQr(code: string): { ticketNumber: string; tripId: string } | null {
  const parts = code.trim().split('.');
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;
  const [, ticketNumber, tripId, sig] = parts as [string, string, string, string];
  const expected = Buffer.from(sign(`${PREFIX}.${ticketNumber}.${tripId}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { ticketNumber, tripId };
}
