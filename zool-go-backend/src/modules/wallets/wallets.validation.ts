import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/validation/common';

export const ledgerQuerySchema = paginationQuerySchema;

export const officeIdParamsSchema = z.object({
  officeId: z.string().min(1).max(64),
});

const booleanQuery = z
  .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0'), z.boolean()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (typeof value === 'boolean') return value;
    return value === 'true' || value === '1';
  });

export const adminWalletListQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(120).optional(),
  officeStatus: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  lowBalance: booleanQuery,
  sort: z.enum(['balanceMinor', 'updatedAt', 'officeCode', 'officeName']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});
