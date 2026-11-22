import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/validation/common';
import { MAX_SEATS_PER_HOLD } from './customer-trips.service';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM');
/** Comma-separated list (`a,b`) or repeated query param (`x=a&x=b`). */
const csv = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (Array.isArray(v) ? v : v.split(',')).map((s) => s.trim()).filter(Boolean))
  .pipe(z.array(z.string().max(64)).max(20));

export const tripSearchBaseSchema = z.object({
  fromCityId: z.string().min(1).max(64),
  toCityId: z.string().min(1).max(64),
  date: ymd,
  returnDate: ymd.optional(),
  passengers: z.coerce.number().int().min(1).max(MAX_SEATS_PER_HOLD).optional(),
});

export const tripSearchQuerySchema = paginationQuerySchema.merge(tripSearchBaseSchema).extend({
  sort: z.enum(['recommended', 'departureAt', 'priceMinor', 'durationMinutes']).optional(),
  carrierId: csv.optional(),
  amenity: csv.optional(),
  serviceClass: z.enum(['STANDARD', 'VIP']).optional(),
  departureFrom: hhmm.optional(),
  departureTo: hhmm.optional(),
  priceMaxMinor: z.coerce.number().int().min(0).optional(),
});

export const tripIdParamsSchema = z.object({ tripId: z.string().min(1).max(64) });
export const holdIdParamsSchema = z.object({ holdId: z.string().min(1).max(64) });

export const createCustomerHoldSchema = z
  .object({ seatLabels: z.array(z.string().trim().min(1).max(8)).min(1).max(20) })
  .strict();
