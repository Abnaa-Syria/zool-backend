import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/validation/common';

const phoneSchema = z.string().min(8).max(32);

export const createBrokerOfficeSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'Code may contain letters, digits, - and _'),
  name: z.string().min(2).max(160),
  settlementPeriod: z.enum(['WEEKLY', 'MONTHLY']).optional(),
  minTopUpMinorOverride: z.number().int().positive().optional(),
  exposureCeilingOverride: z.number().int().positive().optional(),
  lowBalanceThresholdMinorOverride: z.number().int().nonnegative().optional(),
  timeZone: z.string().min(3).max(64).optional(),
  manager: z
    .object({
      displayName: z.string().min(2).max(160),
      phone: phoneSchema,
    })
    .optional(),
});

export const listBrokerOfficesQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  q: z.string().min(1).max(100).optional(),
});

export const officeIdParamsSchema = z.object({
  officeId: z.string().min(1).max(64),
});

export const officeStaffParamsSchema = z.object({
  officeId: z.string().min(1).max(64),
  employeeId: z.string().min(1).max(64),
});

const assignmentSchema = z.object({
  companyId: z.string().min(1).max(64),
  commissionPercent: z
    .number()
    .min(0)
    .max(100)
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, 'At most 2 decimal places'),
});

/** Accepts either a bare array or `{ assignments: [...] }`. */
export const replaceAssignmentsSchema = z
  .union([z.array(assignmentSchema), z.object({ assignments: z.array(assignmentSchema) })])
  .transform((value) => ({ assignments: Array.isArray(value) ? value : value.assignments }));

export const updateOfficeStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED']),
});

export const updateOfficePolicySchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    settlementPeriod: z.enum(['WEEKLY', 'MONTHLY']).optional(),
    minTopUpMinorOverride: z.number().int().positive().nullable().optional(),
    exposureCeilingOverride: z.number().int().positive().nullable().optional(),
    lowBalanceThresholdMinorOverride: z.number().int().nonnegative().nullable().optional(),
    timeZone: z.string().min(3).max(64).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'At least one policy field is required');
