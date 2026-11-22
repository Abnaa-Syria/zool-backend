import { env } from '../../config/env';
import { getPrisma } from '../../infrastructure/database/prisma';
import { getRedis, redisKey } from '../../infrastructure/redis/redis';
import { AppError } from '../errors/app-error';
import { ErrorCodes } from '../errors/error-codes';
import { SYSTEM_SETTINGS, type SystemSettingDefinition, type SystemSettingKey } from '../constants/system-settings';

export type SettingValue = number | boolean | string;

const VERSION_KEY = () => redisKey('settings:version');
const FRESHNESS_MS = 5_000;

export const settingDefinitions = new Map<string, SystemSettingDefinition>(SYSTEM_SETTINGS.map((d) => [d.key, d]));

/**
 * D-SET-02 runtime settings snapshot. Hot paths (some inside money transactions) read
 * synchronously; `refreshIfStale()` runs per request and re-checks a Redis version counter at
 * most every 5 s, so an admin change reaches every instance within seconds. Missing rows fall
 * back to the `.env`-derived default, so behaviour without any stored row equals the env config.
 */
class RuntimeSettings {
  private values = new Map<string, SettingValue>();
  private loadedVersion: string | null = null;
  private lastCheck = 0;

  get(key: SystemSettingKey): SettingValue {
    if (this.values.has(key)) return this.values.get(key)!;
    return settingDefinitions.get(key)!.defaultValue(env());
  }

  number(key: SystemSettingKey): number {
    return Number(this.get(key));
  }

  boolean(key: SystemSettingKey): boolean {
    return this.get(key) === true;
  }

  async reload(): Promise<void> {
    const rows = await getPrisma().systemSetting.findMany();
    const next = new Map<string, SettingValue>();
    for (const row of rows) {
      if (settingDefinitions.has(row.key)) next.set(row.key, row.value as SettingValue);
    }
    this.values = next;
    try {
      this.loadedVersion = await getRedis().get(VERSION_KEY());
    } catch {
      this.loadedVersion = null;
    }
    this.lastCheck = Date.now();
  }

  async refreshIfStale(): Promise<void> {
    if (this.lastCheck !== 0 && Date.now() - this.lastCheck < FRESHNESS_MS) return;
    this.lastCheck = Date.now();
    let remote: string | null;
    try {
      remote = await getRedis().get(VERSION_KEY());
    } catch {
      return; // Redis unavailable: keep the last snapshot
    }
    if (remote !== this.loadedVersion || this.values.size === 0) await this.reload();
  }

  /** Call after writing settings: invalidates other instances and reloads this one. */
  async publishChange(): Promise<void> {
    try {
      await getRedis().incr(VERSION_KEY());
    } catch {
      // Other instances catch up once Redis is back.
    }
    await this.reload();
  }
}

export const runtimeSettings = new RuntimeSettings();

/** D-SET-02 `platform.maintenanceMode`: blocks new customer and broker holds/bookings (admin unaffected). */
export function assertNotInMaintenance(): void {
  if (runtimeSettings.boolean('platform.maintenanceMode')) {
    throw new AppError({
      statusCode: 503,
      code: ErrorCodes.PLATFORM_MAINTENANCE,
      message: 'Bookings are paused for maintenance; please try again later',
    });
  }
}
