import {
  CommissionAccrualStatus,
  CommissionSettlementStatus,
  type Prisma,
} from '@prisma/client';
import { getPrisma, type PrismaTx } from '../../infrastructure/database/prisma';

export class CommissionsRepository {
  createAccrual(
    data: { bookingId: string; officeId: string; amount: number },
    tx: PrismaTx,
  ) {
    return tx.commissionAccrual.create({
      data: { ...data, status: CommissionAccrualStatus.UNSETTLED },
    });
  }

  findAccrualByBooking(bookingId: string, tx: PrismaTx) {
    return tx.commissionAccrual.findUnique({ where: { bookingId } });
  }

  async markClawedBack(bookingId: string, tx: PrismaTx): Promise<number> {
    const result = await tx.commissionAccrual.updateMany({
      where: {
        bookingId,
        status: {
          in: [
            CommissionAccrualStatus.UNSETTLED,
            CommissionAccrualStatus.RESERVED,
            CommissionAccrualStatus.SETTLED,
          ],
        },
      },
      data: { status: CommissionAccrualStatus.CLAWED_BACK, settlementId: null },
    });
    return result.count;
  }

  async listAccruals(params: {
    where: Prisma.CommissionAccrualWhereInput;
    skip: number;
    take: number;
  }) {
    const [items, total] = await Promise.all([
      getPrisma().commissionAccrual.findMany({
        where: params.where,
        include: {
          booking: {
            select: {
              id: true,
              tripId: true,
              totalAmount: true,
              confirmedAt: true,
              status: true,
              employeeId: true,
            },
          },
          office: { select: { id: true, code: true, name: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: params.skip,
        take: params.take,
      }),
      getPrisma().commissionAccrual.count({ where: params.where }),
    ]);
    return { items, total };
  }

  async sumByStatus(officeId?: string) {
    const rows = await getPrisma().commissionAccrual.groupBy({
      by: ['status'],
      where: officeId ? { officeId } : {},
      _sum: { amount: true },
      _count: { _all: true },
    });
    const summary = {
      unsettledTotalMinor: 0,
      unsettledCount: 0,
      reservedTotalMinor: 0,
      reservedCount: 0,
      settledTotalMinor: 0,
      clawedBackTotalMinor: 0,
    };
    for (const row of rows) {
      const amount = row._sum.amount ?? 0;
      if (row.status === CommissionAccrualStatus.UNSETTLED) {
        summary.unsettledTotalMinor = amount;
        summary.unsettledCount = row._count._all;
      } else if (row.status === CommissionAccrualStatus.RESERVED) {
        summary.reservedTotalMinor = amount;
        summary.reservedCount = row._count._all;
      } else if (row.status === CommissionAccrualStatus.SETTLED) {
        summary.settledTotalMinor = amount;
      } else {
        summary.clawedBackTotalMinor = amount;
      }
    }
    return summary;
  }

  findOffice(officeId: string, tx?: PrismaTx) {
    return (tx ?? getPrisma()).brokerOffice.findUnique({ where: { id: officeId } });
  }

  async lockOffice(officeId: string, tx: PrismaTx): Promise<void> {
    await tx.$queryRaw`SELECT id FROM broker_offices WHERE id = ${officeId} FOR UPDATE`;
  }

  findOverlappingDraft(
    officeId: string,
    periodFrom: Date,
    periodTo: Date,
    tx: PrismaTx,
  ) {
    return tx.commissionSettlement.findFirst({
      where: {
        officeId,
        status: CommissionSettlementStatus.DRAFT,
        periodFrom: { lt: periodTo },
        periodTo: { gt: periodFrom },
      },
    });
  }

  findReservedInPeriod(officeId: string, periodFrom: Date, periodTo: Date, tx: PrismaTx) {
    return tx.commissionAccrual.findFirst({
      where: {
        officeId,
        status: CommissionAccrualStatus.RESERVED,
        booking: { confirmedAt: { gte: periodFrom, lt: periodTo } },
      },
    });
  }

  listUnsettledInPeriod(officeId: string, periodFrom: Date, periodTo: Date, tx: PrismaTx) {
    return tx.commissionAccrual.findMany({
      where: {
        officeId,
        status: CommissionAccrualStatus.UNSETTLED,
        booking: { confirmedAt: { gte: periodFrom, lt: periodTo } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async lockUnsettledInPeriod(
    officeId: string,
    periodFrom: Date,
    periodTo: Date,
    tx: PrismaTx,
  ): Promise<{ id: string; amount: number }[]> {
    return tx.$queryRaw<{ id: string; amount: number }[]>`
      SELECT ca.id, ca.amount
      FROM commission_accruals ca
      INNER JOIN bookings b ON b.id = ca.booking_id
      WHERE ca.office_id = ${officeId}
        AND ca.status = 'UNSETTLED'
        AND b.confirmed_at >= ${periodFrom}
        AND b.confirmed_at < ${periodTo}
      ORDER BY ca.created_at ASC, ca.id ASC
      FOR UPDATE
    `;
  }

  reserveAccruals(ids: string[], settlementId: string, tx: PrismaTx) {
    return tx.commissionAccrual.updateMany({
      where: { id: { in: ids }, status: CommissionAccrualStatus.UNSETTLED },
      data: { status: CommissionAccrualStatus.RESERVED, settlementId },
    });
  }

  releaseReserved(settlementId: string, tx: PrismaTx) {
    return tx.commissionAccrual.updateMany({
      where: { settlementId, status: CommissionAccrualStatus.RESERVED },
      data: { status: CommissionAccrualStatus.UNSETTLED, settlementId: null },
    });
  }

  markReservedSettled(settlementId: string, tx: PrismaTx) {
    return tx.commissionAccrual.updateMany({
      where: { settlementId, status: CommissionAccrualStatus.RESERVED },
      data: { status: CommissionAccrualStatus.SETTLED },
    });
  }

  createSettlement(
    data: {
      officeId: string;
      periodFrom: Date;
      periodTo: Date;
      totalAmount: number;
      initiatedByAdminId: string;
      note?: string;
    },
    tx: PrismaTx,
  ) {
    return tx.commissionSettlement.create({ data });
  }

  findSettlementById(id: string, tx?: PrismaTx) {
    return (tx ?? getPrisma()).commissionSettlement.findUnique({
      where: { id },
      include: {
        office: { select: { id: true, code: true, name: true } },
        _count: { select: { accruals: true } },
      },
    });
  }

  async lockSettlement(id: string, tx: PrismaTx): Promise<void> {
    await tx.$queryRaw`SELECT id FROM commission_settlements WHERE id = ${id} FOR UPDATE`;
  }

  async listSettlements(params: {
    where: Prisma.CommissionSettlementWhereInput;
    skip: number;
    take: number;
  }) {
    const [items, total] = await Promise.all([
      getPrisma().commissionSettlement.findMany({
        where: params.where,
        include: {
          office: { select: { id: true, code: true, name: true } },
          _count: { select: { accruals: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: params.skip,
        take: params.take,
      }),
      getPrisma().commissionSettlement.count({ where: params.where }),
    ]);
    return { items, total };
  }

  updateSettlement(
    id: string,
    data: Prisma.CommissionSettlementUpdateInput,
    tx: PrismaTx,
  ) {
    return tx.commissionSettlement.update({ where: { id }, data });
  }

  setOfficeLastSettledAt(officeId: string, settledAt: Date, tx: PrismaTx) {
    return tx.brokerOffice.update({ where: { id: officeId }, data: { lastSettledAt: settledAt } });
  }
}

export const commissionsRepository = new CommissionsRepository();
