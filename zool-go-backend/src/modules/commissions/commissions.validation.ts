import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/validation/common';

export const brokerCommissionsQuerySchema = paginationQuerySchema.extend({
  /** Defaults to UNSETTLED (open commissions); pass another status for history */
  status: z.enum(['UNSETTLED', 'RESERVED', 'SETTLED', 'CLAWED_BACK']).optional(),
});

export const adminCommissionsQuerySchema = paginationQuerySchema.extend({
  officeId: z.string().min(1).max(64).optional(),
  status: z.enum(['UNSETTLED', 'RESERVED', 'SETTLED', 'CLAWED_BACK']).optional(),
});

export const adminSettlementsQuerySchema = paginationQuerySchema.extend({
  officeId: z.string().min(1).max(64).optional(),
  status: z.enum(['DRAFT', 'FINALIZED', 'CANCELLED']).optional(),
});

export const createSettlementSchema = z.object({
  officeId: z.string().min(1).max(64),
  periodFrom: z.coerce.date(),
  periodTo: z.coerce.date(),
  note: z.string().trim().max(500).optional(),
});

export const finalizeSettlementSchema = z
  .object({
    payoutReference: z.string().trim().min(1).max(128).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .default({});

export const settlementIdParamsSchema = z.object({
  id: z.string().min(1).max(64),
});

export const settlementAccrualsQuerySchema = paginationQuerySchema;
