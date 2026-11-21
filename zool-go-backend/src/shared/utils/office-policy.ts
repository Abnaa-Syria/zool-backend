import { env } from '../../config/env';
import { runtimeSettings } from '../settings/runtime-settings';

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
    minTopUpMinor: office.minTopUpMinorOverride ?? runtimeSettings.number('wallet.minTopUpMinor'),
    exposureCeiling: office.exposureCeilingOverride ?? runtimeSettings.number('booking.defaultExposureCeiling'),
    lowBalanceThresholdMinor:
      office.lowBalanceThresholdMinorOverride ?? runtimeSettings.number('wallet.lowBalanceThresholdMinor'),
    timeZone: office.timeZone || cfg.PLATFORM_TIMEZONE,
    settlementPeriod: office.settlementPeriod,
  };
}
