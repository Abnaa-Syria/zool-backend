import { z } from 'zod';

const dateInput = z
  .string()
  .refine((v) => !Number.isNaN(new Date(v).getTime()), 'Invalid date');

export const reportsRangeQuerySchema = z.object({
  from: dateInput.optional(),
  to: dateInput.optional(),
});
