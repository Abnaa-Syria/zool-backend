import type { Prisma } from '@prisma/client';

/** Prisma Decimal(5,2) -> JS number (e.g. 10.00 -> 10). */
export function decimalToNumber(value: Prisma.Decimal | number | string): number {
  return Number(value.toString());
}

/**
 * Commission = floor(totalAmount * percent / 100), computed with integer
 * basis points to avoid floating point drift (percent has at most 2 decimals).
 */
export function computeCommission(totalAmount: number, percent: number): number {
  const basisPoints = Math.round(percent * 100);
  return Math.floor((totalAmount * basisPoints) / 10_000);
}

/** Natural ordering for seat labels: A1, A2, A10. */
export function compareSeatLabels(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/** Fare per ticket: a booking total split evenly; the remainder goes to the first seat (exact sum). */
export function splitFare(total: number, count: number): number[] {
  if (count === 0) return [];
  const base = Math.floor(total / count);
  return Array.from({ length: count }, (_, i) => (i === 0 ? total - base * (count - 1) : base));
}
