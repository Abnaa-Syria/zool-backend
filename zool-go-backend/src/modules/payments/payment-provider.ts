import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';

export interface CreateChargeInput {
  intentId: string;
  officeId: string;
  amount: number;
  currency: string;
}

export interface CreateChargeResult {
  providerRef: string;
}

export interface ConfirmChargeInput {
  intentId: string;
  providerRef: string | null;
}

export interface ConfirmChargeResult {
  confirmed: boolean;
  providerRef: string;
}

export interface ParsedWebhookEvent {
  providerEventId: string;
  intentId: string;
  amountMinor: number;
  currency: string;
  paymentReference: string | null;
  occurredAt: Date;
}

/** Port for payment service providers. Real PSP adapters implement this later. */
export interface PaymentProvider {
  readonly name: string;
  createCharge(input: CreateChargeInput): Promise<CreateChargeResult>;
  confirmCharge(input: ConfirmChargeInput): Promise<ConfirmChargeResult>;
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): ParsedWebhookEvent;
}

function signatureHeader(headers: Record<string, string | undefined>): string {
  return headers['x-payment-signature'] ?? headers['X-Payment-Signature'] ?? '';
}

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';

  async createCharge(_input: CreateChargeInput): Promise<CreateChargeResult> {
    return { providerRef: `mock_${randomUUID()}` };
  }

  async confirmCharge(input: ConfirmChargeInput): Promise<ConfirmChargeResult> {
    return { confirmed: true, providerRef: input.providerRef ?? `mock_${randomUUID()}` };
  }

  verifyWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): ParsedWebhookEvent {
    const secret = env().PAYMENT_WEBHOOK_SECRET;
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const provided = signatureHeader(headers);
    const expectedBuf = Buffer.from(expected, 'utf8');
    const providedBuf = Buffer.from(provided, 'utf8');
    if (
      expectedBuf.length !== providedBuf.length ||
      !timingSafeEqual(expectedBuf, providedBuf)
    ) {
      throw new AppError({
        message: 'Invalid payment webhook signature',
        statusCode: 401,
        code: ErrorCodes.WEBHOOK_SIGNATURE_INVALID,
      });
    }

    let parsed: {
      eventId?: string;
      intentId?: string;
      amountMinor?: number;
      currency?: string;
      paymentReference?: string | null;
      occurredAt?: string;
    };
    try {
      parsed = JSON.parse(rawBody.toString('utf8')) as typeof parsed;
    } catch {
      throw AppError.validation('Webhook body must be JSON');
    }

    if (!parsed.eventId || !parsed.intentId || typeof parsed.amountMinor !== 'number') {
      throw AppError.validation('Webhook payload is missing required fields');
    }

    const occurredAt = parsed.occurredAt ? new Date(parsed.occurredAt) : new Date();
    if (Number.isNaN(occurredAt.getTime())) {
      throw AppError.validation('Invalid occurredAt');
    }
    const ageMs = Math.abs(Date.now() - occurredAt.getTime());
    if (ageMs > env().PAYMENT_WEBHOOK_MAX_AGE_SECONDS * 1000) {
      throw new AppError({
        message: 'Webhook event timestamp is outside the allowed window',
        statusCode: 409,
        code: ErrorCodes.WEBHOOK_REPLAY,
      });
    }

    return {
      providerEventId: parsed.eventId,
      intentId: parsed.intentId,
      amountMinor: parsed.amountMinor,
      currency: (parsed.currency ?? 'SDG').toUpperCase(),
      paymentReference: parsed.paymentReference ?? null,
      occurredAt,
    };
  }
}

let override: PaymentProvider | null = null;

export function setPaymentProvider(provider: PaymentProvider | null): void {
  override = provider;
}

export function getPaymentProvider(): PaymentProvider {
  if (override) return override;
  const configured = env().PAYMENT_PROVIDER;
  switch (configured) {
    case 'mock':
      return new MockPaymentProvider();
    default:
      throw AppError.internal(`Unsupported payment provider: ${String(configured)}`);
  }
}
