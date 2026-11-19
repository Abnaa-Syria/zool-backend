import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../../shared/errors/app-error';
import type { StorageProvider } from './storage-provider';

const SAFE_KEY = /^[a-z0-9][a-z0-9/_-]*$/i;

export class LocalDiskStorageProvider implements StorageProvider {
  constructor(private readonly rootDir: string) {}

  private resolve(key: string): string {
    if (!SAFE_KEY.test(key) || key.includes('..') || path.isAbsolute(key)) {
      throw AppError.validation('Invalid storage key');
    }
    const resolved = path.resolve(this.rootDir, key);
    const root = path.resolve(this.rootDir);
    if (!resolved.startsWith(root + path.sep) && resolved !== root) {
      throw AppError.validation('Invalid storage key');
    }
    return resolved;
  }

  async put(params: { key: string; body: Buffer; contentType: string }): Promise<void> {
    const dest = this.resolve(params.key);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, params.body);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolve(key));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw error;
    }
  }
}
