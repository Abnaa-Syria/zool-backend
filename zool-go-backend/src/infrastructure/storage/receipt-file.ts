import { createHash, randomUUID } from 'node:crypto';
import { AppError } from '../../shared/errors/app-error';

export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;

export type ReceiptKind = 'application/pdf' | 'image/jpeg' | 'image/png';

export function detectReceiptMime(buf: Buffer): ReceiptKind {
  if (buf.length >= 4 && buf.subarray(0, 4).toString('utf8') === '%PDF') {
    return 'application/pdf';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length >= 8 && buf.subarray(0, 8).equals(png)) {
    return 'image/png';
  }
  throw AppError.validation('Receipt must be a PDF, JPEG or PNG file');
}

export function assertReceiptSize(buf: Buffer): void {
  if (buf.length === 0) throw AppError.validation('Receipt file is empty');
  if (buf.length > RECEIPT_MAX_BYTES) {
    throw AppError.validation(`Receipt exceeds ${RECEIPT_MAX_BYTES} bytes`);
  }
}

export function checksumSha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export function newReceiptStorageKey(): string {
  return `top-up-evidence/${randomUUID()}`;
}
