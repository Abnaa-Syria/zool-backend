import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/validation/common';

const passengerSchema = z.object({
  fullName: z.string().trim().min(2).max(160),
  phone: z.string().trim().min(7).max(32),
  idNumber: z.string().trim().min(1).max(64).optional(),
});

const seatIdsSchema = z
  .array(z.string().min(1).max(64))
  .min(1)
  .max(20)
  .refine((ids) => new Set(ids).size === ids.length, 'seatIds must be unique');

const bookingLinesShape = {
  tripId: z.string().min(1).max(64),
  seatIds: seatIdsSchema,
  passengers: z.array(passengerSchema).min(1).max(20),
};

export const quoteBookingSchema = z.object(bookingLinesShape);

export const confirmBookingSchema = z.object({
  ...bookingLinesShape,
  idempotencyKey: z.string().min(1).max(64),
});

const dateInput = z
  .string()
  .refine((v) => !Number.isNaN(new Date(v).getTime()), 'Invalid date');

export const listBookingsQuerySchema = paginationQuerySchema.extend({
  employeeId: z.string().min(1).max(64).optional(),
  companyId: z.string().min(1).max(64).optional(),
  status: z.enum(['CONFIRMED', 'CANCELLED']).optional(),
  from: dateInput.optional(),
  to: dateInput.optional(),
});

export const adminListBookingsQuerySchema = listBookingsQuerySchema.extend({
  officeId: z.string().min(1).max(64).optional(),
  q: z.string().trim().min(1).max(64).optional(),
});

export const adminCancelBookingSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export const bookingIdParamsSchema = z.object({
  id: z.string().min(1).max(64),
});

export const ticketPdfParamsSchema = z.object({
  id: z.string().min(1).max(64),
  ticketNumber: z.string().min(1).max(64),
});

export const dispatchBookingSchema = z
  .object({
    channel: z.enum(['whatsapp', 'sms', 'download']).default('download'),
  })
  .default({ channel: 'download' });
