import {
  BookingStatus,
  CommissionAccrualStatus,
  CommissionSettlementStatus,
  Prisma,
  TopUpIntentStatus,
} from '@prisma/client';
import { getPrisma } from '../../infrastructure/database/prisma';

export type Scope = { from: Date; to: Date; officeId?: string; companyId?: string };

function bookingScope(s: Scope): Prisma.BookingWhereInput {
  return {
    ...(s.officeId ? { officeId: s.officeId } : {}),
    ...(s.companyId ? { trip: { companyId: s.companyId } } : {}),
  };
}

/** Read-only aggregates for the admin overview and reports (REQ-ADM-09 / REQ-ADM-10). */
export class InsightsRepository {
  async confirmedBookings(s: Scope) {
    const agg = await getPrisma().booking.aggregate({
      where: { ...bookingScope(s), status: BookingStatus.CONFIRMED, confirmedAt: { gte: s.from, lt: s.to } },
      _count: { _all: true },
      _sum: { totalAmount: true },
    });
    return { count: agg._count._all, amount: agg._sum.totalAmount ?? 0 };
  }

  /** Cancellations in the window. Every cancellation refunds the full booking amount (D-REF-01 / D-SUS-01). */
  async cancelledBookings(s: Scope) {
    const agg = await getPrisma().booking.aggregate({
      where: { ...bookingScope(s), status: BookingStatus.CANCELLED, cancelledAt: { gte: s.from, lt: s.to } },
      _count: { _all: true },
      _sum: { totalAmount: true },
    });
    return { count: agg._count._all, amount: agg._sum.totalAmount ?? 0 };
  }

  async commissionByStatus(s: Scope, status: CommissionAccrualStatus) {
    const agg = await getPrisma().commissionAccrual.aggregate({
      where: {
        status,
        ...(s.officeId ? { officeId: s.officeId } : {}),
        booking: { confirmedAt: { gte: s.from, lt: s.to }, ...(s.companyId ? { trip: { companyId: s.companyId } } : {}) },
      },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? 0;
  }

  async unsettledCommissionTotal() {
    const agg = await getPrisma().commissionAccrual.aggregate({
      where: { status: CommissionAccrualStatus.UNSETTLED },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? 0;
  }

  async walletsBalance(officeId?: string) {
    const agg = await getPrisma().wallet.aggregate({
      where: officeId ? { brokerOfficeId: officeId } : {},
      _sum: { balance: true },
    });
    return agg._sum.balance ?? 0;
  }

  async lowBalanceOfficesCount(defaultThresholdMinor: number) {
    const rows = await getPrisma().$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n
      FROM wallets w
      INNER JOIN broker_offices o ON o.id = w.broker_office_id
      WHERE w.balance < COALESCE(o.low_balance_threshold_minor_override, ${defaultThresholdMinor})
    `;
    return Number(rows[0]?.n ?? 0);
  }

  pendingTopUpsCount() {
    return getPrisma().topUpIntent.count({ where: { status: TopUpIntentStatus.PENDING_REVIEW } });
  }

  draftSettlementsCount() {
    return getPrisma().commissionSettlement.count({ where: { status: CommissionSettlementStatus.DRAFT } });
  }

  async byOffice(s: Scope) {
    const rows = await getPrisma().booking.groupBy({
      by: ['officeId'],
      where: { ...bookingScope(s), status: BookingStatus.CONFIRMED, confirmedAt: { gte: s.from, lt: s.to }, officeId: { not: null } },
      _count: { _all: true },
      _sum: { totalAmount: true, commissionAmount: true },
      orderBy: { _sum: { totalAmount: 'desc' } },
    });
    const offices = await getPrisma().brokerOffice.findMany({
      where: { id: { in: rows.map((r) => r.officeId!).filter(Boolean) } },
      select: { id: true, code: true, name: true },
    });
    return rows.map((r) => ({
      office: offices.find((o) => o.id === r.officeId) ?? { id: r.officeId, code: null, name: null },
      bookingsCount: r._count._all,
      bookingsAmountMinor: r._sum.totalAmount ?? 0,
      commissionAmountMinor: r._sum.commissionAmount ?? 0,
    }));
  }

  async byCarrier(s: Scope) {
    const rows = await getPrisma().$queryRaw<
      { companyId: string; name: string; bookings: bigint; amount: Prisma.Decimal | null; commission: Prisma.Decimal | null }[]
    >`
      SELECT t.company_id AS companyId, c.name AS name, COUNT(*) AS bookings,
             SUM(b.total_amount) AS amount, SUM(b.commission_amount) AS commission
      FROM bookings b
      INNER JOIN trips t ON t.id = b.trip_id
      INNER JOIN transport_companies c ON c.id = t.company_id
      WHERE b.status = 'CONFIRMED'
        AND b.confirmed_at >= ${s.from} AND b.confirmed_at < ${s.to}
        ${s.officeId ? Prisma.sql`AND b.office_id = ${s.officeId}` : Prisma.empty}
        ${s.companyId ? Prisma.sql`AND t.company_id = ${s.companyId}` : Prisma.empty}
      GROUP BY t.company_id, c.name
      ORDER BY amount DESC
    `;
    return rows.map((r) => ({
      company: { id: r.companyId, name: r.name },
      bookingsCount: Number(r.bookings),
      bookingsAmountMinor: Number(r.amount ?? 0),
      commissionAmountMinor: Number(r.commission ?? 0),
    }));
  }
}

export const insightsRepository = new InsightsRepository();
