/** Offset of `timeZone` at `date`: local-as-UTC millis minus actual UTC millis. */
function offsetAt(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === '24' ? 0 : parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

export function calendarDateInZone(date: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return dtf.format(date);
}

/**
 * UTC bounds (inclusive start, exclusive end) of the local calendar day `ymd` (YYYY-MM-DD)
 * in `timeZone`. Use this for every date-only API filter: a Khartoum date is not a UTC date.
 */
export function zonedDayRange(ymd: string, timeZone: string): { from: Date; to: Date } {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const utcGuess = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const offset = offsetAt(utcGuess, timeZone);
  const from = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - offset);
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  return { from, to };
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses a `from`/`to` query bound. A date-only value (`YYYY-MM-DD`) is a calendar day in
 * `timeZone`: `from` → start of that day, `to` → start of the next day (use with `lt`).
 * Any other value is treated as an ISO instant.
 */
export function parseDateBound(
  value: string,
  bound: 'from' | 'to',
  timeZone: string,
): { date: Date; exclusive: boolean } {
  if (DATE_ONLY.test(value)) {
    const range = zonedDayRange(value, timeZone);
    return bound === 'from' ? { date: range.from, exclusive: false } : { date: range.to, exclusive: true };
  }
  return { date: new Date(value), exclusive: false };
}

/** Inclusive-start / exclusive-end bounds for the calendar day containing `now` in `timeZone`. */
export function officeDayBounds(now: Date, timeZone: string): { from: Date; to: Date } {
  return zonedDayRange(calendarDateInZone(now, timeZone), timeZone);
}

export function isIanaTimeZone(value: string): boolean {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** Short Arabic date-time in the platform zone for notification text, e.g. «28 نوفمبر، 15:00». */
export function formatPlatformDateTime(date: Date, timeZone: string): string {
  const day = new Intl.DateTimeFormat('ar-SD-u-nu-latn', { timeZone, day: 'numeric', month: 'long' }).format(date);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  return `${day}، ${time}`;
}
