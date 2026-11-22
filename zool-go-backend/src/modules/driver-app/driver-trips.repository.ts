import { Prisma, TripStatus } from '@prisma/client';
import { getPrisma, type PrismaTx } from '../../infrastructure/database/prisma';
import { tripViewInclude } from '../catalog/trip-view';

const db = (tx?: PrismaTx) => tx ?? getPrisma();

export const driverTripInclude = {
  ...tripViewInclude,
  vehicle: { select: { id: true, plateNumber: true, model: true, seatLayout: true, amenities: { include: { amenity: true } } } },
} satisfies Prisma.TripInclude;

export type DriverTripRow = Prisma.TripGetPayload<{ include: typeof driverTripInclude }>;

/** Tickets of a trip with what the driver needs at the door. */
export const manifestTicketInclude = {
  tripSeat: { select: { seatLabel: true, isWomenOnly: true } },
  passenger: true,
  cashCollection: true,
  booking: {
    select: {
      id: true,
      bookingRef: true,
      status: true,
      channel: true,
      customerId: true,
      paymentMethod: true,
      paymentStatus: true,
      totalAmount: true,
      tripId: true,
      _count: { select: { tickets: true } },
      tickets: { select: { id: true, tripSeat: { select: { seatLabel: true } } } },
      office: { select: { name: true } },
    },
  },
} satisfies Prisma.TicketInclude;

export type ManifestTicketRow = Prisma.TicketGetPayload<{ include: typeof manifestTicketInclude }>;

export const driverTripsRepository = {
  findForDriver(tripId: string, driverId: string, tx?: PrismaTx) {
    return db(tx).trip.findFirst({ where: { id: tripId, driverId }, include: driverTripInclude });
  },

  list(where: Prisma.TripWhereInput, orderBy: Prisma.TripOrderByWithRelationInput, skip: number, take: number) {
    return Promise.all([
      getPrisma().trip.findMany({ where, include: driverTripInclude, orderBy, skip, take }),
      getPrisma().trip.count({ where }),
    ]);
  },

  /** Tickets sold on the trip (confirmed bookings only; cancelled/changed are not passengers). */
  manifest(tripId: string, tx?: PrismaTx) {
    return db(tx).ticket.findMany({
      where: { booking: { tripId, status: 'CONFIRMED' } },
      include: manifestTicketInclude,
    });
  },

  findTicket(ticketNumber: string, tx?: PrismaTx) {
    return db(tx).ticket.findUnique({ where: { ticketNumber }, include: manifestTicketInclude });
  },

  lastPosition(tripId: string) {
    return getPrisma().vehiclePosition.findFirst({ where: { tripId }, orderBy: { recordedAt: 'desc' } });
  },

  async setStatus(tripId: string, from: TripStatus[], data: Prisma.TripUpdateManyMutationInput, tx: PrismaTx) {
    const r = await tx.trip.updateMany({ where: { id: tripId, status: { in: from } }, data });
    return r.count === 1;
  },

  cashSummary(tripId: string) {
    return getPrisma().cashCollection.aggregate({ where: { tripId }, _sum: { amount: true }, _count: { _all: true } });
  },
};
