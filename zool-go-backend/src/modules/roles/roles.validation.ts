import { z } from 'zod';
import { isPermissionKey } from '../../shared/constants/permissions';

const permissionKeySchema = z.string().refine(isPermissionKey, {
  message: 'Unknown permission key',
});

export const createRoleSchema = z.object({
  key: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, 'Role key must be snake_case'),
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  permissionKeys: z.array(permissionKeySchema).default([]),
});

export const updateRoleSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const setRolePermissionsSchema = z.object({
  permissionKeys: z.array(permissionKeySchema),
});

export const roleIdParamsSchema = z.object({
  roleId: z.string().min(1),
});
