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
