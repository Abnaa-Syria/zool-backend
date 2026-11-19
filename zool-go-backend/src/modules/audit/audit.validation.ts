import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/validation/common';

const dateInput = z
  .string()
  .refine((value) => !Number.isNaN(new Date(value).getTime()), 'Invalid date');

export const listAuditQuerySchema = paginationQuerySchema
  .extend({
    actorAdminId: z.string().min(1).max(64).optional(),
    action: z.string().trim().min(1).max(96).optional(),
    resourceType: z.string().trim().min(1).max(64).optional(),
    resourceId: z.string().trim().min(1).max(64).optional(),
    requestId: z.string().trim().min(1).max(64).optional(),
    from: dateInput.optional(),
    to: dateInput.optional(),
  })
  .refine((value) => {
    if (!value.from || !value.to) return true;
    return new Date(value.from).getTime() <= new Date(value.to).getTime();
  }, 'from must be before or equal to to');
