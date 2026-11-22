import {
  BookingChannel,
  BookingPaymentMethod,
  BookingStatus,
  CarrierSettlementStatus,
  CommissionAccrualStatus,
  CommissionBearer,
  PlatformFeeType,
  Prisma,
  RefundReason,
  TicketStatus,
  TripStatus,
} from '@prisma/client';
import { env } from '../../config/env';
import { getPrisma } from '../../infrastructure/database/prisma';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import { paginationMeta, parsePagination } from '../../shared/utils/pagination';
import { zonedDayRange } from '../../shared/utils/timezone';
import { auditService } from '../audit/audit.service';

export type FeeConfig = { feeType: PlatformFeeType; feeValue: number; commissionBearer: CommissionBearer };

type TripLine = {
  tripId: string;
  tripNumber: string | null;
  departureAt: string;
  tickets: number;
  onlineMinor: number;
  brokerMinor: number;
  cashMinor: number;
  refundsMinor: number;
  platformDiscountMinor: number;
  platformFeeMinor: number;
  brokerCommissionMinor: number;
};

/**
 * D-REV-02 carrier statement over trips that departed in [from, to) (cancelled trips excluded).
 * Money is counted where it really is:
 * - online (direct) payments and broker wallet sales are held by the platform;
 * - cash collected by drivers is already held by the carrier (shown, not paid out);
 * - refunds of online payments reduce what the platform holds (change-difference refunds are
 *   netted inside the replacing booking, so CHANGED bookings and those refunds are skipped);
 * - platform-wide coupons are funded by the platform and paid to the carrier;
 * - the platform fee applies to every sold ticket (any channel); broker commissions are deducted
 *   only when the carrier bears them.
 * net = online + broker + platformDiscount − refunds − platformFee − (carrier-borne commission).
 */
export async function computeCarrierStatement(companyId: string, from: Date, to: Date, cfg: FeeConfig) {
  const bookings = await getPrisma().booking.findMany({
    where: {
      trip: { companyId, departureAt: { gte: from, lt: to }, status: { not: TripStatus.CANCELLED } },
      status: { in: [BookingStatus.CONFIRMED, BookingStatus.CANCELLED] },
    },
    select: {
      id: true,
      channel: true,
      status: true,
      paymentMethod: true,
      paymentStatus: true,
      totalAmount: true,
      trip: { select: { id: true, tripNumber: true, departureAt: true } },
      tickets: { select: { status: true, cashCollection: { select: { amount: true } } } },
      refunds: { where: { reason: { not: RefundReason.CHANGE_DIFFERENCE }, status: { not: 'FAILED' } }, select: { amount: true } },
      commissionAccrual: { select: { amount: true, status: true } },
      couponRedemption: { select: { discountAmount: true, coupon: { select: { companyId: true } } } },
    },
  });

  const lines = new Map<string, TripLine>();
  const line = (t: { id: string; tripNumber: string | null; departureAt: Date }) => {
    let l = lines.get(t.id);
    if (!l) {
      l = { tripId: t.id, tripNumber: t.tripNumber, departureAt: t.departureAt.toISOString(), tickets: 0, onlineMinor: 0, brokerMinor: 0, cashMinor: 0, refundsMinor: 0, platformDiscountMinor: 0, platformFeeMinor: 0, brokerCommissionMinor: 0 };
      lines.set(t.id, l);
    }
    return l;
  };

  for (const b of bookings) {
    const l = line(b.trip);
    const confirmed = b.status === BookingStatus.CONFIRMED;
    const sold = b.tickets.filter((t) => t.status === TicketStatus.CONFIRMED).length;

    if (b.channel === BookingChannel.BROKER) {
      // A cancelled broker booking was refunded to the wallet in full: nothing to settle.
      if (!confirmed) continue;
      l.brokerMinor += b.totalAmount;
      if (b.commissionAccrual && b.commissionAccrual.status !== CommissionAccrualStatus.CLAWED_BACK) l.brokerCommissionMinor += b.commissionAccrual.amount;
    } else if (b.paymentMethod === BookingPaymentMethod.CASH_ON_BOARD) {
      l.cashMinor += b.tickets.reduce((n, t) => n + (t.cashCollection?.amount ?? 0), 0);
    } else {
      // Online: only money actually captured (PAID / refunded later).
      if (!['PAID', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(b.paymentStatus)) continue;
      l.onlineMinor += b.totalAmount;
      l.refundsMinor += b.refunds.reduce((n, r) => n + r.amount, 0);
    }

    if (confirmed) {
      l.tickets += sold;
      if (b.couponRedemption && b.couponRedemption.coupon.companyId === null) l.platformDiscountMinor += b.couponRedemption.discountAmount;
      const gross = b.totalAmount + (b.couponRedemption && b.couponRedemption.coupon.companyId === null ? b.couponRedemption.discountAmount : 0);
      if (cfg.feeType === PlatformFeeType.PERCENT) l.platformFeeMinor += Math.floor((gross * cfg.feeValue) / 10_000);
      if (cfg.feeType === PlatformFeeType.FIXED) l.platformFeeMinor += cfg.feeValue * sold;
    }
  }

  const all = [...lines.values()].sort((a, b) => a.departureAt.localeCompare(b.departureAt));
  const sum = (k: keyof Omit<TripLine, 'tripId' | 'tripNumber' | 'departureAt'>) => all.reduce((n, l) => n + l[k], 0);
  const totals = {
    ticketsCount: sum('tickets'),
    onlineSalesAmount: sum('onlineMinor'),
    brokerSalesAmount: sum('brokerMinor'),
    cashSalesAmount: sum('cashMinor'),
    refundsAmount: sum('refundsMinor'),
    platformDiscountAmount: sum('platformDiscountMinor'),
    platformFeeAmount: sum('platformFeeMinor'),
    brokerCommissionAmount: sum('brokerCommissionMinor'),
  };
  const carrierCommission = cfg.commissionBearer === CommissionBearer.CARRIER ? totals.brokerCommissionAmount : 0;
  const netPayableAmount =
    totals.onlineSalesAmount + totals.brokerSalesAmount + totals.platformDiscountAmount - totals.refundsAmount - totals.platformFeeAmount - carrierCommission;
  return { ...totals, netPayableAmount, lines: all };
}

type Row = Prisma.CarrierSettlementGetPayload<{ include: { company: { select: { id: true; name: true; shortName: true } } } }>;

export function toSettlementDto(s: Row, withLines = false) {
  return {
    id: s.id,
    company: { id: s.company.id, name: s.company.shortName ?? s.company.name },
    periodFrom: s.periodFrom.toISOString(),
    periodTo: s.periodTo.toISOString(),
    status: s.status,
    config: { feeType: s.feeType, feeValue: s.feeValue, commissionBearer: s.commissionBearer },
    ticketsCount: s.ticketsCount,
    onlineSalesMinor: s.onlineSalesAmount,
    brokerSalesMinor: s.brokerSalesAmount,
    cashSalesMinor: s.cashSalesAmount,
    refundsMinor: s.refundsAmount,
    platformDiscountMinor: s.platformDiscountAmount,
    platformFeeMinor: s.platformFeeAmount,
    brokerCommissionMinor: s.brokerCommissionAmount,
    netPayableMinor: s.netPayableAmount,
    direction: s.netPayableAmount >= 0 ? ('PLATFORM_PAYS_CARRIER' as const) : ('CARRIER_PAYS_PLATFORM' as const),
    paymentReference: s.paymentReference,
    notes: s.notes,
    finalizedAt: s.finalizedAt?.toISOString() ?? null,
    paidAt: s.paidAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
    currency: 'SDG' as const,
    ...(withLines ? { lines: s.lines } : {}),
  };
}

const include = { company: { select: { id: true, name: true, shortName: true } } } as const;
const overlapError = (message: string, details?: unknown) => new AppError({ statusCode: 409, code: ErrorCodes.SETTLEMENT_OVERLAP, message, ...(details ? { details } : {}) });
const stateError = (message: string, details?: unknown) => new AppError({ statusCode: 409, code: ErrorCodes.SETTLEMENT_STATE_INVALID, message, ...(details ? { details } : {}) });

/** Admin-managed carrier settlement statements (DRAFT → FINALIZED → PAID, or CANCELLED). */
export class CarrierSettlementsService {
  private async config(companyId: string): Promise<FeeConfig> {
    const c = await getPrisma().transportCompany.findUnique({ where: { id: companyId }, select: { platformFeeType: true, platformFeeValue: true, brokerCommissionBearer: true } });
    if (!c) throw AppError.notFound('Carrier not found');
    return { feeType: c.platformFeeType, feeValue: c.platformFeeValue, commissionBearer: c.brokerCommissionBearer };
  }

  /** Live statement (not stored) for reports: Sudan days [fromDate, toDate] inclusive. */
  async preview(companyId: string, fromDate: string, toDate: string) {
    const tz = env().PLATFORM_TIMEZONE;
    const from = zonedDayRange(fromDate, tz).from;
    const to = zonedDayRange(toDate, tz).to;
    const cfg = await this.config(companyId);
    return { periodFrom: from.toISOString(), periodTo: to.toISOString(), config: cfg, ...(await computeCarrierStatement(companyId, from, to, cfg)), currency: 'SDG' as const };
  }

  async create(input: { companyId: string; fromDate: string; toDate: string; notes?: string; actorAdminId: string; requestId?: string }) {
    if (input.fromDate > input.toDate) throw AppError.validation('fromDate must be on or before toDate', { field: 'fromDate' });
    const tz = env().PLATFORM_TIMEZONE;
    const from = zonedDayRange(input.fromDate, tz).from;
    const to = zonedDayRange(input.toDate, tz).to;
    if (to.getTime() > Date.now()) throw AppError.validation('The period must have ended (toDate before today)', { field: 'toDate' });
    const overlap = await getPrisma().carrierSettlement.findFirst({
      where: { companyId: input.companyId, status: { not: CarrierSettlementStatus.CANCELLED }, periodFrom: { lt: to }, periodTo: { gt: from } },
      select: { id: true, periodFrom: true, periodTo: true },
    });
    if (overlap) throw overlapError('A settlement already covers part of this period', { settlementId: overlap.id });
    const cfg = await this.config(input.companyId);
    const st = await computeCarrierStatement(input.companyId, from, to, cfg);
    const { lines, ...totals } = st;
    const row = await getPrisma().carrierSettlement.create({
      data: {
        companyId: input.companyId,
        periodFrom: from,
        periodTo: to,
        feeType: cfg.feeType,
        feeValue: cfg.feeValue,
        commissionBearer: cfg.commissionBearer,
        ...totals,
        lines: lines as unknown as Prisma.InputJsonValue,
        notes: input.notes ?? null,
        createdByAdminId: input.actorAdminId,
      },
      include,
    });
    await auditService.record({ actorAdminId: input.actorAdminId, action: 'carrier_settlement.created', resourceType: 'carrier_settlement', resourceId: row.id, requestId: input.requestId, metadata: { companyId: input.companyId, netPayable: row.netPayableAmount } });
    return toSettlementDto(row, true);
  }

  async list(query: { page?: number; pageSize?: number; companyId?: string; status?: CarrierSettlementStatus }) {
    const { page, pageSize, skip, take } = parsePagination(query);
    const where: Prisma.CarrierSettlementWhereInput = { ...(query.companyId ? { companyId: query.companyId } : {}), ...(query.status ? { status: query.status } : {}) };
    const [rows, total] = await Promise.all([
      getPrisma().carrierSettlement.findMany({ where, include, orderBy: [{ periodFrom: 'desc' }, { id: 'desc' }], skip, take }),
      getPrisma().carrierSettlement.count({ where }),
    ]);
    return { items: rows.map((r) => toSettlementDto(r)), meta: paginationMeta(page, pageSize, total) };
  }

  async get(id: string, companyId?: string) {
    const row = await getPrisma().carrierSettlement.findUnique({ where: { id }, include });
    if (!row || (companyId && row.companyId !== companyId)) throw AppError.notFound('Settlement not found');
    return toSettlementDto(row, true);
  }

  /** DRAFT only: recompute with today's data and the carrier's current fee configuration. */
  async recalculate(id: string, actorAdminId: string, requestId?: string) {
    const row = await getPrisma().carrierSettlement.findUnique({ where: { id } });
    if (!row) throw AppError.notFound('Settlement not found');
    if (row.status !== CarrierSettlementStatus.DRAFT) throw stateError('Only drafts can be recalculated', { status: row.status });
    const cfg = await this.config(row.companyId);
    const { lines, ...totals } = await computeCarrierStatement(row.companyId, row.periodFrom, row.periodTo, cfg);
    await getPrisma().carrierSettlement.update({
      where: { id },
      data: { feeType: cfg.feeType, feeValue: cfg.feeValue, commissionBearer: cfg.commissionBearer, ...totals, lines: lines as unknown as Prisma.InputJsonValue },
    });
    await auditService.record({ actorAdminId, action: 'carrier_settlement.recalculated', resourceType: 'carrier_settlement', resourceId: id, requestId });
    return this.get(id);
  }

  async transition(id: string, to: 'FINALIZED' | 'PAID' | 'CANCELLED', input: { actorAdminId: string; reference?: string; requestId?: string }) {
    const allowed: Record<typeof to, CarrierSettlementStatus[]> = {
      FINALIZED: [CarrierSettlementStatus.DRAFT],
      PAID: [CarrierSettlementStatus.FINALIZED],
      CANCELLED: [CarrierSettlementStatus.DRAFT, CarrierSettlementStatus.FINALIZED],
    };
    if (to === 'FINALIZED') {
      // Freeze the latest figures.
      const row = await getPrisma().carrierSettlement.findUnique({ where: { id } });
      if (row?.status === CarrierSettlementStatus.DRAFT) await this.recalculate(id, input.actorAdminId, input.requestId);
    }
    const now = new Date();
    const moved = await getPrisma().carrierSettlement.updateMany({
      where: { id, status: { in: allowed[to] } },
      data: {
        status: to,
        ...(to === 'FINALIZED' ? { finalizedAt: now } : {}),
        ...(to === 'PAID' ? { paidAt: now, paymentReference: input.reference ?? null } : {}),
        ...(to === 'CANCELLED' ? { cancelledAt: now } : {}),
      },
    });
    if (moved.count === 0) {
      const row = await getPrisma().carrierSettlement.findUnique({ where: { id }, select: { status: true } });
      if (!row) throw AppError.notFound('Settlement not found');
      throw stateError(`Cannot move a ${row.status} settlement to ${to}`, { status: row.status });
    }
    await auditService.record({ actorAdminId: input.actorAdminId, action: `carrier_settlement.${to.toLowerCase()}`, resourceType: 'carrier_settlement', resourceId: id, requestId: input.requestId, metadata: { reference: input.reference ?? null } });
    return this.get(id);
  }
}

export const carrierSettlementsService = new CarrierSettlementsService();
