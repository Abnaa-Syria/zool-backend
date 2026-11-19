import {
  Prisma,
  TopUpConfirmationPath,
  TopUpIntentStatus,
} from '@prisma/client';
import { getPrisma, type PrismaTx } from '../../infrastructure/database/prisma';

function client(tx?: PrismaTx) {
  return tx ?? getPrisma();
}

export const intentInclude = {
  evidence: true,
} satisfies Prisma.TopUpIntentInclude;

export class PaymentsRepository {
  findByStoredKey(idempotencyKey: string, tx?: PrismaTx) {
    return client(tx).topUpIntent.findUnique({
      where: { idempotencyKey },
      include: intentInclude,
    });
  }

  findById(intentId: string, tx?: PrismaTx) {
    return client(tx).topUpIntent.findUnique({
      where: { id: intentId },
      include: intentInclude,
    });
  }

  findByIdForOffice(intentId: string, officeId: string, tx?: PrismaTx) {
    return client(tx).topUpIntent.findFirst({
      where: { id: intentId, brokerOfficeId: officeId },
      include: intentInclude,
    });
  }

  findByProviderEventId(providerEventId: string, tx?: PrismaTx) {
    return client(tx).topUpIntent.findUnique({ where: { providerEventId } });
  }

  async lockIntent(intentId: string, tx: PrismaTx): Promise<void> {
    await tx.$queryRaw`SELECT id FROM top_up_intents WHERE id = ${intentId} FOR UPDATE`;
  }

  create(
    data: {
      brokerOfficeId: string;
      walletId: string;
      amount: number;
      provider: string;
      idempotencyKey: string;
      confirmationPath?: TopUpConfirmationPath;
      status?: TopUpIntentStatus;
      createdByEmployeeId?: string;
      createdByAdminId?: string;
      parentIntentId?: string;
      paymentReferenceNormalized?: string;
    },
    tx?: PrismaTx,
  ) {
    return client(tx).topUpIntent.create({ data, include: intentInclude });
  }

  setProviderRef(intentId: string, providerRef: string, tx?: PrismaTx) {
    return client(tx).topUpIntent.update({
      where: { id: intentId },
      data: { providerRef },
      include: intentInclude,
    });
  }

  async markConfirmed(
    intentId: string,
    data: { providerRef?: string | null; providerEventId?: string | null; confirmationPath?: TopUpConfirmationPath },
    tx: PrismaTx,
  ): Promise<number> {
    const result = await tx.topUpIntent.updateMany({
      where: {
        id: intentId,
        status: { in: [TopUpIntentStatus.PENDING, TopUpIntentStatus.PENDING_REVIEW] },
      },
      data: {
        status: TopUpIntentStatus.CONFIRMED,
        confirmedAt: new Date(),
        ...(data.providerRef !== undefined ? { providerRef: data.providerRef } : {}),
        ...(data.providerEventId !== undefined ? { providerEventId: data.providerEventId } : {}),
        ...(data.confirmationPath ? { confirmationPath: data.confirmationPath } : {}),
      },
    });
    return result.count;
  }

  markFailed(intentId: string, tx: PrismaTx) {
    return tx.topUpIntent.update({
      where: { id: intentId },
      data: { status: TopUpIntentStatus.FAILED, failedAt: new Date() },
      include: intentInclude,
    });
  }

  markPendingReview(
    intentId: string,
    data: { paymentReferenceNormalized: string; confirmationPath: TopUpConfirmationPath },
    tx?: PrismaTx,
  ) {
    return client(tx).topUpIntent.update({
      where: { id: intentId },
      data: {
        status: TopUpIntentStatus.PENDING_REVIEW,
        confirmationPath: data.confirmationPath,
        paymentReferenceNormalized: data.paymentReferenceNormalized,
      },
      include: intentInclude,
    });
  }

  createEvidence(
    data: {
      intentId: string;
      storageKey: string;
      originalName: string;
      mimeType: string;
      sizeBytes: number;
      checksumSha256: string;
      uploadedByAdminId?: string;
      uploadedByEmployeeId?: string;
    },
    tx?: PrismaTx,
  ) {
    return client(tx).topUpEvidence.create({ data });
  }

  findOffice(officeId: string, tx?: PrismaTx) {
    return client(tx).brokerOffice.findUnique({ where: { id: officeId } });
  }

  async list(params: {
    where: Prisma.TopUpIntentWhereInput;
    skip: number;
    take: number;
  }) {
    const [items, total] = await Promise.all([
      getPrisma().topUpIntent.findMany({
        where: params.where,
        include: intentInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: params.skip,
        take: params.take,
      }),
      getPrisma().topUpIntent.count({ where: params.where }),
    ]);
    return { items, total };
  }
}

export const paymentsRepository = new PaymentsRepository();
