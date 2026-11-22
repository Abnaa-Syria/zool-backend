import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/validation/common';

export const createCarrierSchema = z.object({
  key: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, 'Key must be snake_case'),
  name: z.string().min(2).max(160),
  /** D-CARRIER-PORTAL-01: first portal account (company manager) */
  manager: z.object({ displayName: z.string().trim().min(2).max(160), phone: z.string().trim().min(6).max(32) }).strict().optional(),
});

/** D-REV-02 per-carrier settlement configuration */
export const carrierBillingSchema = {
  platformFeeType: z.enum(['NONE', 'PERCENT', 'FIXED']).optional(),
  /** PERCENT: basis points (500 = 5%); FIXED: minor units per ticket */
  platformFeeValue: z.number().int().min(0).max(100_000_000).optional(),
  brokerCommissionBearer: z.enum(['CARRIER', 'PLATFORM']).optional(),
};

const staffFlags = z
  .object({ canManageFleet: z.boolean().optional(), canManageSchedule: z.boolean().optional(), canViewFinance: z.boolean().optional(), canManageStaff: z.boolean().optional() })
  .strict();
export const createCarrierStaffSchema = z
  .object({ displayName: z.string().trim().min(2).max(160), phone: z.string().trim().min(6).max(32), role: z.enum(['MANAGER', 'STAFF']).optional(), flags: staffFlags.optional() })
  .strict();
export const patchCarrierStaffSchema = z
  .object({ displayName: z.string().trim().min(2).max(160).optional(), role: z.enum(['MANAGER', 'STAFF']).optional(), status: z.enum(['ACTIVE', 'SUSPENDED']).optional(), flags: staffFlags.optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export const staffParamsSchema = z.object({ companyId: z.string().min(1).max(64), employeeId: z.string().min(1).max(64) });

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
    ...carrierBillingSchema,
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' });

export const affectedTripsQuerySchema = paginationQuerySchema;
