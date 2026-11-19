import { compareSeatLabels } from '../../shared/utils/money';
import type { BookingRow } from './bookings.repository';

export function toBookingDto(booking: BookingRow) {
  const passengerById = new Map(booking.passengers.map((p) => [p.id, p]));
  const tickets = booking.tickets
    .map((t) => ({
      id: t.id,
      ticketNumber: t.ticketNumber,
      status: t.status,
      seatId: t.tripSeatId,
      seatLabel: t.tripSeat?.seatLabel ?? null,
      passengerId: t.passengerId,
      passengerName: passengerById.get(t.passengerId)?.fullName ?? null,
    }))
    .sort((a, b) => compareSeatLabels(a.seatLabel ?? '', b.seatLabel ?? ''));

  return {
    id: booking.id,
    status: booking.status,
    officeId: booking.officeId,
    employee: { id: booking.employee.id, displayName: booking.employee.displayName },
    trip: {
      id: booking.trip.id,
      origin: booking.trip.origin,
      destination: booking.trip.destination,
      departureAt: booking.trip.departureAt.toISOString(),
      company: {
        id: booking.trip.company.id,
        key: booking.trip.company.key,
        name: booking.trip.company.name,
      },
    },
    totalAmountMinor: booking.totalAmount,
    commissionAmountMinor: booking.commissionAmount,
    commissionStatus: booking.commissionAccrual?.status ?? null,
    confirmedAt: booking.confirmedAt.toISOString(),
    cancelledAt: booking.cancelledAt?.toISOString() ?? null,
    createdAt: booking.createdAt.toISOString(),
    passengers: booking.passengers.map((p) => ({
      id: p.id,
      fullName: p.fullName,
      phone: p.phone,
      idNumber: p.idNumber,
    })),
    tickets,
  };
}

export type BookingDto = ReturnType<typeof toBookingDto>;
