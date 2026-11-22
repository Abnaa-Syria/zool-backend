import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/validation/common';
import { MAX_SEATS_PER_HOLD } from './customer-trips.service';

const passengerSchema = z
  .object({
    fullName: z.string().trim().min(2).max(160),
    /** Required: women-only seats need FEMALE (SCREEN_API_MAP passenger details) */
    gender: z.enum(['MALE', 'FEMALE']),
    phone: z.string().trim().min(6).max(32).optional(),
    idNumber: z.string().trim().min(2).max(64).optional(),
  })
  .strict();

/**
 * Seat holds of one trip (one way) or two trips (round trip). Passenger i sits in the i-th seat
 * (by seat label) of each leg, so the app lists passengers in seat order.
 */
export const checkoutQuoteSchema = z
  .object({
    holdIds: z.array(z.string().min(1).max(64)).min(1).max(MAX_SEATS_PER_HOLD * 2),
    passengers: z.array(passengerSchema).min(1).max(MAX_SEATS_PER_HOLD),
    couponCode: z.string().trim().min(2).max(32).optional(),
  })
  .strict();

export const checkoutCreateSchema = checkoutQuoteSchema
  .extend({
    paymentMethod: z.enum(['ONLINE', 'CASH_ON_BOARD']),
    /** Alternative to the Idempotency-Key header */
    idempotencyKey: z.string().min(8).max(64).optional(),
  })
  .strict();

export const bookingsListQuerySchema = paginationQuerySchema.extend({
  tab: z.enum(['UPCOMING', 'ONGOING', 'PAST', 'CANCELLED']).optional(),
});

export const cancelBookingSchema = z.object({ reason: z.string().trim().min(2).max(500).optional() }).strict();

export const rateBookingSchema = z
  .object({ stars: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).optional() })
  .strict();

export const bookingIdParamsSchema = z.object({ bookingId: z.string().min(1).max(64) });
export const ticketParamsSchema = z.object({ ticketNumber: z.string().min(4).max(64) });
export const intentParamsSchema = z.object({ intentId: z.string().min(1).max(64) });
