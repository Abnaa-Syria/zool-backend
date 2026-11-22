import { z } from 'zod';
import { isoDateSchema, paginationQuerySchema } from '../../shared/validation/common';

const seatLabelsSchema = z
  .array(z.string().trim().min(1).max(32))
  .min(1)
  .max(200)
  .refine(
    (labels) => new Set(labels.map((l) => l.toLowerCase())).size === labels.length,
    'seatLabels must be unique',
  );

export const createTripSchema = z.object({
  companyId: z.string().min(1).max(64),
  origin: z.string().trim().min(2).max(120),
  destination: z.string().trim().min(2).max(120),
  departureAt: z.coerce.date(),
  basePrice: z.number().int().positive().max(1_000_000_000),
  seatLabels: seatLabelsSchema,
});

export const patchTripSchema = z
  .object({
    origin: z.string().trim().min(2).max(120).optional(),
    destination: z.string().trim().min(2).max(120).optional(),
    departureAt: z.coerce.date().optional(),
    basePrice: z.number().int().positive().max(1_000_000_000).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');

export const appendSeatsSchema = z.object({
  seatLabels: seatLabelsSchema,
});

export const adminTripsQuerySchema = paginationQuerySchema.extend({
  companyId: z.string().min(1).max(64).optional(),
  origin: z.string().min(1).max(120).optional(),
  destination: z.string().min(1).max(120).optional(),
  date: isoDateSchema.optional(),
  /** Sudan calendar days, inclusive; ignored when `date` is set */
  dateFrom: isoDateSchema.optional(),
  dateTo: isoDateSchema.optional(),
  status: z.enum(['SCHEDULED', 'BOARDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
  routeId: z.string().min(1).max(64).optional(),
  vehicleId: z.string().min(1).max(64).optional(),
  driverId: z.string().min(1).max(64).optional(),
  /** Trip number contains */
  q: z.string().trim().min(1).max(64).optional(),
});

export const brokerTripsQuerySchema = paginationQuerySchema
  .extend({
    origin: z.string().min(1).max(120).optional(),
    destination: z.string().min(1).max(120).optional(),
    date: isoDateSchema.optional(),
    dateFrom: isoDateSchema.optional(),
    dateTo: isoDateSchema.optional(),
  })
  .superRefine((q, ctx) => {
    if (q.dateFrom && q.dateTo && q.dateFrom > q.dateTo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'dateFrom must be on or before dateTo',
        path: ['dateFrom'],
      });
    }
  });

export const tripIdParamsSchema = z.object({
  tripId: z.string().min(1).max(64),
});

export const createHoldsSchema = z
  .object({
    mode: z.enum(['MANUAL', 'AUTO']).optional(),
    seatIds: z.array(z.string().min(1).max(64)).min(1).max(20).optional(),
    seatCount: z.number().int().min(1).max(20).optional(),
  })
  .superRefine((value, ctx) => {
    const mode = value.mode ?? (value.seatCount && !value.seatIds ? 'AUTO' : 'MANUAL');
    if (mode === 'AUTO') {
      if (!value.seatCount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'seatCount is required for AUTO assignment',
          path: ['seatCount'],
        });
      }
    } else if (!value.seatIds || value.seatIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'seatIds is required for MANUAL assignment',
        path: ['seatIds'],
      });
    }
  });

export const holdIdParamsSchema = z.object({
  holdId: z.string().min(1).max(64),
});
