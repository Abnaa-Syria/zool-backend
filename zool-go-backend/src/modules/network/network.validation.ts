import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/validation/common';

export const idParamsSchema = z.object({ id: z.string().min(1).max(64) });

const stopsSchema = z
  .array(
    z
      .object({
        stationId: z.string().min(1).max(64),
        /** Minutes after route departure when the bus arrives at this stop */
        offsetMinutes: z.number().int().min(1).max(10_080),
        dwellMinutes: z.number().int().min(0).max(240).optional(),
      })
      .strict(),
  )
  .max(30);

export const listRoutesQuerySchema = paginationQuerySchema.extend({
  companyId: z.string().min(1).max(64).optional(),
  stationId: z.string().min(1).max(64).optional(),
  isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

export const createRouteSchema = z
  .object({
    companyId: z.string().min(1).max(64),
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,32}$/).optional(),
    originStationId: z.string().min(1).max(64),
    destinationStationId: z.string().min(1).max(64),
    durationMinutes: z.number().int().min(10).max(10_080),
    stops: stopsSchema.optional(),
  })
  .strict();

export const patchRouteSchema = z
  .object({
    durationMinutes: z.number().int().min(10).max(10_080).optional(),
    isActive: z.boolean().optional(),
    /** Replaces the stop list; affects trips scheduled afterwards only */
    stops: stopsSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });

export const scheduleTripsSchema = z
  .object({
    routeId: z.string().min(1).max(64),
    vehicleId: z.string().min(1).max(64),
    driverId: z.string().min(1).max(64).optional(),
    /** One trip per departure instant (ISO 8601); up to 60 at once */
    departures: z.array(z.coerce.date()).min(1).max(60),
    basePrice: z.number().int().positive().max(1_000_000_000),
    serviceClass: z.enum(['STANDARD', 'VIP']).optional(),
  })
  .strict();

export const patchAssignmentSchema = z
  .object({
    vehicleId: z.string().min(1).max(64).optional(),
    driverId: z.string().min(1).max(64).nullable().optional(),
  })
  .strict()
  .refine((v) => v.vehicleId !== undefined || v.driverId !== undefined, { message: 'vehicleId or driverId is required' });

export type CreateRouteInput = z.infer<typeof createRouteSchema>;
export type PatchRouteInput = z.infer<typeof patchRouteSchema>;
export type ScheduleTripsInput = z.infer<typeof scheduleTripsSchema>;
export type PatchAssignmentInput = z.infer<typeof patchAssignmentSchema>;
