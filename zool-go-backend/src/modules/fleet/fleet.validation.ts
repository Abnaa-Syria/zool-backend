import { z } from 'zod';
import { isoDateSchema, paginationQuerySchema } from '../../shared/validation/common';
import { seatLayoutSchema } from '../../shared/utils/seat-layout';

export const idParamsSchema = z.object({ id: z.string().min(1).max(64) });

const amenitiesSchema = z
  .array(z.object({ code: z.string().min(1).max(32), value: z.string().trim().max(32).optional() }).strict())
  .max(30);

/** Either a full layout or a numbered-bus shortcut (rows × columns, aisle in the middle). */
const layoutInputSchema = z.union([
  z.object({ seatLayout: seatLayoutSchema }).strict(),
  z
    .object({
      numbered: z
        .object({
          rows: z.number().int().min(1).max(30),
          columns: z.number().int().min(2).max(6).optional(),
          womenOnlyLabels: z.array(z.string().min(1).max(8)).max(60).optional(),
        })
        .strict(),
    })
    .strict(),
]);

export const listVehiclesQuerySchema = paginationQuerySchema.extend({
  companyId: z.string().min(1).max(64).optional(),
  status: z.enum(['ACTIVE', 'MAINTENANCE', 'RETIRED']).optional(),
  q: z.string().trim().min(1).max(64).optional(),
});

export const createVehicleSchema = z
  .object({
    companyId: z.string().min(1).max(64),
    plateNumber: z.string().trim().min(2).max(32),
    model: z.string().trim().min(2).max(120),
    serviceClass: z.enum(['STANDARD', 'VIP']).optional(),
    layout: layoutInputSchema,
    amenities: amenitiesSchema.optional(),
  })
  .strict();

export const patchVehicleSchema = z
  .object({
    model: z.string().trim().min(2).max(120).optional(),
    serviceClass: z.enum(['STANDARD', 'VIP']).optional(),
    status: z.enum(['ACTIVE', 'MAINTENANCE', 'RETIRED']).optional(),
    /** Applies to trips created afterwards; existing trips keep their seats. */
    layout: layoutInputSchema.optional(),
    /** Replaces the vehicle's amenity list */
    amenities: amenitiesSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });

export const listDriversQuerySchema = paginationQuerySchema.extend({
  companyId: z.string().min(1).max(64).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  q: z.string().trim().min(1).max(64).optional(),
});

export const createDriverSchema = z
  .object({
    companyId: z.string().min(1).max(64),
    displayName: z.string().trim().min(2).max(160),
    phone: z.string().trim().min(6).max(32),
    driverCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,32}$/).optional(),
    licenseNumber: z.string().trim().max(64).optional(),
    licenseExpiry: isoDateSchema.optional(),
  })
  .strict();

export const patchDriverSchema = z
  .object({
    displayName: z.string().trim().min(2).max(160).optional(),
    /** Admin-managed: changing it revokes the driver's sessions */
    phone: z.string().trim().min(6).max(32).optional(),
    licenseNumber: z.string().trim().max(64).nullable().optional(),
    licenseExpiry: isoDateSchema.nullable().optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });

export type LayoutInput = z.infer<typeof layoutInputSchema>;
export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;
export type PatchVehicleInput = z.infer<typeof patchVehicleSchema>;
export type CreateDriverInput = z.infer<typeof createDriverSchema>;
export type PatchDriverInput = z.infer<typeof patchDriverSchema>;
