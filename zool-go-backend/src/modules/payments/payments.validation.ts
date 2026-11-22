import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/validation/common';

export const createTopUpSchema = z.object({
  amountMinor: z.number().int().positive().max(1_000_000_000),
  idempotencyKey: z.string().min(1).max(64),
});

export const intentIdParamsSchema = z.object({
  intentId: z.string().min(1).max(64),
});

export const providerParamsSchema = z.object({
  provider: z.string().min(1).max(64),
});

export const officeIdParamsSchema = z.object({
  officeId: z.string().min(1).max(64),
});

export const adminTopUpsQuerySchema = paginationQuerySchema.extend({
  officeId: z.string().min(1).max(64).optional(),
  status: z.enum(['PENDING', 'PENDING_REVIEW', 'CONFIRMED', 'FAILED']).optional(),
});

export const brokerTopUpsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['PENDING', 'PENDING_REVIEW', 'CONFIRMED', 'FAILED']).optional(),
});

export const rejectTopUpSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

/** Approve never accepts or changes the credited amount. */
export const approveTopUpSchema = z
  .object({
    amount: z.never().optional(),
    amountMinor: z.never().optional(),
  })
  .strict()
  .default({});
