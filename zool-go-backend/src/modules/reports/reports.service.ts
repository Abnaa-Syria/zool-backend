import {
  BookingStatus,
  TicketStatus,
  WalletLedgerType,
  type Prisma,
} from '@prisma/client';
import { env } from '../../config/env';
import { getPrisma } from '../../infrastructure/database/prisma';
import { parseDateBound } from '../../shared/utils/timezone';

export interface BrokerActor {
  employeeId: string;
  officeId: string;
  role: 'MANAGER' | 'CLERK';
  permissions: string[];
}

function parseRange(query: { from?: string; to?: string }): { from: Date; to: Date } {
  // Date-only bounds are Sudan calendar days (API_CONVENTIONS §6).
  const tz = env().PLATFORM_TIMEZONE;
  const now = new Date();
  const from = query.from
    ? parseDateBound(query.from, 'from', tz).date
    : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const to = query.to ? parseDateBound(query.to, 'to', tz).date : now;
  return { from, to };
}

export class ReportsService {
  async summary(actor: BrokerActor, query: { from?: string; to?: string }) {
    const { from, to } = parseRange(query);
    const prisma = getPrisma();
    const officeId = actor.officeId;

    const confirmedWhere: Prisma.BookingWhereInput = {
      officeId,
      status: BookingStatus.CONFIRMED,
      confirmedAt: { gte: from, lt: to },
    };
    const cancelledWhere: Prisma.BookingWhereInput = {
      officeId,
      status: BookingStatus.CANCELLED,
      cancelledAt: { gte: from, lt: to },
    };

    const [ticketsSold, grossAgg, commissionAgg, cancellations, refundAgg] = await Promise.all([
      prisma.ticket.count({
        where: {
          status: TicketStatus.CONFIRMED,
          booking: confirmedWhere,
        },
      }),
      prisma.booking.aggregate({
        where: confirmedWhere,
        _sum: { totalAmount: true },
      }),
      prisma.commissionAccrual.aggregate({
        where: {
          officeId,
          booking: { confirmedAt: { gte: from, lt: to } },
        },
        _sum: { amount: true },
      }),
      prisma.booking.count({ where: cancelledWhere }),
      prisma.walletLedgerEntry.aggregate({
        where: {
          type: WalletLedgerType.CREDIT_REFUND,
          createdAt: { gte: from, lt: to },
          wallet: { brokerOfficeId: officeId },
        },
        _sum: { amount: true },
      }),
    ]);

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      ticketsSold,
      grossSalesMinor: grossAgg._sum.totalAmount ?? 0,
      commissionAccruedMinor: commissionAgg._sum.amount ?? 0,
      cancellations,
      refundsMinor: refundAgg._sum.amount ?? 0,
    };
  }

  async byEmployee(actor: BrokerActor, query: { from?: string; to?: string }) {
    const { from, to } = parseRange(query);
    const prisma = getPrisma();

    const bookings = await prisma.booking.findMany({
      where: {
        officeId: actor.officeId,
        status: BookingStatus.CONFIRMED,
        confirmedAt: { gte: from, lt: to },
      },
      select: {
        employeeId: true,
        totalAmount: true,
        commissionAmount: true,
        employee: { select: { id: true, displayName: true } },
        _count: { select: { tickets: true } },
      },
    });

    const map = new Map<
      string,
      {
        employeeId: string;
        displayName: string;
        ticketsSold: number;
        grossSalesMinor: number;
        commissionAccruedMinor: number;
      }
    >();

    for (const b of bookings) {
      // Office-scoped query: broker bookings always carry an employee.
      if (!b.employeeId || !b.employee) continue;
      const existing = map.get(b.employeeId) ?? {
        employeeId: b.employee.id,
        displayName: b.employee.displayName,
        ticketsSold: 0,
        grossSalesMinor: 0,
        commissionAccruedMinor: 0,
      };
      existing.ticketsSold += b._count.tickets;
      existing.grossSalesMinor += b.totalAmount;
      existing.commissionAccruedMinor += b.commissionAmount;
      map.set(b.employeeId, existing);
    }

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      items: [...map.values()].sort((a, b) => b.grossSalesMinor - a.grossSalesMinor),
    };
  }

  async byCarrier(actor: BrokerActor, query: { from?: string; to?: string }) {
    const { from, to } = parseRange(query);
    const prisma = getPrisma();

    const bookings = await prisma.booking.findMany({
      where: {
        officeId: actor.officeId,
        status: BookingStatus.CONFIRMED,
        confirmedAt: { gte: from, lt: to },
      },
      select: {
        totalAmount: true,
        commissionAmount: true,
        trip: {
          select: {
            company: { select: { id: true, key: true, name: true } },
          },
        },
        _count: { select: { tickets: true } },
      },
    });

    const map = new Map<
      string,
      {
        companyId: string;
        key: string;
        name: string;
        ticketsSold: number;
        grossSalesMinor: number;
        commissionAccruedMinor: number;
      }
    >();

    for (const b of bookings) {
      const c = b.trip.company;
      const existing = map.get(c.id) ?? {
        companyId: c.id,
        key: c.key,
        name: c.name,
        ticketsSold: 0,
        grossSalesMinor: 0,
        commissionAccruedMinor: 0,
      };
      existing.ticketsSold += b._count.tickets;
      existing.grossSalesMinor += b.totalAmount;
      existing.commissionAccruedMinor += b.commissionAmount;
      map.set(c.id, existing);
    }

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      items: [...map.values()].sort((a, b) => b.grossSalesMinor - a.grossSalesMinor),
    };
  }

  async walletActivity(actor: BrokerActor, query: { from?: string; to?: string }) {
    const { from, to } = parseRange(query);
    const prisma = getPrisma();

    const rows = await prisma.walletLedgerEntry.groupBy({
      by: ['type'],
      where: {
        createdAt: { gte: from, lt: to },
        wallet: { brokerOfficeId: actor.officeId },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });

    const byType = Object.fromEntries(
      rows.map((r) => [
        r.type,
        { totalMinor: r._sum.amount ?? 0, count: r._count._all },
      ]),
    ) as Partial<
      Record<WalletLedgerType, { totalMinor: number; count: number }>
    >;

    const empty = { totalMinor: 0, count: 0 };
    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      topUps: byType[WalletLedgerType.CREDIT_TOPUP] ?? empty,
      bookingDebits: byType[WalletLedgerType.DEBIT_BOOKING] ?? empty,
      refunds: byType[WalletLedgerType.CREDIT_REFUND] ?? empty,
      commissionPayouts: byType[WalletLedgerType.DEBIT_COMMISSION_PAYOUT] ?? empty,
    };
  }
}

export const reportsService = new ReportsService();
