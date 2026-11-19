import { env } from '../../config/env';
import { LocalDiskStorageProvider } from './local-disk-storage';
import type { StorageProvider } from './storage-provider';

let override: StorageProvider | null = null;
let cached: StorageProvider | null = null;

export function setStorageProvider(provider: StorageProvider | null): void {
  override = provider;
  cached = null;
}

export function getStorageProvider(): StorageProvider {
  if (override) return override;
  if (!cached) {
    cached = new LocalDiskStorageProvider(env().UPLOAD_DIR);
  }
  return cached;
}

export type { StorageProvider } from './storage-provider';
export { LocalDiskStorageProvider } from './local-disk-storage';
export {
  RECEIPT_MAX_BYTES,
  assertReceiptSize,
  checksumSha256,
  detectReceiptMime,
  newReceiptStorageKey,
} from './receipt-file';
