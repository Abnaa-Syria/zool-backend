import { WalletLedgerType, type BrokerOfficeStatus, type WalletLedgerEntry } from '@prisma/client';
import { env } from '../../config/env';
import type { PrismaTx } from '../../infrastructure/database/prisma';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import { paginationMeta, parsePagination } from '../../shared/utils/pagination';
import { resolveOfficePolicy } from '../../shared/utils/office-policy';
import { WalletErrors } from './wallets.errors';
import { walletsRepository } from './wallets.repository';

/** Locked M1 comparison: below-threshold warning uses strict less-than (same as per-office GET). */
export function isWalletLowBalance(balanceMinor: number, thresholdMinor: number): boolean {
  return balanceMinor < thresholdMinor;
}

const CREDIT_TYPES: ReadonlySet<WalletLedgerType> = new Set([
  WalletLedgerType.CREDIT_TOPUP,
  WalletLedgerType.CREDIT_REFUND,
]);

export interface LedgerEntryDto {
  id: string;
  type: WalletLedgerType;
  direction: 'CREDIT' | 'DEBIT';
  amountMinor: number;
  balanceAfterMinor: number;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: string;
}

export interface MoneyMovementInput {
  walletId: string;
  amount: number;
  type: WalletLedgerType;
  idempotencyKey: string;
  referenceType?: string;
  referenceId?: string;
}

export interface MoneyMovementResult {
  entry: WalletLedgerEntry;
  /** True when the idempotency key was already applied; no balance change was made. */
  replayed: boolean;
}

export function toLedgerEntryDto(entry: WalletLedgerEntry): LedgerEntryDto {
  return {
    id: entry.id,
    type: entry.type,
    direction: CREDIT_TYPES.has(entry.type) ? 'CREDIT' : 'DEBIT',
    amountMinor: entry.amount,
    balanceAfterMinor: entry.balanceAfter,
    referenceType: entry.referenceType,
    referenceId: entry.referenceId,
    createdAt: entry.createdAt.toISOString(),
  };
}

function assertPositiveInt(amount: number): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw AppError.validation('Amount must be a positive integer');
  }
}

export class WalletsService {
  async getOfficeWallet(officeId: string) {
    const wallet = await walletsRepository.findByOfficeId(officeId);
    if (!wallet) throw WalletErrors.walletNotFound();
    const office = await walletsRepository.findOfficePolicy(officeId);
    if (!office) throw WalletErrors.walletNotFound();
    const policy = resolveOfficePolicy(office);
    return {
      id: wallet.id,
      officeId: wallet.brokerOfficeId,
      balanceMinor: wallet.balance,
      currency: wallet.currency,
      lowBalanceThresholdMinor: policy.lowBalanceThresholdMinor,
      lowBalance: isWalletLowBalance(wallet.balance, policy.lowBalanceThresholdMinor),
      updatedAt: wallet.updatedAt.toISOString(),
    };
  }

  async listLedger(officeId: string, query: { page?: number; pageSize?: number }) {
    const wallet = await walletsRepository.findByOfficeId(officeId);
    if (!wallet) throw WalletErrors.walletNotFound();
    const { page, pageSize, skip, take } = parsePagination(query);
    const { items, total } = await walletsRepository.listLedger(wallet.id, { skip, take });
    return {
      items: items.map(toLedgerEntryDto),
      meta: paginationMeta(page, pageSize, total),
    };
  }

  /**
   * Cross-office admin wallet list. Read-only; no audit.
   * `lowBalance` uses resolved policy (`office override ?? LOW_BALANCE_WARNING_THRESHOLD`).
   */
  async listAdmin(query: {
    page?: number;
    pageSize?: number;
    q?: string;
    officeStatus?: BrokerOfficeStatus;
    lowBalance?: boolean;
    sort?: 'balanceMinor' | 'updatedAt' | 'officeCode' | 'officeName';
    order?: 'asc' | 'desc';
  }) {
    const { page, pageSize, skip, take } = parsePagination(query);
    const sort = query.sort ?? 'balanceMinor';
    const order = query.order ?? (sort === 'balanceMinor' ? 'desc' : 'asc');

    let walletIds: string[] | undefined;
    if (query.lowBalance === true) {
      walletIds = await walletsRepository.findLowBalanceWalletIds(env().LOW_BALANCE_WARNING_THRESHOLD);
      if (walletIds.length === 0) {
        return { items: [], meta: paginationMeta(page, pageSize, 0) };
      }
    }

    const { items, total } = await walletsRepository.listAdmin({
      skip,
      take,
      sort,
      order,
      ...(query.q ? { q: query.q } : {}),
      ...(query.officeStatus ? { officeStatus: query.officeStatus } : {}),
      ...(walletIds ? { walletIds } : {}),
    });

    return {
      items: items.map((row) => {
        if (row.currency !== 'SDG') {
          throw new AppError({
            message: 'Only SDG wallets are supported in M1',
            statusCode: 409,
            code: ErrorCodes.UNSUPPORTED_CURRENCY,
            details: { currency: row.currency },
          });
        }
        const policy = resolveOfficePolicy(row.brokerOffice);
        return {
          officeId: row.brokerOffice.id,
          officeCode: row.brokerOffice.code,
          officeName: row.brokerOffice.name,
          officeStatus: row.brokerOffice.status,
          walletId: row.id,
          balanceMinor: row.balance,
          currency: 'SDG' as const,
          lowBalanceThresholdMinor: policy.lowBalanceThresholdMinor,
          lowBalance: isWalletLowBalance(row.balance, policy.lowBalanceThresholdMinor),
          updatedAt: row.updatedAt.toISOString(),
        };
      }),
      meta: paginationMeta(page, pageSize, total),
    };
  }

  /** Admin view: wallet + paginated ledger. */
  async getAdminWalletView(officeId: string, query: { page?: number; pageSize?: number }) {
    const [wallet, ledger] = await Promise.all([
      this.getOfficeWallet(officeId),
      this.listLedger(officeId, query),
    ]);
    return { wallet, ledger: ledger.items, meta: ledger.meta };
  }

  /** Serialize concurrent money movements for the wallet (call first inside a transaction). */
  async lock(walletId: string, tx: PrismaTx): Promise<void> {
    await walletsRepository.lockWallet(walletId, tx);
  }

  /**
   * Credit the wallet inside the caller's transaction. Ledger idempotencyKey is unique;
   * a repeated key returns the original entry without touching the balance.
   */
  async credit(tx: PrismaTx, input: MoneyMovementInput): Promise<MoneyMovementResult> {
    assertPositiveInt(input.amount);
    if (!CREDIT_TYPES.has(input.type)) {
      throw AppError.internal('Invalid credit ledger type');
    }

    const existing = await walletsRepository.findLedgerByKey(input.idempotencyKey, tx);
    if (existing) return { entry: existing, replayed: true };

    const updated = await walletsRepository.credit(input.walletId, input.amount, tx);
    if (updated === 0) throw WalletErrors.walletNotFound();
    const wallet = await walletsRepository.findById(input.walletId, tx);
    if (!wallet) throw WalletErrors.walletNotFound();

    const entry = await walletsRepository.createLedgerEntry(
      {
        walletId: input.walletId,
        type: input.type,
        amount: input.amount,
        balanceAfter: wallet.balance,
        idempotencyKey: input.idempotencyKey,
        ...(input.referenceType ? { referenceType: input.referenceType } : {}),
        ...(input.referenceId ? { referenceId: input.referenceId } : {}),
      },
      tx,
    );
    return { entry, replayed: false };
  }

  /**
   * Debit the wallet with a conditional balance update (balance >= amount).
   * Throws INSUFFICIENT_BALANCE when the guard fails.
   */
  async debit(tx: PrismaTx, input: MoneyMovementInput): Promise<MoneyMovementResult> {
    assertPositiveInt(input.amount);
    if (CREDIT_TYPES.has(input.type)) {
      throw AppError.internal('Invalid debit ledger type');
    }

    const existing = await walletsRepository.findLedgerByKey(input.idempotencyKey, tx);
    if (existing) return { entry: existing, replayed: true };

    const updated = await walletsRepository.debitIfSufficient(input.walletId, input.amount, tx);
    if (updated === 0) {
      const wallet = await walletsRepository.findById(input.walletId, tx);
      if (!wallet) throw WalletErrors.walletNotFound();
      throw WalletErrors.insufficientBalance({ balance: wallet.balance, required: input.amount });
    }

    const wallet = await walletsRepository.findById(input.walletId, tx);
    if (!wallet) throw WalletErrors.walletNotFound();

    const entry = await walletsRepository.createLedgerEntry(
      {
        walletId: input.walletId,
        type: input.type,
        amount: input.amount,
        balanceAfter: wallet.balance,
        idempotencyKey: input.idempotencyKey,
        ...(input.referenceType ? { referenceType: input.referenceType } : {}),
        ...(input.referenceId ? { referenceId: input.referenceId } : {}),
      },
      tx,
    );
    return { entry, replayed: false };
  }
}

export const walletsService = new WalletsService();
