import { Prisma, type BrokerOfficeStatus, type WalletLedgerType } from '@prisma/client';
import { getPrisma, type PrismaTx } from '../../infrastructure/database/prisma';

function client(tx?: PrismaTx) {
  return tx ?? getPrisma();
}

export class WalletsRepository {
  findByOfficeId(officeId: string, tx?: PrismaTx) {
    return client(tx).wallet.findUnique({ where: { brokerOfficeId: officeId } });
  }

  findOfficePolicy(officeId: string, tx?: PrismaTx) {
    return client(tx).brokerOffice.findUnique({
      where: { id: officeId },
      select: {
        minTopUpMinorOverride: true,
        exposureCeilingOverride: true,
        lowBalanceThresholdMinorOverride: true,
        timeZone: true,
        settlementPeriod: true,
      },
    });
  }

  findById(walletId: string, tx?: PrismaTx) {
    return client(tx).wallet.findUnique({ where: { id: walletId } });
  }

  createForOffice(officeId: string, tx?: PrismaTx) {
    return client(tx).wallet.create({ data: { brokerOfficeId: officeId, balance: 0 } });
  }

  /** Row-level lock; serializes concurrent money movements for one office. */
  async lockWallet(walletId: string, tx: PrismaTx): Promise<void> {
    await tx.$queryRaw`SELECT id FROM wallets WHERE id = ${walletId} FOR UPDATE`;
  }

  /** Conditional debit: returns number of rows updated (0 => insufficient). */
  async debitIfSufficient(walletId: string, amount: number, tx: PrismaTx): Promise<number> {
    const result = await tx.wallet.updateMany({
      where: { id: walletId, balance: { gte: amount } },
      data: { balance: { decrement: amount } },
    });
    return result.count;
  }

  async credit(walletId: string, amount: number, tx: PrismaTx): Promise<number> {
    const result = await tx.wallet.updateMany({
      where: { id: walletId },
      data: { balance: { increment: amount } },
    });
    return result.count;
  }

  findLedgerByKey(idempotencyKey: string, tx?: PrismaTx) {
    return client(tx).walletLedgerEntry.findUnique({ where: { idempotencyKey } });
  }

  createLedgerEntry(
    data: {
      walletId: string;
      type: WalletLedgerType;
      amount: number;
      balanceAfter: number;
      idempotencyKey: string;
      referenceType?: string;
      referenceId?: string;
    },
    tx: PrismaTx,
  ) {
    return tx.walletLedgerEntry.create({ data });
  }

  /**
   * Wallet ids whose balance is below the resolved office threshold
   * (`override ?? platformDefault`). Comparison matches `balance < threshold`.
   */
  async findLowBalanceWalletIds(defaultThresholdMinor: number): Promise<string[]> {
    const rows = await getPrisma().$queryRaw<{ id: string }[]>`
      SELECT w.id
      FROM wallets w
      INNER JOIN broker_offices o ON o.id = w.broker_office_id
      WHERE w.balance < COALESCE(o.low_balance_threshold_minor_override, ${defaultThresholdMinor})
    `;
    return rows.map((row) => row.id);
  }

  async listAdmin(params: {
    skip: number;
    take: number;
    q?: string;
    officeStatus?: BrokerOfficeStatus;
    walletIds?: string[];
    sort: 'balanceMinor' | 'updatedAt' | 'officeCode' | 'officeName';
    order: 'asc' | 'desc';
  }) {
    const officeFilter: Prisma.BrokerOfficeWhereInput = {
      ...(params.officeStatus ? { status: params.officeStatus } : {}),
      ...(params.q
        ? {
            OR: [{ code: { contains: params.q } }, { name: { contains: params.q } }],
          }
        : {}),
    };

    const where: Prisma.WalletWhereInput = {
      brokerOffice: officeFilter,
      ...(params.walletIds ? { id: { in: params.walletIds } } : {}),
    };

    const direction = params.order;
    const orderBy: Prisma.WalletOrderByWithRelationInput[] =
      params.sort === 'updatedAt'
        ? [{ updatedAt: direction }, { id: 'desc' }]
        : params.sort === 'officeCode'
          ? [{ brokerOffice: { code: direction } }, { id: 'desc' }]
          : params.sort === 'officeName'
            ? [{ brokerOffice: { name: direction } }, { id: 'desc' }]
            : [{ balance: direction }, { id: 'desc' }];

    const [items, total] = await Promise.all([
      getPrisma().wallet.findMany({
        where,
        include: {
          brokerOffice: {
            select: {
              id: true,
              code: true,
              name: true,
              status: true,
              minTopUpMinorOverride: true,
              exposureCeilingOverride: true,
              lowBalanceThresholdMinorOverride: true,
              timeZone: true,
              settlementPeriod: true,
            },
          },
        },
        orderBy,
        skip: params.skip,
        take: params.take,
      }),
      getPrisma().wallet.count({ where }),
    ]);
    return { items, total };
  }

  async listLedger(walletId: string, params: { skip: number; take: number }) {
    const where: Prisma.WalletLedgerEntryWhereInput = { walletId };
    const [items, total] = await Promise.all([
      getPrisma().walletLedgerEntry.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: params.skip,
        take: params.take,
      }),
      getPrisma().walletLedgerEntry.count({ where }),
    ]);
    return { items, total };
  }
}

export const walletsRepository = new WalletsRepository();
