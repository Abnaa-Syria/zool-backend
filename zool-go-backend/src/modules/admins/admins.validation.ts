import { z } from 'zod';

export const createAdminSchema = z.object({
  displayName: z.string().min(2).max(160),
  employeeCode: z.string().min(2).max(64),
  phone: z.string().min(8).max(32),
  roleIds: z.array(z.string().min(1)).min(1),
});

export const adminIdParamsSchema = z.object({
  adminId: z.string().min(1),
});

export const updateAdminStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED']),
});

export const setAdminRolesSchema = z.object({
  roleIds: z.array(z.string().min(1)).min(1),
});

export const listAdminsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  /** Name, employee code or phone */
  q: z.string().trim().min(1).max(120).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
});

export const updateAdminProfileSchema = z
  .object({
    displayName: z.string().trim().min(2).max(160),
  })
  .strict();
