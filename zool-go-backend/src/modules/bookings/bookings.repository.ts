import {
  BookingStatus,
  TicketStatus,
  TripSeatStatus,
  type Prisma,
} from '@prisma/client';
import { getPrisma, type PrismaTx } from '../../infrastructure/database/prisma';

function client(tx?: PrismaTx) {
  return tx ?? getPrisma();
}

export const bookingInclude = {
  trip: { include: { company: true } },
  employee: { select: { id: true, displayName: true } },
  passengers: true,
  tickets: { include: { tripSeat: true } },
  commissionAccrual: true,
} satisfies Prisma.BookingInclude;

export type BookingRow = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

export class BookingsRepository {
  findById(bookingId: string, officeId: string, tx?: PrismaTx) {
    return client(tx).booking.findFirst({
      where: { id: bookingId, officeId },
      include: bookingInclude,
    });
  }

  findByIdUnscoped(bookingId: string, tx?: PrismaTx) {
    return client(tx).booking.findUnique({ where: { id: bookingId }, include: bookingInclude });
  }

  async list(params: { where: Prisma.BookingWhereInput; skip: number; take: number }) {
    const [items, total] = await Promise.all([
      getPrisma().booking.findMany({
        where: params.where,
        include: bookingInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: params.skip,
        take: params.take,
      }),
      getPrisma().booking.count({ where: params.where }),
    ]);
    return { items, total };
  }

  findOffice(officeId: string, tx?: PrismaTx) {
    return client(tx).brokerOffice.findUnique({ where: { id: officeId } });
  }

  seatsWithHolds(tripId: string, seatIds: string[], tx: PrismaTx) {
    return tx.tripSeat.findMany({
      where: { tripId, id: { in: seatIds } },
      include: { hold: true },
    });
  }

  /** Confirmed tickets issued by the office within [from, to). */
  countConfirmedTickets(officeId: string, from: Date, to: Date, tx?: PrismaTx) {
    return client(tx).ticket.count({
      where: {
        status: TicketStatus.CONFIRMED,
        booking: {
          officeId,
          status: BookingStatus.CONFIRMED,
          confirmedAt: { gte: from, lt: to },
        },
      },
    });
  }

  createBooking(
    data: {
      officeId: string;
      employeeId: string;
      tripId: string;
      totalAmount: number;
      commissionAmount: number;
      confirmedAt: Date;
    },
    tx: PrismaTx,
  ) {
    return tx.booking.create({ data: { ...data, status: BookingStatus.CONFIRMED } });
  }

  createPassenger(
    data: { bookingId: string; fullName: string; phone: string; idNumber?: string },
    tx: PrismaTx,
  ) {
    return tx.bookingPassenger.create({ data });
  }

  createTicket(
    data: {
      bookingId: string;
      tripSeatId: string;
      passengerId: string;
      ticketNumber: string;
    },
    tx: PrismaTx,
  ) {
    return tx.ticket.create({ data: { ...data, status: TicketStatus.CONFIRMED } });
  }

  async markSeatsSold(seatIds: string[], tx: PrismaTx): Promise<number> {
    const result = await tx.tripSeat.updateMany({
      where: { id: { in: seatIds }, status: TripSeatStatus.HELD },
      data: { status: TripSeatStatus.SOLD },
    });
    return result.count;
  }

  async deleteHoldsForSeats(seatIds: string[], tx: PrismaTx): Promise<void> {
    await tx.seatHold.deleteMany({ where: { tripSeatId: { in: seatIds } } });
  }

  async cancelBooking(bookingId: string, tx: PrismaTx): Promise<number> {
    const result = await tx.booking.updateMany({
      where: { id: bookingId, status: BookingStatus.CONFIRMED },
      data: { status: BookingStatus.CANCELLED, cancelledAt: new Date() },
    });
    return result.count;
  }

  async cancelTickets(bookingId: string, tx: PrismaTx): Promise<void> {
    await tx.ticket.updateMany({
      where: { bookingId, status: TicketStatus.CONFIRMED },
      data: { status: TicketStatus.CANCELLED },
    });
  }

  async freeSeats(seatIds: string[], tx: PrismaTx): Promise<void> {
    if (seatIds.length === 0) return;
    await tx.tripSeat.updateMany({
      where: { id: { in: seatIds }, status: TripSeatStatus.SOLD },
      data: { status: TripSeatStatus.FREE },
    });
  }
}

export const bookingsRepository = new BookingsRepository();
