import {
  BookingPaymentStatus,
  BookingStatus,
  PaymentIntentStatus,
  Prisma,
  TicketStatus,
  TripSeatStatus,
  TripStatus,
} from '@prisma/client';
import { getPrisma, type PrismaTx } from '../../infrastructure/database/prisma';
import { tripViewInclude } from '../catalog/trip-view';

const db = (tx?: PrismaTx) => tx ?? getPrisma();

export const customerBookingInclude = {
  trip: { include: tripViewInclude },
  passengers: true,
  tickets: { include: { tripSeat: { select: { id: true, seatLabel: true, isWomenOnly: true } }, cashCollection: true } },
  group: { include: { bookings: { select: { id: true, leg: true, status: true, tripId: true, bookingRef: true } } } },
  refunds: { orderBy: { createdAt: 'desc' } },
  rating: true,
  couponRedemption: { include: { coupon: { select: { code: true } } } },
} satisfies Prisma.BookingInclude;

export type CustomerBookingRow = Prisma.BookingGetPayload<{ include: typeof customerBookingInclude }>;

const holdInclude = { tripSeat: { include: { trip: { include: tripViewInclude } } } } satisfies Prisma.SeatHoldInclude;
export type CustomerHoldRow = Prisma.SeatHoldGetPayload<{ include: typeof holdInclude }>;

/** Bookings that still need the customer to show up (D-CASH-01 open-cash limit). */
const OPEN_TRIP_STATUSES: TripStatus[] = [TripStatus.SCHEDULED, TripStatus.BOARDING];

export const customerBookingsRepository = {
  findHolds(holdIds: string[], tx?: PrismaTx) {
    return db(tx).seatHold.findMany({ where: { id: { in: holdIds } }, include: holdInclude });
  },

  /** Row locks on the seats being sold (serialises concurrent checkouts of the same seats). */
  async lockSeats(seatIds: string[], tx: PrismaTx) {
    if (seatIds.length === 0) return;
    await tx.$queryRaw`SELECT id FROM trip_seats WHERE id IN (${Prisma.join(seatIds)}) FOR UPDATE`;
  },

  countOpenCashBookings(customerId: string, tx?: PrismaTx) {
    return db(tx).booking.count({
      where: {
        customerId,
        status: BookingStatus.CONFIRMED,
        paymentStatus: BookingPaymentStatus.UNPAID_CASH,
        trip: { status: { in: OPEN_TRIP_STATUSES } },
      },
    });
  },

  findCoupon(code: string, tx?: PrismaTx) {
    return db(tx).coupon.findUnique({ where: { code } });
  },

  countCouponUses(couponId: string, customerId: string, tx?: PrismaTx) {
    return db(tx).couponRedemption.count({ where: { couponId, customerId } });
  },

  /** Takes one coupon use if any are left (`maxRedemptions` respected under concurrency). */
  async takeCouponUse(couponId: string, max: number | null, tx: PrismaTx): Promise<boolean> {
    const r = await tx.coupon.updateMany({
      where: { id: couponId, ...(max !== null ? { redeemedCount: { lt: max } } : {}) },
      data: { redeemedCount: { increment: 1 } },
    });
    return r.count === 1;
  },

  findByCheckoutKey(checkoutKey: string) {
    return getPrisma().booking.findUnique({ where: { checkoutKey }, select: { id: true, customerId: true, groupId: true } });
  },

  findForCustomer(bookingId: string, customerId: string, tx?: PrismaTx) {
    return db(tx).booking.findFirst({ where: { id: bookingId, customerId }, include: customerBookingInclude });
  },

  findManyForCustomer(ids: string[], customerId: string) {
    return getPrisma().booking.findMany({ where: { id: { in: ids }, customerId }, include: customerBookingInclude });
  },

  async list(params: { where: Prisma.BookingWhereInput; orderBy: Prisma.BookingOrderByWithRelationInput[]; skip: number; take: number }) {
    const [items, total] = await Promise.all([
      getPrisma().booking.findMany({ ...params, include: customerBookingInclude }),
      getPrisma().booking.count({ where: params.where }),
    ]);
    return { items, total };
  },

  findTicketForCustomer(ticketNumber: string, customerId: string) {
    return getPrisma().ticket.findFirst({
      where: { ticketNumber, booking: { customerId } },
      select: { bookingId: true },
    });
  },

  /** Intents paying this booking (single) or its round-trip group. */
  findIntents(booking: { id: string; groupId: string | null }, tx?: PrismaTx) {
    return db(tx).paymentIntent.findMany({
      where: { OR: [{ bookingId: booking.id }, ...(booking.groupId ? [{ groupId: booking.groupId }] : [])] },
      orderBy: { createdAt: 'desc' },
    });
  },

  findIntent(intentId: string, tx?: PrismaTx) {
    return db(tx).paymentIntent.findUnique({ where: { id: intentId } });
  },

  /** Bookings an intent pays for. */
  bookingsOfIntent(intent: { bookingId: string | null; groupId: string | null }, tx?: PrismaTx) {
    return db(tx).booking.findMany({
      where: intent.groupId ? { groupId: intent.groupId } : { id: intent.bookingId ?? '__none__' },
      include: { tickets: { select: { id: true, tripSeatId: true } }, couponRedemption: true },
    });
  },

  /** PENDING → terminal, only once (concurrent webhook/expiry/cancel cannot both win). */
  async transitionIntent(intentId: string, to: PaymentIntentStatus, data: Prisma.PaymentIntentUpdateManyMutationInput, tx: PrismaTx) {
    const r = await tx.paymentIntent.updateMany({ where: { id: intentId, status: PaymentIntentStatus.PENDING }, data: { status: to, ...data } });
    return r.count === 1;
  },

  overdueIntents(limit: number) {
    return getPrisma().paymentIntent.findMany({
      where: { status: PaymentIntentStatus.PENDING, expiresAt: { lte: new Date() } },
      select: { id: true },
      take: limit,
    });
  },

  /** Unsold: tickets cancelled, seats back to FREE (sold seats only). */
  async releaseBookingSeats(bookingIds: string[], seatIds: string[], tx: PrismaTx) {
    await tx.ticket.updateMany({ where: { bookingId: { in: bookingIds } }, data: { status: TicketStatus.CANCELLED } });
    if (seatIds.length > 0) {
      await tx.tripSeat.updateMany({ where: { id: { in: seatIds }, status: TripSeatStatus.SOLD }, data: { status: TripSeatStatus.FREE } });
    }
  },

  async releaseCoupon(redemption: { id: string; couponId: string } | null, tx: PrismaTx) {
    if (!redemption) return;
    await tx.couponRedemption.delete({ where: { id: redemption.id } });
    await tx.coupon.updateMany({ where: { id: redemption.couponId, redeemedCount: { gt: 0 } }, data: { redeemedCount: { decrement: 1 } } });
  },
};
