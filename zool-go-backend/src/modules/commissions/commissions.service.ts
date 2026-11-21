import {
  CommissionAccrualStatus,
  CommissionSettlementStatus,
  Prisma,
  type CommissionSettlement,
} from '@prisma/client';
import { getPrisma } from '../../infrastructure/database/prisma';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import { paginationMeta, parsePagination } from '../../shared/utils/pagination';
import { auditService } from '../audit/audit.service';
import { commissionsRepository } from './commissions.repository';

type AccrualRow = Awaited<ReturnType<typeof commissionsRepository.listAccruals>>['items'][number];
type SettlementRow = NonNullable<
  Awaited<ReturnType<typeof commissionsRepository.findSettlementById>>
>;

function toAccrualDto(accrual: AccrualRow) {
  return {
    id: accrual.id,
    bookingId: accrual.bookingId,
    officeId: accrual.officeId,
    officeCode: accrual.office.code,
    amountMinor: accrual.amount,
    status: accrual.status,
    settlementId: accrual.settlementId,
    booking: {
      tripId: accrual.booking.tripId,
      totalAmountMinor: accrual.booking.totalAmount,
      status: accrual.booking.status,
      employeeId: accrual.booking.employeeId,
      confirmedAt: accrual.booking.confirmedAt?.toISOString() ?? null,
    },
    createdAt: accrual.createdAt.toISOString(),
    updatedAt: accrual.updatedAt.toISOString(),
  };
}

function toSettlementDto(row: SettlementRow | (CommissionSettlement & { office?: { id: string; code: string; name: string }; _count?: { accruals: number } })) {
  const office = 'office' in row ? row.office : undefined;
  const count = '_count' in row ? row._count?.accruals : undefined;
  return {
    id: row.id,
    officeId: row.officeId,
    officeCode: office?.code ?? null,
    periodFrom: row.periodFrom.toISOString(),
    periodTo: row.periodTo.toISOString(),
    status: row.status,
    totalAmountMinor: row.totalAmount,
    initiatedByAdminId: row.initiatedByAdminId,
    finalizedByAdminId: row.finalizedByAdminId,
    note: row.note,
    payoutReference: row.payoutReference,
    currency: 'SDG' as const,
    accrualCount: count ?? null,
    finalizedAt: row.finalizedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class CommissionsService {
  /** Broker view: UNSETTLED accruals + totals. */
  async listUnsettledForOffice(
    officeId: string,
    query: { page?: number; pageSize?: number },
  ) {
    const { page, pageSize, skip, take } = parsePagination(query);
    const [{ items, total }, summary, office] = await Promise.all([
      commissionsRepository.listAccruals({
        where: { officeId, status: CommissionAccrualStatus.UNSETTLED },
        skip,
        take,
      }),
      commissionsRepository.sumByStatus(officeId),
      commissionsRepository.findOffice(officeId),
    ]);
    return {
      data: {
        totalUnsettledMinor: summary.unsettledTotalMinor,
        unsettledCount: summary.unsettledCount,
        lastSettledAt: office?.lastSettledAt?.toISOString() ?? null,
        items: items.map(toAccrualDto),
      },
      meta: paginationMeta(page, pageSize, total),
    };
  }

  /** Admin view across offices. */
  async listAdmin(query: {
    page?: number;
    pageSize?: number;
    officeId?: string;
    status?: CommissionAccrualStatus;
  }) {
    const { page, pageSize, skip, take } = parsePagination(query);
    const where: Prisma.CommissionAccrualWhereInput = {
      ...(query.officeId ? { officeId: query.officeId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [{ items, total }, summary] = await Promise.all([
      commissionsRepository.listAccruals({ where, skip, take }),
      commissionsRepository.sumByStatus(query.officeId),
    ]);
    return {
      items: items.map(toAccrualDto),
      meta: { ...paginationMeta(page, pageSize, total), summary },
    };
  }

  async listSettlements(query: {
    page?: number;
    pageSize?: number;
    officeId?: string;
    status?: CommissionSettlementStatus;
  }) {
    const { page, pageSize, skip, take } = parsePagination(query);
    const where: Prisma.CommissionSettlementWhereInput = {
      ...(query.officeId ? { officeId: query.officeId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const { items, total } = await commissionsRepository.listSettlements({ where, skip, take });
    return {
      items: items.map(toSettlementDto),
      meta: paginationMeta(page, pageSize, total),
    };
  }

  async getSettlement(id: string) {
    const row = await commissionsRepository.findSettlementById(id);
    if (!row) throw AppError.notFound('Settlement not found');
    return toSettlementDto(row);
  }

  /**
   * Paginated accruals linked to a settlement. Detail GET stays a summary
   * (accrualCount only) so large DRAFT/FINALIZED periods are not unbounded.
   */
  async listSettlementAccruals(
    settlementId: string,
    query: { page?: number; pageSize?: number },
  ) {
    const existing = await commissionsRepository.findSettlementById(settlementId);
    if (!existing) throw AppError.notFound('Settlement not found');

    const { page, pageSize, skip, take } = parsePagination(query);
    const { items, total } = await commissionsRepository.listAccruals({
      where: { settlementId },
      skip,
      take,
    });
    return {
      items: items.map((accrual) => ({
        id: accrual.id,
        bookingId: accrual.bookingId,
        officeCode: accrual.office.code,
        amountMinor: accrual.amount,
        currency: 'SDG' as const,
        status: accrual.status,
        confirmedAt: accrual.booking.confirmedAt?.toISOString() ?? null,
        createdAt: accrual.createdAt.toISOString(),
      })),
      meta: paginationMeta(page, pageSize, total),
    };
  }

  async createDraft(input: {
    officeId: string;
    periodFrom: Date;
    periodTo: Date;
    note?: string;
    actorAdminId: string;
    requestId?: string;
  }) {
    if (!(input.periodFrom < input.periodTo)) {
      throw AppError.validation('periodFrom must be before periodTo');
    }

    const office = await commissionsRepository.findOffice(input.officeId);
    if (!office) throw AppError.notFound('Broker office not found');

    const settlement = await getPrisma().$transaction(
      async (tx) => {
        await commissionsRepository.lockOffice(input.officeId, tx);

        const overlapping = await commissionsRepository.findOverlappingDraft(
          input.officeId,
          input.periodFrom,
          input.periodTo,
          tx,
        );
        if (overlapping) {
          throw new AppError({
            message: 'An overlapping draft settlement already exists for this office',
            statusCode: 409,
            code: ErrorCodes.SETTLEMENT_OVERLAP,
            details: { settlementId: overlapping.id },
          });
        }

        const reserved = await commissionsRepository.findReservedInPeriod(
          input.officeId,
          input.periodFrom,
          input.periodTo,
          tx,
        );
        if (reserved) {
          throw new AppError({
            message: 'Accruals in this period are already reserved by another settlement',
            statusCode: 409,
            code: ErrorCodes.SETTLEMENT_OVERLAP,
            details: { accrualId: reserved.id, settlementId: reserved.settlementId },
          });
        }

        const accruals = await commissionsRepository.lockUnsettledInPeriod(
          input.officeId,
          input.periodFrom,
          input.periodTo,
          tx,
        );
        const total = accruals.reduce((sum, a) => sum + a.amount, 0);
        if (accruals.length === 0 || total <= 0) {
          throw new AppError({
            message: 'There is no unsettled commission in this period',
            statusCode: 409,
            code: ErrorCodes.NOTHING_TO_SETTLE,
          });
        }

        const created = await commissionsRepository.createSettlement(
          {
            officeId: input.officeId,
            periodFrom: input.periodFrom,
            periodTo: input.periodTo,
            totalAmount: total,
            initiatedByAdminId: input.actorAdminId,
            ...(input.note ? { note: input.note } : {}),
          },
          tx,
        );

        const reservedCount = await commissionsRepository.reserveAccruals(
          accruals.map((a) => a.id),
          created.id,
          tx,
        );
        if (reservedCount.count !== accruals.length) {
          throw AppError.conflict('Commission accruals changed concurrently; retry the settlement');
        }

        await auditService.record(
          {
            actorAdminId: input.actorAdminId,
            action: 'commission.settlement.drafted',
            resourceType: 'commission_settlement',
            resourceId: created.id,
            requestId: input.requestId,
            metadata: {
              officeId: input.officeId,
              totalAmountMinor: total,
              accrualCount: accruals.length,
            },
          },
          tx,
        );

        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );

    const loaded = await commissionsRepository.findSettlementById(settlement.id);
    if (!loaded) throw AppError.notFound('Settlement not found');
    return toSettlementDto(loaded);
  }

  async finalize(input: {
    settlementId: string;
    payoutReference?: string;
    note?: string;
    actorAdminId: string;
    requestId?: string;
  }) {
    const existing = await commissionsRepository.findSettlementById(input.settlementId);
    if (!existing) throw AppError.notFound('Settlement not found');
    if (existing.status === CommissionSettlementStatus.FINALIZED) {
      return { settlement: toSettlementDto(existing), replayed: true };
    }
    if (existing.status !== CommissionSettlementStatus.DRAFT) {
      throw AppError.conflict('Only draft settlements can be finalized', { status: existing.status });
    }

    const updated = await getPrisma().$transaction(
      async (tx) => {
        await commissionsRepository.lockSettlement(input.settlementId, tx);
        const current = await commissionsRepository.findSettlementById(input.settlementId, tx);
        if (!current) throw AppError.notFound('Settlement not found');
        if (current.status === CommissionSettlementStatus.FINALIZED) {
          return { row: current, replayed: true };
        }
        if (current.status !== CommissionSettlementStatus.DRAFT) {
          throw AppError.conflict('Only draft settlements can be finalized', {
            status: current.status,
          });
        }

        await commissionsRepository.markReservedSettled(current.id, tx);
        const finalizedAt = new Date();
        const row = await commissionsRepository.updateSettlement(
          current.id,
          {
            status: CommissionSettlementStatus.FINALIZED,
            finalizedByAdmin: { connect: { id: input.actorAdminId } },
            finalizedAt,
            ...(input.payoutReference ? { payoutReference: input.payoutReference.slice(0, 128) } : {}),
            ...(input.note ? { note: input.note.slice(0, 500) } : {}),
          },
          tx,
        );
        await commissionsRepository.setOfficeLastSettledAt(current.officeId, finalizedAt, tx);
        await auditService.record(
          {
            actorAdminId: input.actorAdminId,
            action: 'commission.settlement.finalized',
            resourceType: 'commission_settlement',
            resourceId: current.id,
            requestId: input.requestId,
            metadata: {
              officeId: current.officeId,
              totalAmountMinor: current.totalAmount,
              payoutReference: input.payoutReference ?? null,
              walletDebited: false,
            },
          },
          tx,
        );
        return { row, replayed: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );

    const loaded = await commissionsRepository.findSettlementById(updated.row.id);
    if (!loaded) throw AppError.notFound('Settlement not found');
    return { settlement: toSettlementDto(loaded), replayed: updated.replayed };
  }

  async cancel(input: { settlementId: string; actorAdminId: string; requestId?: string }) {
    const existing = await commissionsRepository.findSettlementById(input.settlementId);
    if (!existing) throw AppError.notFound('Settlement not found');
    if (existing.status === CommissionSettlementStatus.CANCELLED) {
      return { settlement: toSettlementDto(existing), replayed: true };
    }
    if (existing.status !== CommissionSettlementStatus.DRAFT) {
      throw AppError.conflict('Only draft settlements can be cancelled', { status: existing.status });
    }

    const updated = await getPrisma().$transaction(
      async (tx) => {
        await commissionsRepository.lockSettlement(input.settlementId, tx);
        const current = await commissionsRepository.findSettlementById(input.settlementId, tx);
        if (!current) throw AppError.notFound('Settlement not found');
        if (current.status === CommissionSettlementStatus.CANCELLED) {
          return { row: current, replayed: true };
        }
        if (current.status !== CommissionSettlementStatus.DRAFT) {
          throw AppError.conflict('Only draft settlements can be cancelled', {
            status: current.status,
          });
        }

        await commissionsRepository.releaseReserved(current.id, tx);
        const row = await commissionsRepository.updateSettlement(
          current.id,
          { status: CommissionSettlementStatus.CANCELLED },
          tx,
        );
        await auditService.record(
          {
            actorAdminId: input.actorAdminId,
            action: 'commission.settlement.cancelled',
            resourceType: 'commission_settlement',
            resourceId: current.id,
            requestId: input.requestId,
            metadata: { officeId: current.officeId },
          },
          tx,
        );
        return { row, replayed: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );

    const loaded = await commissionsRepository.findSettlementById(updated.row.id);
    if (!loaded) throw AppError.notFound('Settlement not found');
    return { settlement: toSettlementDto(loaded), replayed: updated.replayed };
  }
}

export const commissionsService = new CommissionsService();
