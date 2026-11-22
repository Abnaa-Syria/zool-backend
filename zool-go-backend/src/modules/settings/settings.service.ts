import type { Prisma } from '@prisma/client';
import { env } from '../../config/env';
import { getPrisma } from '../../infrastructure/database/prisma';
import { AppError } from '../../shared/errors/app-error';
import { SYSTEM_SETTINGS, type SystemSettingKey } from '../../shared/constants/system-settings';
import { runtimeSettings, settingDefinitions, type SettingValue } from '../../shared/settings/runtime-settings';
import { auditService } from '../audit/audit.service';

/** D-SET-02 admin API over `system_settings` (reads/writes go through runtimeSettings). */
export class SettingsService {
  async list() {
    await runtimeSettings.refreshIfStale();
    const rows = await getPrisma().systemSetting.findMany({
      include: { updatedByAdmin: { select: { id: true, displayName: true } } },
    });
    const e = env();
    return SYSTEM_SETTINGS.map((def) => {
      const row = rows.find((r) => r.key === def.key);
      return {
        key: def.key,
        type: def.type,
        description: def.description,
        value: (row?.value as SettingValue | undefined) ?? def.defaultValue(e),
        defaultValue: def.defaultValue(e),
        isDefault: !row,
        ...('min' in def ? { min: def.min } : {}),
        ...('max' in def ? { max: def.max } : {}),
        ...('options' in def ? { options: def.options } : {}),
        ...('maxLength' in def ? { maxLength: def.maxLength } : {}),
        updatedAt: row?.updatedAt.toISOString() ?? null,
        updatedBy: row?.updatedByAdmin ?? null,
      };
    });
  }

  private validate(key: string, value: unknown): SettingValue {
    const def = settingDefinitions.get(key);
    if (!def) throw AppError.validation('Unknown setting', { field: key });
    if (def.type === 'integer') {
      if (typeof value !== 'number' || !Number.isInteger(value)) throw AppError.validation('Expected an integer', { field: key });
      if (def.min !== undefined && value < def.min) throw AppError.validation(`Must be >= ${def.min}`, { field: key });
      if (def.max !== undefined && value > def.max) throw AppError.validation(`Must be <= ${def.max}`, { field: key });
      return value;
    }
    if (def.type === 'boolean') {
      if (typeof value !== 'boolean') throw AppError.validation('Expected a boolean', { field: key });
      return value;
    }
    if (typeof value !== 'string') throw AppError.validation('Expected a string', { field: key });
    if (def.maxLength !== undefined && value.length > def.maxLength) {
      throw AppError.validation(`At most ${def.maxLength} characters`, { field: key });
    }
    if (def.options && !def.options.includes(value)) {
      throw AppError.validation(`Must be one of ${def.options.join(', ')}`, { field: key });
    }
    return value;
  }

  /** Remove the stored override so the .env-derived default applies again. */
  async reset(input: { key: string; actorAdminId: string; requestId?: string }) {
    if (!settingDefinitions.has(input.key)) throw AppError.notFound('Unknown setting');
    const before = runtimeSettings.get(input.key as SystemSettingKey);
    await getPrisma().$transaction(async (tx) => {
      await tx.systemSetting.deleteMany({ where: { key: input.key } });
      await auditService.record(
        {
          actorAdminId: input.actorAdminId,
          action: 'settings.reset',
          resourceType: 'system_settings',
          resourceId: input.key,
          requestId: input.requestId,
          metadata: { key: input.key, before },
        },
        tx,
      );
    });
    await runtimeSettings.publishChange();
    return this.list();
  }

  async update(input: { values: Record<string, unknown>; actorAdminId: string; requestId?: string }) {
    const entries = Object.entries(input.values).map(([key, value]) => [key, this.validate(key, value)] as const);
    if (entries.length === 0) throw AppError.validation('No settings provided', { field: 'values' });

    await getPrisma().$transaction(async (tx) => {
      const before = await tx.systemSetting.findMany({ where: { key: { in: entries.map(([k]) => k) } } });
      for (const [key, value] of entries) {
        await tx.systemSetting.upsert({
          where: { key },
          create: { key, value: value as Prisma.InputJsonValue, updatedByAdminId: input.actorAdminId },
          update: { value: value as Prisma.InputJsonValue, updatedByAdminId: input.actorAdminId },
        });
      }
      await auditService.record(
        {
          actorAdminId: input.actorAdminId,
          action: 'settings.updated',
          resourceType: 'system_settings',
          requestId: input.requestId,
          metadata: {
            changes: entries.map(([key, value]) => ({
              key,
              before: (before.find((b) => b.key === key)?.value as SettingValue | undefined) ?? runtimeSettings.get(key as SystemSettingKey),
              after: value,
            })),
          },
        },
        tx,
      );
    });

    await runtimeSettings.publishChange();
    return this.list();
  }
}

export const settingsService = new SettingsService();
