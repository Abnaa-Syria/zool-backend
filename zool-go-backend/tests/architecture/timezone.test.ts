import { describe, expect, it } from 'vitest';
import { officeDayBounds, zonedDayRange } from '../../src/shared/utils/timezone';

describe('zonedDayRange (date-only filters use Sudan calendar days)', () => {
  it('maps a Khartoum date (UTC+2) to the right UTC window', () => {
    const { from, to } = zonedDayRange('2026-11-22', 'Africa/Khartoum');
    expect(from.toISOString()).toBe('2026-11-21T22:00:00.000Z');
    expect(to.toISOString()).toBe('2026-11-22T22:00:00.000Z');
  });

  it('includes a 01:00 local departure in its own local day', () => {
    const departure = new Date('2026-11-21T23:00:00.000Z'); // 2026-11-22 01:00 in Khartoum
    const { from, to } = zonedDayRange('2026-11-22', 'Africa/Khartoum');
    expect(departure >= from && departure < to).toBe(true);
  });

  it('officeDayBounds agrees with zonedDayRange', () => {
    const now = new Date('2026-11-22T10:00:00.000Z');
    expect(officeDayBounds(now, 'Africa/Khartoum')).toEqual(zonedDayRange('2026-11-22', 'Africa/Khartoum'));
  });
});
