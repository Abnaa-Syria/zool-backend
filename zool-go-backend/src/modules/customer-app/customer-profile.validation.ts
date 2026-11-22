import { z } from 'zod';

export const updateCustomerMeSchema = z
  .object({
    displayName: z.string().trim().min(2).max(160).optional(),
    email: z.string().trim().email().max(191).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const updateCustomerPreferencesSchema = z
  .object({
    language: z.enum(['ar', 'en']).optional(),
    tripAlerts: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
