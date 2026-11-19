import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/validation/common';

export const createCarrierSchema = z.object({
  key: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, 'Key must be snake_case'),
  name: z.string().min(2).max(160),
});

export const listCarriersQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  q: z.string().trim().min(1).max(120).optional(),
});

export const companyIdParamsSchema = z.object({
  companyId: z.string().min(1).max(64),
});

export const patchCarrierSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.status !== undefined, {
    message: 'At least one of name or status is required',
  });
