import {
  Prisma,
  TopUpConfirmationPath,
  TopUpIntentStatus,
  WalletLedgerType,
  type TopUpEvidence,
  type TopUpIntent,
} from '@prisma/client';
import { env } from '../../config/env';
import { getPrisma } from '../../infrastructure/database/prisma';
import {
  assertReceiptSize,
  checksumSha256,
  detectReceiptMime,
  getStorageProvider,
  newReceiptStorageKey,
} from '../../infrastructure/storage';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import { paginationMeta, parsePagination } from '../../shared/utils/pagination';
import { resolveOfficePolicy } from '../../shared/utils/office-policy';
import { normalizePaymentReference } from '../../shared/utils/payment-reference';
import { auditService } from '../audit/audit.service';
import { WalletErrors } from '../wallets/wallets.errors';
import { walletsRepository } from '../wallets/wallets.repository';
import { walletsService } from '../wallets/wallets.service';
import { getPaymentProvider } from './payment-provider';
import { paymentsRepository } from './payments.repository';

export interface TopUpIntentDto {
  id: string;
  officeId: string;
  amountMinor: number;
  status: TopUpIntentStatus;
  confirmationPath: TopUpConfirmationPath;
  provider: string;
  providerRef: string | null;
  paymentReferenceNormalized: string | null;
  idempotencyKey: string;
  hasEvidence: boolean;
  /** Office note on the receipt, or the platform's rejection note */
  note: string | null;
  createdAt: string;
  confirmedAt: string | null;
  failedAt: string | null;
  /** True only in non-production with the mock provider while the intent is still PENDING */
  mockConfirmAvailable: boolean;
}

function storedKey(officeId: string, idempotencyKey: string): string {
  return `${officeId}:${idempotencyKey}`;
}

function toDto(intent: TopUpIntent & { evidence?: TopUpEvidence[] }): TopUpIntentDto {
  const prefix = `${intent.brokerOfficeId}:`;
  return {
    id: intent.id,
    officeId: intent.brokerOfficeId,
    amountMinor: intent.amount,
    status: intent.status,
    confirmationPath: intent.confirmationPath,
    provider: intent.provider,
    providerRef: intent.providerRef,
    paymentReferenceNormalized: intent.paymentReferenceNormalized,
    idempotencyKey: intent.idempotencyKey.startsWith(prefix)
      ? intent.idempotencyKey.slice(prefix.length)
      : intent.idempotencyKey,
    hasEvidence: (intent.evidence?.length ?? 0) > 0,
    note: intent.reviewNote,
    createdAt: intent.createdAt.toISOString(),
    confirmedAt: intent.confirmedAt?.toISOString() ?? null,
    failedAt: intent.failedAt?.toISOString() ?? null,
    mockConfirmAvailable:
      isMockPaymentEnabled() && intent.provider === 'mock' && intent.status === TopUpIntentStatus.PENDING,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function assertSdg(currency: string): void {
  if (currency !== 'SDG') {
    throw new AppError({
      message: 'Only SDG wallets are supported in M1',
      statusCode: 409,
      code: ErrorCodes.UNSUPPORTED_CURRENCY,
      details: { currency },
    });
  }
}

export function isMockPaymentEnabled(): boolean {
  const e = env();
  return e.PAYMENT_PROVIDER === 'mock' && e.NODE_ENV !== 'production';
}

export class PaymentsService {
  async createTopUp(input: {
    officeId: string;
    employeeId: string;
    amountMinor: number;
    idempotencyKey: string;
    requestId?: string;
  }): Promise<{ intent: TopUpIntentDto; created: boolean }> {
    const key = storedKey(input.officeId, input.idempotencyKey);
    const replay = await paymentsRepository.findByStoredKey(key);
    if (replay) return this.replayOrConflict(replay, input);

    const office = await paymentsRepository.findOffice(input.officeId);
    if (!office) throw AppError.notFound('Broker office not found');
    const minAmount = resolveOfficePolicy(office).minTopUpMinor;
    if (input.amountMinor < minAmount) {
      throw new AppError({
        message: `Top-up amount is below the minimum of ${minAmount}`,
        statusCode: 422,
        code: ErrorCodes.TOP_UP_BELOW_MINIMUM,
        details: { minTopUpMinor: minAmount, amountMinor: input.amountMinor },
      });
    }

    const wallet = await walletsRepository.findByOfficeId(input.officeId);
    if (!wallet) throw WalletErrors.walletNotFound();
    assertSdg(wallet.currency);

    const provider = getPaymentProvider();
    try {
      const created = await paymentsRepository.create({
        brokerOfficeId: input.officeId,
        walletId: wallet.id,
        amount: input.amountMinor,
        provider: provider.name,
        idempotencyKey: key,
        confirmationPath: TopUpConfirmationPath.AUTOMATIC,
        createdByEmployeeId: input.employeeId,
      });
      const charge = await provider.createCharge({
        intentId: created.id,
        officeId: input.officeId,
        amount: input.amountMinor,
        currency: wallet.currency,
      });
      const intent = await paymentsRepository.setProviderRef(created.id, charge.providerRef);
      await auditService.record({
        action: 'wallet.topup.created',
        resourceType: 'top_up_intent',
        resourceId: intent.id,
        requestId: input.requestId,
        metadata: { officeId: input.officeId, employeeId: input.employeeId, amountMinor: input.amountMinor },
      });
      return { intent: toDto(intent), created: true };
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await paymentsRepository.findByStoredKey(key);
        if (existing) return this.replayOrConflict(existing, input);
      }
      throw error;
    }
  }

  private replayOrConflict(
    existing: TopUpIntent,
    input: { officeId: string; amountMinor: number },
  ): { intent: TopUpIntentDto; created: boolean } {
    if (existing.brokerOfficeId !== input.officeId || existing.amount !== input.amountMinor) {
      throw AppError.conflict('Idempotency key was already used with a different request');
    }
    return { intent: toDto(existing), created: false };
  }

  async mockConfirm(input: {
    officeId: string;
    employeeId: string;
    intentId: string;
    requestId?: string;
  }) {
    if (!isMockPaymentEnabled()) {
      throw new AppError({
        message: 'Mock payment confirmation is disabled',
        statusCode: 403,
        code: ErrorCodes.MOCK_PAYMENT_DISABLED,
      });
    }
    const provider = getPaymentProvider();
    const confirmation = await provider.confirmCharge({
      intentId: input.intentId,
      providerRef: null,
    });
    return this.creditConfirmedIntent({
      intentId: input.intentId,
      officeId: input.officeId,
      confirmationPath: TopUpConfirmationPath.AUTOMATIC,
      providerRef: confirmation.providerRef,
      requestId: input.requestId,
      actor: { employeeId: input.employeeId },
    });
  }

  async handleWebhook(providerName: string, rawBody: Buffer, headers: Record<string, string | undefined>) {
    const provider = getPaymentProvider();
    if (provider.name !== providerName) {
      throw AppError.validation(`Unknown or unconfigured payment provider: ${providerName}`);
    }
    const event = provider.verifyWebhook(rawBody, headers);

    const existingEvent = await paymentsRepository.findByProviderEventId(event.providerEventId);
    if (existingEvent) {
      if (existingEvent.status === TopUpIntentStatus.CONFIRMED) {
        const wallet = await walletsRepository.findById(existingEvent.walletId);
        return { intent: toDto(existingEvent), balanceMinor: wallet?.balance ?? 0, replayed: true };
      }
      throw new AppError({
        message: 'Provider event already recorded',
        statusCode: 409,
        code: ErrorCodes.WEBHOOK_REPLAY,
      });
    }

    const intent = await paymentsRepository.findById(event.intentId);
    if (!intent) throw AppError.notFound('Top-up intent not found');

    try {
      const attached = await getPrisma().topUpIntent.updateMany({
        where: { id: intent.id, providerEventId: null },
        data: { providerEventId: event.providerEventId },
      });
      if (attached.count === 0) {
        const again = await paymentsRepository.findByProviderEventId(event.providerEventId);
        if (again?.status === TopUpIntentStatus.CONFIRMED) {
          const wallet = await walletsRepository.findById(again.walletId);
          return { intent: toDto(again), balanceMinor: wallet?.balance ?? 0, replayed: true };
        }
        throw new AppError({
          message: 'Provider event already recorded',
          statusCode: 409,
          code: ErrorCodes.WEBHOOK_REPLAY,
        });
      }
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError({
          message: 'Provider event already recorded',
          statusCode: 409,
          code: ErrorCodes.WEBHOOK_REPLAY,
        });
      }
      throw error;
    }

    if (event.currency !== 'SDG' || event.amountMinor !== intent.amount) {
      await paymentsRepository.markFailed(intent.id, getPrisma());
      throw new AppError({
        message: 'Webhook amount or currency does not match the intent',
        statusCode: 409,
        code: ErrorCodes.PAYMENT_MISMATCH,
        details: {
          expectedAmountMinor: intent.amount,
          eventAmountMinor: event.amountMinor,
          currency: event.currency,
        },
      });
    }

    const eventRef = normalizePaymentReference(event.paymentReference);
    if (
      intent.paymentReferenceNormalized &&
      eventRef &&
      intent.paymentReferenceNormalized !== eventRef
    ) {
      await paymentsRepository.markFailed(intent.id, getPrisma());
      throw new AppError({
        message: 'Webhook payment reference does not match the intent',
        statusCode: 409,
        code: ErrorCodes.PAYMENT_MISMATCH,
      });
    }

    return this.creditConfirmedIntent({
      intentId: intent.id,
      officeId: intent.brokerOfficeId,
      confirmationPath: TopUpConfirmationPath.AUTOMATIC,
      providerRef: intent.providerRef,
      providerEventId: event.providerEventId,
      paymentReferenceNormalized: eventRef ?? intent.paymentReferenceNormalized,
      requestId: event.providerEventId,
      actor: {},
    });
  }

  async submitEvidence(input: {
    intentId: string;
    officeId: string;
    paymentReference: string;
    note?: string;
    file: { buffer: Buffer; originalName: string };
    employeeId?: string;
    adminId?: string;
    requestId?: string;
  }) {
    const intent = await paymentsRepository.findByIdForOffice(input.intentId, input.officeId);
    if (!intent) throw AppError.notFound('Top-up intent not found');
    if (
      intent.status === TopUpIntentStatus.CONFIRMED ||
      intent.status === TopUpIntentStatus.PENDING_REVIEW
    ) {
      throw new AppError({
        message: 'This top-up is not eligible for evidence submission',
        statusCode: 409,
        code: ErrorCodes.TOP_UP_NOT_REVIEWABLE,
        details: { status: intent.status },
      });
    }

    const reference = normalizePaymentReference(input.paymentReference);
    if (!reference) throw AppError.validation('paymentReference is required');

    const duplicate = await getPrisma().topUpIntent.findFirst({
      where: {
        provider: intent.provider,
        paymentReferenceNormalized: reference,
        NOT: { id: intent.id },
      },
    });
    if (duplicate) throw AppError.conflict('This payment reference was already used');

    const stored = await this.storeReceipt(input.file);
    try {
      const updated = await getPrisma().$transaction(async (tx) => {
        await paymentsRepository.lockIntent(intent.id, tx);
        const current = await paymentsRepository.findById(intent.id, tx);
        if (!current) throw AppError.notFound('Top-up intent not found');
        const reviewed = await paymentsRepository.markPendingReview(
          intent.id,
          { paymentReferenceNormalized: reference, confirmationPath: TopUpConfirmationPath.MANUAL_FALLBACK },
          tx,
        );
        await paymentsRepository.createEvidence(
          {
            intentId: intent.id,
            storageKey: stored.key,
            originalName: input.file.originalName.slice(0, 255),
            mimeType: stored.mimeType,
            sizeBytes: stored.sizeBytes,
            checksumSha256: stored.checksum,
            ...(input.adminId ? { uploadedByAdminId: input.adminId } : {}),
            ...(input.employeeId ? { uploadedByEmployeeId: input.employeeId } : {}),
          },
          tx,
        );
        if (input.note) {
          await tx.topUpIntent.update({
            where: { id: intent.id },
            data: { reviewNote: input.note.slice(0, 500) },
          });
        }
        // Re-read so the response includes the evidence just stored (hasEvidence = true).
        return (await paymentsRepository.findById(reviewed.id, tx)) ?? reviewed;
      });
      await auditService.record({
        action: 'wallet.topup.evidence_submitted',
        resourceType: 'top_up_intent',
        resourceId: intent.id,
        requestId: input.requestId,
        metadata: { officeId: input.officeId, employeeId: input.employeeId, adminId: input.adminId },
      });
      return toDto(updated);
    } catch (error) {
      await getStorageProvider().delete(stored.key).catch(() => undefined);
      if (isUniqueViolation(error)) {
        throw AppError.conflict('This payment reference was already used');
      }
      throw error;
    }
  }

  async adminCreate(input: {
    officeId: string;
    amountMinor: number;
    paymentReference: string;
    note?: string;
    parentIntentId?: string;
    file: { buffer: Buffer; originalName: string };
    adminId: string;
    requestId?: string;
  }) {
    if (input.parentIntentId) {
      return this.submitEvidence({
        intentId: input.parentIntentId,
        officeId: input.officeId,
        paymentReference: input.paymentReference,
        note: input.note,
        file: input.file,
        adminId: input.adminId,
        requestId: input.requestId,
      });
    }

    const office = await paymentsRepository.findOffice(input.officeId);
    if (!office) throw AppError.notFound('Broker office not found');
    const minAmount = resolveOfficePolicy(office).minTopUpMinor;
    if (input.amountMinor < minAmount) {
      throw new AppError({
        message: `Top-up amount is below the minimum of ${minAmount}`,
        statusCode: 422,
        code: ErrorCodes.TOP_UP_BELOW_MINIMUM,
        details: { minTopUpMinor: minAmount, amountMinor: input.amountMinor },
      });
    }
    const wallet = await walletsRepository.findByOfficeId(input.officeId);
    if (!wallet) throw WalletErrors.walletNotFound();
    assertSdg(wallet.currency);

    const reference = normalizePaymentReference(input.paymentReference);
    if (!reference) throw AppError.validation('paymentReference is required');

    const stored = await this.storeReceipt(input.file);
    try {
      const created = await getPrisma().$transaction(async (tx) => {
        const intent = await paymentsRepository.create(
          {
            brokerOfficeId: input.officeId,
            walletId: wallet.id,
            amount: input.amountMinor,
            provider: 'bank_transfer',
            idempotencyKey: `admin:${input.officeId}:${reference}:${input.amountMinor}`,
            confirmationPath: TopUpConfirmationPath.MANUAL_FALLBACK,
            status: TopUpIntentStatus.PENDING_REVIEW,
            createdByAdminId: input.adminId,
            paymentReferenceNormalized: reference,
          },
          tx,
        );
        await paymentsRepository.createEvidence(
          {
            intentId: intent.id,
            storageKey: stored.key,
            originalName: input.file.originalName.slice(0, 255),
            mimeType: stored.mimeType,
            sizeBytes: stored.sizeBytes,
            checksumSha256: stored.checksum,
            uploadedByAdminId: input.adminId,
          },
          tx,
        );
        if (input.note) {
          await tx.topUpIntent.update({
            where: { id: intent.id },
            data: { reviewNote: input.note.slice(0, 500) },
          });
        }
        return intent;
      });
      await auditService.record({
        actorAdminId: input.adminId,
        action: 'wallet.topup.admin_created',
        resourceType: 'top_up_intent',
        resourceId: created.id,
        requestId: input.requestId,
        metadata: { officeId: input.officeId, amountMinor: input.amountMinor },
      });
      return toDto(created);
    } catch (error) {
      await getStorageProvider().delete(stored.key).catch(() => undefined);
      if (isUniqueViolation(error)) {
        throw AppError.conflict('This payment reference was already used');
      }
      throw error;
    }
  }

  /** Office's own top-up requests (status history incl. pending review and rejections). */
  async listForOffice(officeId: string, query: { page?: number; pageSize?: number; status?: TopUpIntentStatus }) {
    return this.listAdmin({ ...query, officeId });
  }

  async getForOffice(officeId: string, intentId: string) {
    const intent = await paymentsRepository.findByIdForOffice(intentId, officeId);
    if (!intent) throw AppError.notFound('Top-up intent not found');
    return toDto(intent);
  }

  async listAdmin(query: {
    page?: number;
    pageSize?: number;
    officeId?: string;
    status?: TopUpIntentStatus;
  }) {
    const { page, pageSize, skip, take } = parsePagination(query);
    const where: Prisma.TopUpIntentWhereInput = {
      ...(query.officeId ? { brokerOfficeId: query.officeId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const { items, total } = await paymentsRepository.list({ where, skip, take });
    return { items: items.map(toDto), meta: paginationMeta(page, pageSize, total) };
  }

  async approve(input: { intentId: string; adminId: string; requestId?: string }) {
    const intent = await paymentsRepository.findById(input.intentId);
    if (!intent) throw AppError.notFound('Top-up intent not found');
    if (intent.status === TopUpIntentStatus.CONFIRMED) {
      const wallet = await walletsRepository.findById(intent.walletId);
      return { intent: toDto(intent), balanceMinor: wallet?.balance ?? 0, replayed: true };
    }
    if (intent.status !== TopUpIntentStatus.PENDING_REVIEW) {
      throw new AppError({
        message: 'Only pending-review top-ups can be approved',
        statusCode: 409,
        code: ErrorCodes.TOP_UP_NOT_REVIEWABLE,
        details: { status: intent.status },
      });
    }
    if (!intent.evidence?.length) {
      throw AppError.validation('Evidence file is required before approval');
    }
    const result = await this.creditConfirmedIntent({
      intentId: intent.id,
      officeId: intent.brokerOfficeId,
      confirmationPath: TopUpConfirmationPath.MANUAL_FALLBACK,
      requestId: input.requestId,
      actor: { adminId: input.adminId },
    });
    await getPrisma().topUpIntent.update({
      where: { id: intent.id },
      data: { reviewedByAdminId: input.adminId },
    });
    return result;
  }

  async reject(input: { intentId: string; adminId: string; note?: string; requestId?: string }) {
    const intent = await paymentsRepository.findById(input.intentId);
    if (!intent) throw AppError.notFound('Top-up intent not found');
    if (intent.status === TopUpIntentStatus.FAILED) {
      return { intent: toDto(intent), replayed: true };
    }
    if (intent.status !== TopUpIntentStatus.PENDING_REVIEW) {
      throw new AppError({
        message: 'Only pending-review top-ups can be rejected',
        statusCode: 409,
        code: ErrorCodes.TOP_UP_NOT_REVIEWABLE,
      });
    }
    const updated = await getPrisma().$transaction(async (tx) => {
      await paymentsRepository.lockIntent(intent.id, tx);
      return tx.topUpIntent.update({
        where: { id: intent.id },
        data: {
          status: TopUpIntentStatus.FAILED,
          failedAt: new Date(),
          reviewedByAdminId: input.adminId,
          ...(input.note ? { reviewNote: input.note.slice(0, 500) } : {}),
        },
        include: { evidence: true },
      });
    });
    await auditService.record({
      actorAdminId: input.adminId,
      action: 'wallet.topup.rejected',
      resourceType: 'top_up_intent',
      resourceId: intent.id,
      requestId: input.requestId,
    });
    return { intent: toDto(updated), replayed: false };
  }

  async getEvidence(intentId: string) {
    const intent = await paymentsRepository.findById(intentId);
    if (!intent) throw AppError.notFound('Top-up intent not found');
    const file = intent.evidence[0];
    if (!file) throw AppError.notFound('Evidence not found');
    const buffer = await getStorageProvider().get(file.storageKey);
    return {
      buffer,
      mimeType: file.mimeType,
      filename: file.originalName,
    };
  }

  private async storeReceipt(file: { buffer: Buffer; originalName: string }) {
    assertReceiptSize(file.buffer);
    const mimeType = detectReceiptMime(file.buffer);
    const key = newReceiptStorageKey();
    await getStorageProvider().put({ key, body: file.buffer, contentType: mimeType });
    return {
      key,
      mimeType,
      sizeBytes: file.buffer.length,
      checksum: checksumSha256(file.buffer),
    };
  }

  private async creditConfirmedIntent(input: {
    intentId: string;
    officeId: string;
    confirmationPath: TopUpConfirmationPath;
    providerRef?: string | null;
    providerEventId?: string;
    paymentReferenceNormalized?: string | null;
    requestId?: string;
    actor: { employeeId?: string; adminId?: string };
  }) {
    const result = await getPrisma().$transaction(async (tx) => {
      await paymentsRepository.lockIntent(input.intentId, tx);
      const intent = await paymentsRepository.findById(input.intentId, tx);
      if (!intent || intent.brokerOfficeId !== input.officeId) {
        throw AppError.notFound('Top-up intent not found');
      }
      await walletsService.lock(intent.walletId, tx);

      if (intent.status === TopUpIntentStatus.CONFIRMED) {
        const wallet = await walletsRepository.findById(intent.walletId, tx);
        return { intent, balance: wallet?.balance ?? 0, replayed: true };
      }

      if (input.paymentReferenceNormalized) {
        await tx.topUpIntent.update({
          where: { id: intent.id },
          data: { paymentReferenceNormalized: input.paymentReferenceNormalized },
        });
      }

      const updated = await paymentsRepository.markConfirmed(
        intent.id,
        {
          providerRef: input.providerRef ?? intent.providerRef,
          providerEventId: input.providerEventId,
          confirmationPath: input.confirmationPath,
        },
        tx,
      );
      if (updated === 0) {
        const again = await paymentsRepository.findById(intent.id, tx);
        if (again?.status === TopUpIntentStatus.CONFIRMED) {
          const wallet = await walletsRepository.findById(intent.walletId, tx);
          return { intent: again, balance: wallet?.balance ?? 0, replayed: true };
        }
        throw AppError.conflict('Top-up intent can no longer be confirmed');
      }

      const { entry } = await walletsService.credit(tx, {
        walletId: intent.walletId,
        amount: intent.amount,
        type: WalletLedgerType.CREDIT_TOPUP,
        idempotencyKey: `topup:${intent.id}`,
        referenceType: 'top_up_intent',
        referenceId: intent.id,
      });

      const confirmed = await paymentsRepository.findById(intent.id, tx);
      await auditService.record(
        {
          actorAdminId: input.actor.adminId,
          action: 'wallet.topup.confirmed',
          resourceType: 'top_up_intent',
          resourceId: intent.id,
          requestId: input.requestId,
          metadata: {
            officeId: input.officeId,
            employeeId: input.actor.employeeId,
            amountMinor: intent.amount,
            confirmationPath: input.confirmationPath,
            balanceAfter: entry.balanceAfter,
          },
        },
        tx,
      );
      return { intent: confirmed ?? intent, balance: entry.balanceAfter, replayed: false };
    });

    return {
      intent: toDto(result.intent),
      balanceMinor: result.balance,
      replayed: result.replayed,
    };
  }
}

export const paymentsService = new PaymentsService();
