import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { SYSTEM_SETTINGS, systemSettingDefaults } from '../../src/shared/constants/system-settings';
import { buildNumberedLayout, seatLayoutSchema } from '../../src/shared/utils/seat-layout';

describe('seat layout', () => {
  it('builds a 2+2 numbered bus with women-only seats', () => {
    const layout = buildNumberedLayout({ rows: 7, womenOnlyLabels: ['11', '12'] });
    expect(layout.seats).toHaveLength(28);
    expect(layout.aisleAfterColumn).toBe(2);
    expect(layout.seats[0]).toEqual({ label: '1', row: 1, column: 1, isWomenOnly: false });
    expect(layout.seats.filter((s) => s.isWomenOnly).map((s) => s.label)).toEqual(['11', '12']);
  });

  it('rejects duplicate labels, overlapping cells and seats outside the grid', () => {
    const base = { rows: 2, columns: 2, aisleAfterColumn: 1, driverSide: 'LEFT' as const };
    expect(
      seatLayoutSchema.safeParse({
        ...base,
        seats: [
          { label: '1', row: 1, column: 1 },
          { label: '1', row: 1, column: 2 },
        ],
      }).success,
    ).toBe(false);
    expect(
      seatLayoutSchema.safeParse({
        ...base,
        seats: [
          { label: '1', row: 1, column: 1 },
          { label: '2', row: 1, column: 1 },
        ],
      }).success,
    ).toBe(false);
    expect(seatLayoutSchema.safeParse({ ...base, seats: [{ label: '1', row: 3, column: 1 }] }).success).toBe(false);
  });
});

describe('system settings catalog (D-SET-02)', () => {
  const env = loadEnv(process.env);
  const defaults = systemSettingDefaults(env);

  it('has unique keys', () => {
    const keys = SYSTEM_SETTINGS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every default matches its declared type and bounds', () => {
    for (const def of SYSTEM_SETTINGS) {
      const value = defaults[def.key];
      if (def.type === 'integer') {
        expect(Number.isInteger(value), def.key).toBe(true);
        if ('min' in def && def.min !== undefined) expect(value as number, def.key).toBeGreaterThanOrEqual(def.min);
        if ('max' in def && def.max !== undefined) expect(value as number, def.key).toBeLessThanOrEqual(def.max);
      } else if (def.type === 'boolean') {
        expect(typeof value, def.key).toBe('boolean');
      } else {
        expect(typeof value, def.key).toBe('string');
        if ('options' in def && def.options) expect(def.options, def.key).toContain(value);
      }
    }
  });

  it('defaults that mirror .env keep the env value', () => {
    expect(defaults['booking.seatHoldTtlSeconds']).toBe(env.SEAT_HOLD_TTL_SECONDS);
    expect(defaults['wallet.minTopUpMinor']).toBe(env.MIN_TOP_UP_AMOUNT);
  });
});
