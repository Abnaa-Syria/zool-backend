import { ticketQrPayload } from '../../shared/security/ticket-qr';
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
      boardingStatus: t.boardingStatus,
      /** Signed boarding code for the QR (null unless the booking and ticket are confirmed) */
      qrPayload:
        booking.status === 'CONFIRMED' && t.status === 'CONFIRMED' ? ticketQrPayload(t.ticketNumber, booking.tripId) : null,
    }))
    .sort((a, b) => compareSeatLabels(a.seatLabel ?? '', b.seatLabel ?? ''));

  return {
    id: booking.id,
    status: booking.status,
    bookingRef: booking.bookingRef,
    channel: booking.channel,
    paymentMethod: booking.paymentMethod,
    paymentStatus: booking.paymentStatus,
    officeId: booking.officeId,
    office: booking.office,
    customerId: booking.customerId,
    customer: booking.customer
      ? { id: booking.customer.id, displayName: booking.customer.displayName, phone: booking.customer.identities[0]?.valueNormalized ?? null }
      : null,
    employee: booking.employee
      ? { id: booking.employee.id, displayName: booking.employee.displayName }
      : null,
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
    confirmedAt: booking.confirmedAt?.toISOString() ?? null,
    cancelledAt: booking.cancelledAt?.toISOString() ?? null,
    cancelReason: booking.cancelReason,
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
