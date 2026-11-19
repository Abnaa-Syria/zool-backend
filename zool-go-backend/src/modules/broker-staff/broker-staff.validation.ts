import { z } from 'zod';

const phoneSchema = z.string().min(8).max(32);

export const createStaffSchema = z.object({
  displayName: z.string().min(2).max(160),
  phone: phoneSchema,
  canBook: z.boolean().default(true),
  canTopUp: z.boolean().default(false),
  canViewReports: z.boolean().default(false),
  canManageStaff: z.boolean().default(false),
});

export const updateStaffSchema = z
  .object({
    displayName: z.string().min(2).max(160).optional(),
    canBook: z.boolean().optional(),
    canTopUp: z.boolean().optional(),
    canViewReports: z.boolean().optional(),
    canManageStaff: z.boolean().optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'At least one field must be provided',
  });

export const employeeIdParamsSchema = z.object({
  employeeId: z.string().min(1).max(64),
});
