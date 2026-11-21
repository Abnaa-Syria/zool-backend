import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/validation/common';

const nameAr = z.string().trim().min(2).max(160);
const nameEn = z.string().trim().min(2).max(160);
const booleanQuery = z.enum(['true', 'false']).transform((v) => v === 'true');

export const idParamsSchema = z.object({ id: z.string().min(1).max(64) });

// ---- Cities
export const listCitiesQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(120).optional(),
  isActive: booleanQuery.optional(),
});

export const createCitySchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z]{2,16}$/, 'Code must be 2-16 letters'),
    nameAr: nameAr.max(120),
    nameEn: nameEn.max(120),
    imageUrl: z.string().url().max(512).optional(),
    isPopular: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();

export const patchCitySchema = z
  .object({
    nameAr: nameAr.max(120).optional(),
    nameEn: nameEn.max(120).optional(),
    imageUrl: z.string().url().max(512).nullable().optional(),
    isPopular: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });

// ---- Stations
export const listStationsQuerySchema = paginationQuerySchema.extend({
  cityId: z.string().min(1).max(64).optional(),
  q: z.string().trim().min(1).max(120).optional(),
  isActive: booleanQuery.optional(),
});

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

export const createStationSchema = z
  .object({
    cityId: z.string().min(1).max(64),
    nameAr,
    nameEn,
    address: z.string().trim().max(255).optional(),
    latitude: latitude.optional(),
    longitude: longitude.optional(),
  })
  .strict()
  .refine((v) => (v.latitude === undefined) === (v.longitude === undefined), {
    message: 'latitude and longitude must be provided together',
  });

export const patchStationSchema = z
  .object({
    nameAr: nameAr.optional(),
    nameEn: nameEn.optional(),
    address: z.string().trim().max(255).nullable().optional(),
    latitude: latitude.nullable().optional(),
    longitude: longitude.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });

// ---- Amenities
export const createAmenitySchema = z
  .object({
    code: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{1,31}$/, 'Code must be snake_case'),
    nameAr: nameAr.max(80),
    nameEn: nameEn.max(80),
    icon: z.string().trim().min(1).max(64),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();

export const patchAmenitySchema = z
  .object({
    nameAr: nameAr.max(80).optional(),
    nameEn: nameEn.max(80).optional(),
    icon: z.string().trim().min(1).max(64).optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });

export type CreateCityInput = z.infer<typeof createCitySchema>;
export type PatchCityInput = z.infer<typeof patchCitySchema>;
export type CreateStationInput = z.infer<typeof createStationSchema>;
export type PatchStationInput = z.infer<typeof patchStationSchema>;
export type CreateAmenityInput = z.infer<typeof createAmenitySchema>;
export type PatchAmenityInput = z.infer<typeof patchAmenitySchema>;
