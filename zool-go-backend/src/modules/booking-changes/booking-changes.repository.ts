import { BookingStatus, Prisma, TicketStatus, TripSeatStatus } from '@prisma/client';
import { getPrisma, type PrismaTx } from '../../infrastructure/database/prisma';
import { tripViewInclude } from '../catalog/trip-view';

const db = (tx?: PrismaTx) => tx ?? getPrisma();

export const changeBookingInclude = {
  trip: { include: tripViewInclude },
  passengers: true,
  tickets: { include: { tripSeat: true } },
  group: { include: { bookings: { include: { trip: { select: { id: true, departureAt: true, arrivalAt: true } } } } } },
  paymentIntents: { where: { status: 'SUCCEEDED' }, orderBy: { createdAt: 'asc' } },
  commissionAccrual: true,
} satisfies Prisma.BookingInclude;

export type ChangeBookingRow = Prisma.BookingGetPayload<{ include: typeof changeBookingInclude }>;

export const bookingChangesRepository = {
  findBooking(bookingId: string, tx?: PrismaTx) {
    return db(tx).booking.findUnique({ where: { id: bookingId }, include: changeBookingInclude });
  },

  findTripView(tripId: string, tx?: PrismaTx) {
    return db(tx).trip.findUnique({ where: { id: tripId }, include: tripViewInclude });
  },

  async lockSeats(seatIds: string[], tx: PrismaTx) {
    if (seatIds.length === 0) return;
    await tx.$queryRaw`SELECT id FROM trip_seats WHERE id IN (${Prisma.join(seatIds)}) FOR UPDATE`;
  },

  findSeatByLabel(tripId: string, seatLabel: string, tx: PrismaTx) {
    return tx.tripSeat.findUnique({ where: { tripId_seatLabel: { tripId, seatLabel } }, include: { hold: true } });
  },

  /** Other trips of the same carrier between the same two cities in [from, to). */
  alternativeTrips(params: { companyId: string; fromCityId: string; toCityId: string; excludeTripId: string; from: Date; to: Date }) {
    return getPrisma().trip.findMany({
      where: {
        id: { not: params.excludeTripId },
        companyId: params.companyId,
        isActive: true,
        status: 'SCHEDULED',
        departureAt: { gte: params.from, lt: params.to },
        company: { status: 'ACTIVE' },
        originStation: { cityId: params.fromCityId },
        destinationStation: { cityId: params.toCityId },
      },
      include: tripViewInclude,
      orderBy: { departureAt: 'asc' },
      take: 100,
    });
  },

  /** Old booking of a completed trip change: CHANGED, tickets CHANGED, its seats back on sale. */
  async retireChangedBooking(oldBookingId: string, tx: PrismaTx): Promise<boolean> {
    const moved = await tx.booking.updateMany({ where: { id: oldBookingId, status: BookingStatus.CONFIRMED }, data: { status: BookingStatus.CHANGED } });
    if (moved.count === 0) return false;
    const tickets = await tx.ticket.findMany({ where: { bookingId: oldBookingId }, select: { tripSeatId: true } });
    await tx.ticket.updateMany({ where: { bookingId: oldBookingId, status: TicketStatus.CONFIRMED }, data: { status: TicketStatus.CHANGED } });
    const seatIds = tickets.map((t) => t.tripSeatId).filter((id): id is string => id !== null);
    if (seatIds.length > 0) {
      await tx.tripSeat.updateMany({ where: { id: { in: seatIds }, status: TripSeatStatus.SOLD }, data: { status: TripSeatStatus.FREE } });
    }
    return true;
  },

  findChangeByNewBooking(newBookingId: string, tx?: PrismaTx) {
    return db(tx).bookingChange.findUnique({ where: { newBookingId } });
  },

  findByCheckoutKey(checkoutKey: string) {
    return getPrisma().booking.findUnique({ where: { checkoutKey }, select: { id: true } });
  },
};
