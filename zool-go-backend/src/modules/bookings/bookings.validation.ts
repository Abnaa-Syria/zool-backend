import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/validation/common';

const passengerSchema = z.object({
  fullName: z.string().trim().min(2).max(160),
  phone: z.string().trim().min(7).max(32),
  idNumber: z.string().trim().min(1).max(64).optional(),
  /** Required to book a women-only seat */
  gender: z.enum(['MALE', 'FEMALE']).optional(),
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

export const quoteBookingSchema = z.object({
  ...bookingLinesShape,
  returnTrip: z.object({ tripId: z.string().min(1).max(64), seatIds: seatIdsSchema }).optional(),
});

export const confirmBookingSchema = z.object({
  ...bookingLinesShape,
  /** D-RT-01 round trip: return trip seats (same passengers, same order) */
  returnTrip: z.object({ tripId: z.string().min(1).max(64), seatIds: seatIdsSchema }).optional(),
  idempotencyKey: z.string().min(1).max(64),
});

const dateInput = z
  .string()
  .refine((v) => !Number.isNaN(new Date(v).getTime()), 'Invalid date');

export const listBookingsQuerySchema = paginationQuerySchema.extend({
  employeeId: z.string().min(1).max(64).optional(),
  companyId: z.string().min(1).max(64).optional(),
  status: z.enum(['CONFIRMED', 'CANCELLED', 'CHANGED']).optional(),
  /** App tabs: ACTIVE (confirmed, trip not finished), COMPLETED (trip done), CANCELLED (cancelled or changed) */
  tab: z.enum(['ACTIVE', 'COMPLETED', 'CANCELLED']).optional(),
  /** Booking ref, ticket number, passenger name or phone */
  q: z.string().trim().min(2).max(64).optional(),
  from: dateInput.optional(),
  to: dateInput.optional(),
});

export const adminListBookingsQuerySchema = listBookingsQuerySchema.extend({
  officeId: z.string().min(1).max(64).optional(),
  customerId: z.string().min(1).max(64).optional(),
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
