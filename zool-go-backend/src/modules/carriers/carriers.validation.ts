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
    /** D-SUS-01: SUSPENDED stops sales immediately and releases seat holds */
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
    shortName: z.string().trim().min(1).max(80).nullable().optional(),
    legalName: z.string().trim().min(2).max(200).nullable().optional(),
    logoUrl: z.string().url().max(512).nullable().optional(),
    /** D-CASH-01 per-carrier switch */
    cashEnabled: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' });

export const affectedTripsQuerySchema = paginationQuerySchema;
