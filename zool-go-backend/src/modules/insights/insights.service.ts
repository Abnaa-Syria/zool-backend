import { CommissionAccrualStatus } from '@prisma/client';
import { env } from '../../config/env';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import { runtimeSettings } from '../../shared/settings/runtime-settings';
import { parseDateBound } from '../../shared/utils/timezone';
import { insightsRepository, type Scope } from './insights.repository';

const MAX_RANGE_DAYS = 92;

/** `from`/`to` are Sudan days or ISO instants (API_CONVENTIONS §6). */
export function resolveRange(input: { from?: string; to?: string }, opts: { required: boolean; defaultDays?: number }) {
  const tz = env().PLATFORM_TIMEZONE;
  if (opts.required && (!input.from || !input.to)) {
    throw AppError.validation('from and to are required', { field: input.from ? 'to' : 'from' });
  }
  const to = input.to ? parseDateBound(input.to, 'to', tz).date : new Date();
  const from = input.from
    ? parseDateBound(input.from, 'from', tz).date
    : new Date(to.getTime() - (opts.defaultDays ?? 30) * 86_400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw AppError.validation('Invalid date', { field: 'from' });
  if (from >= to) throw AppError.validation('from must be before to', { field: 'from' });
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) {
    throw new AppError({
      statusCode: 422,
      code: ErrorCodes.RANGE_TOO_LARGE,
      message: `Range is limited to ${MAX_RANGE_DAYS} days`,
      details: { maxDays: MAX_RANGE_DAYS },
    });
  }
  return { from, to };
}

export class InsightsService {
  /**
   * REQ-ADM-10 overview KPIs. Sections follow the caller's permissions: bookings always
   * (route requires bookings.view), wallets with wallets.view, commissions with commissions.view.
   */
  async overview(query: { from?: string; to?: string }, permissions: string[]) {
    const range = resolveRange(query, { required: false, defaultDays: 1 });
    const scope: Scope = range;
    const can = (p: string) => permissions.includes(p);

    const bookings = await insightsRepository.confirmedBookings(scope);
    const cancelled = await insightsRepository.cancelledBookings(scope);
    const result: Record<string, unknown> = {
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      currency: 'SDG',
      bookingsCount: bookings.count,
      bookingsAmountMinor: bookings.amount,
      cancelledCount: cancelled.count,
    };
    if (can('wallets.view')) {
      result.walletsBalanceMinor = await insightsRepository.walletsBalance();
      result.lowBalanceOfficesCount = await insightsRepository.lowBalanceOfficesCount(
        runtimeSettings.number('wallet.lowBalanceThresholdMinor'),
      );
    }
    if (can('wallets.topups.view') || can('wallets.topups.review')) {
      result.pendingTopUpsCount = await insightsRepository.pendingTopUpsCount();
    }
    if (can('commissions.view')) {
      result.unsettledCommissionMinor = await insightsRepository.unsettledCommissionTotal();
      result.draftSettlementsCount = await insightsRepository.draftSettlementsCount();
    }
    return result;
  }

  /** REQ-ADM-09 summary for a required window (≤ 92 days), optionally per office / carrier. */
  async summary(query: { from?: string; to?: string; officeId?: string; companyId?: string }) {
    const range = resolveRange(query, { required: true });
    const scope: Scope = { ...range, officeId: query.officeId, companyId: query.companyId };
    const [bookings, cancelled, unsettled, settled, wallets] = await Promise.all([
      insightsRepository.confirmedBookings(scope),
      insightsRepository.cancelledBookings(scope),
      insightsRepository.commissionByStatus(scope, CommissionAccrualStatus.UNSETTLED),
      insightsRepository.commissionByStatus(scope, CommissionAccrualStatus.SETTLED),
      insightsRepository.walletsBalance(query.officeId),
    ]);
    return {
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      filters: { officeId: query.officeId ?? null, companyId: query.companyId ?? null },
      bookingsCount: bookings.count,
      bookingsAmountMinor: bookings.amount,
      cancelledCount: cancelled.count,
      refundedAmountMinor: cancelled.amount,
      unsettledCommissionMinor: unsettled,
      settledCommissionMinor: settled,
      walletsBalanceMinor: wallets,
      currency: 'SDG' as const,
    };
  }

  async byOffice(query: { from?: string; to?: string; companyId?: string }) {
    const range = resolveRange(query, { required: true });
    return insightsRepository.byOffice({ ...range, companyId: query.companyId });
  }

  async byCarrier(query: { from?: string; to?: string; officeId?: string }) {
    const range = resolveRange(query, { required: true });
    return insightsRepository.byCarrier({ ...range, officeId: query.officeId });
  }
}

export const insightsService = new InsightsService();
