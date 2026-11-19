import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacOtp(code: string, secret = env().OTP_HMAC_SECRET): string {
  return createHmac('sha256', secret).update(code).digest('hex');
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function generateOtp(length = env().OTP_LENGTH): string {
  const safeLength = Math.max(4, Math.min(8, length));
  const max = 10 ** safeLength;
  const n = randomBytes(4).readUInt32BE(0) % max;
  return n.toString().padStart(safeLength, '0');
}
