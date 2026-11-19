import { env } from '../../config/env';

export type OfficePolicySource = {
  minTopUpMinorOverride: number | null;
  exposureCeilingOverride: number | null;
  lowBalanceThresholdMinorOverride: number | null;
  timeZone: string | null;
  settlementPeriod: 'WEEKLY' | 'MONTHLY';
};

export type ResolvedOfficePolicy = {
  minTopUpMinor: number;
  exposureCeiling: number;
  lowBalanceThresholdMinor: number;
  timeZone: string;
  settlementPeriod: 'WEEKLY' | 'MONTHLY';
};

export function resolveOfficePolicy(office: OfficePolicySource): ResolvedOfficePolicy {
  const cfg = env();
  return {
    minTopUpMinor: office.minTopUpMinorOverride ?? cfg.MIN_TOP_UP_AMOUNT,
    exposureCeiling: office.exposureCeilingOverride ?? cfg.DEFAULT_BOOKING_EXPOSURE_CEILING,
    lowBalanceThresholdMinor:
      office.lowBalanceThresholdMinorOverride ?? cfg.LOW_BALANCE_WARNING_THRESHOLD,
    timeZone: office.timeZone || cfg.PLATFORM_TIMEZONE,
    settlementPeriod: office.settlementPeriod,
  };
}
