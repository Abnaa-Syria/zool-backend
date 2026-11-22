import { BookingPaymentStatus, BookingStatus, TicketStatus, TripStatus, type Prisma } from '@prisma/client';
import { AppError } from '../../shared/errors/app-error';
import { ticketQrPayload } from '../../shared/security/ticket-qr';
import { runtimeSettings } from '../../shared/settings/runtime-settings';
import { compareSeatLabels, splitFare } from '../../shared/utils/money';
import { paginationMeta, parsePagination } from '../../shared/utils/pagination';
import { BookingErrors } from '../bookings/bookings.errors';
import { pdfTicketRenderer } from '../bookings/pdf-ticket-renderer';
import { toTripDetailView } from '../catalog/trip-view';
import { customerBookingsRepository, type CustomerBookingRow } from './customer-bookings.repository';
import { customerCheckoutService } from './customer-checkout.service';

export type BookingTab = 'UPCOMING' | 'ONGOING' | 'PAST' | 'CANCELLED';

const LIVE_TRIP: TripStatus[] = [TripStatus.SCHEDULED, TripStatus.BOARDING];

function tabWhere(tab: BookingTab): Prisma.BookingWhereInput {
  switch (tab) {
    case 'UPCOMING':
      return { status: { in: [BookingStatus.CONFIRMED, BookingStatus.PENDING_PAYMENT] }, trip: { status: { in: LIVE_TRIP } } };
    case 'ONGOING':
      return { status: BookingStatus.CONFIRMED, trip: { status: TripStatus.IN_PROGRESS } };
    case 'PAST':
      return { status: BookingStatus.CONFIRMED, trip: { status: TripStatus.COMPLETED } };
    case 'CANCELLED':
      return {
        OR: [
          { status: { in: [BookingStatus.CANCELLED, BookingStatus.EXPIRED, BookingStatus.CHANGED] } },
          { status: BookingStatus.CONFIRMED, trip: { status: TripStatus.CANCELLED } },
        ],
      };
  }
}

export function customerActions(b: CustomerBookingRow) {
  const minutesLeft = (b.trip.departureAt.getTime() - Date.now()) / 60_000;
  const anyBoarded = b.tickets.some((t) => t.boardingStatus === 'BOARDED');
  const active = b.status === BookingStatus.CONFIRMED || b.status === BookingStatus.PENDING_PAYMENT;
  const tripOpen = LIVE_TRIP.includes(b.trip.status);
  return {
    canCancel: active && tripOpen && !anyBoarded && minutesLeft > runtimeSettings.number('refund.customerCutoffMinutesBeforeDeparture'),
    canChangeSeat: b.status === BookingStatus.CONFIRMED && b.trip.status === TripStatus.SCHEDULED && !anyBoarded && minutesLeft > 0,
    canChangeTrip:
      b.status === BookingStatus.CONFIRMED &&
      b.trip.status === TripStatus.SCHEDULED &&
      !anyBoarded &&
      minutesLeft > runtimeSettings.number('change.cutoffMinutesBeforeDeparture') &&
      b.changeCount < runtimeSettings.number('change.maxChangesPerBooking'),
    canRate: b.status === BookingStatus.CONFIRMED && b.trip.status === TripStatus.COMPLETED && b.rating === null,
    canPay: b.status === BookingStatus.PENDING_PAYMENT,
  };
}

export function toCustomerBookingDto(b: CustomerBookingRow, payment: ReturnType<typeof customerCheckoutService.paymentView> | null) {
  const passengers = new Map(b.passengers.map((p) => [p.id, p]));
  const tickets = [...b.tickets].sort((x, y) => compareSeatLabels(x.tripSeat?.seatLabel ?? '', y.tripSeat?.seatLabel ?? ''));
  const fare = splitFare(b.totalAmount, tickets.length);
  const boardable = b.status === BookingStatus.CONFIRMED && LIVE_TRIP.concat(TripStatus.IN_PROGRESS).includes(b.trip.status);
  const unpaidCash = b.paymentStatus === BookingPaymentStatus.UNPAID_CASH;
  return {
    id: b.id,
    bookingRef: b.bookingRef,
    status: b.status,
    tripCancelled: b.trip.status === TripStatus.CANCELLED,
    leg: b.leg,
    group: b.group
      ? {
          id: b.group.id,
          type: b.group.type,
          otherLeg: b.group.bookings.filter((o) => o.id !== b.id).map((o) => ({ bookingId: o.id, leg: o.leg, status: o.status, bookingRef: o.bookingRef }))[0] ?? null,
        }
      : null,
    paymentMethod: b.paymentMethod,
    paymentStatus: b.paymentStatus,
    amounts: { subtotalMinor: b.subtotalAmount ?? b.totalAmount, discountMinor: b.discountAmount, totalMinor: b.totalAmount, currency: 'SDG' as const },
    coupon: b.couponRedemption ? { code: b.couponRedemption.coupon.code, discountMinor: b.couponRedemption.discountAmount } : null,
    trip: toTripDetailView(b.trip, undefined),
    tickets: tickets.map((t, i) => {
      const p = passengers.get(t.passengerId);
      const valid = boardable && t.status === TicketStatus.CONFIRMED;
      return {
        ticketNumber: t.ticketNumber,
        status: t.status,
        boardingStatus: t.boardingStatus,
        boardedAt: t.boardedAt?.toISOString() ?? null,
        seatLabel: t.tripSeat?.seatLabel ?? null,
        isWomenOnlySeat: t.tripSeat?.isWomenOnly ?? false,
        passenger: { fullName: p?.fullName ?? null, gender: p?.gender ?? null, phone: p?.phone ?? null },
        fareMinor: fare[i]!,
        /** D-CASH-01: amount the driver collects at boarding (0 once paid) */
        cashToCollectMinor: unpaidCash && !t.cashCollection && t.status === TicketStatus.CONFIRMED ? fare[i]! : 0,
        qrPayload: valid ? ticketQrPayload(t.ticketNumber, b.tripId) : null,
      };
    }),
    payment,
    refunds: b.refunds.map((r) => ({ id: r.id, amountMinor: r.amount, status: r.status, reason: r.reason, createdAt: r.createdAt.toISOString(), processedAt: r.processedAt?.toISOString() ?? null })),
    rating: b.rating ? { stars: b.rating.stars, comment: b.rating.comment, createdAt: b.rating.createdAt.toISOString() } : null,
    actions: customerActions(b),
    changeCount: b.changeCount,
    replacedByBookingId: b.changesFrom.find((c) => c.newBookingId)?.newBookingId ?? null,
    replacesBookingId: b.changedFrom?.bookingId ?? null,
    confirmedAt: b.confirmedAt?.toISOString() ?? null,
    cancelledAt: b.cancelledAt?.toISOString() ?? null,
    cancelReason: b.cancelReason,
    createdAt: b.createdAt.toISOString(),
  };
}

export class CustomerBookingsService {
  private async view(b: CustomerBookingRow) {
    const intents = await customerBookingsRepository.findIntents(b);
    return toCustomerBookingDto(b, intents[0] ? customerCheckoutService.paymentView(intents[0]) : null);
  }

  async get(customerId: string, bookingId: string) {
    await customerCheckoutService.expireOverdue();
    const b = await customerBookingsRepository.findForCustomer(bookingId, customerId);
    if (!b) throw BookingErrors.notFound();
    return this.view(b);
  }

  async list(customerId: string, query: { tab?: BookingTab; page?: number; pageSize?: number }) {
    await customerCheckoutService.expireOverdue();
    const tab = query.tab ?? 'UPCOMING';
    const { page, pageSize, skip, take } = parsePagination(query);
    const upcoming = tab === 'UPCOMING' || tab === 'ONGOING';
    const { items, total } = await customerBookingsRepository.list({
      where: { customerId, ...tabWhere(tab) },
      orderBy: upcoming ? [{ trip: { departureAt: 'asc' } }, { id: 'asc' }] : [{ trip: { departureAt: 'desc' } }, { id: 'desc' }],
      skip,
      take,
    });
    return { items: await Promise.all(items.map((b) => this.view(b))), meta: { ...paginationMeta(page, pageSize, total), tab } };
  }

  async getByTicket(customerId: string, ticketNumber: string) {
    const t = await customerBookingsRepository.findTicketForCustomer(ticketNumber, customerId);
    if (!t) throw AppError.notFound('Ticket not found');
    const booking = await this.get(customerId, t.bookingId);
    return { ticket: booking.tickets.find((x) => x.ticketNumber === ticketNumber)!, booking };
  }

  async ticketPdf(customerId: string, ticketNumber: string): Promise<{ buffer: Buffer; filename: string }> {
    const { ticket, booking } = await this.getByTicket(customerId, ticketNumber);
    if (booking.status !== BookingStatus.CONFIRMED || ticket.status !== TicketStatus.CONFIRMED || !ticket.qrPayload) {
      throw AppError.conflict('Only valid confirmed tickets can be downloaded', { status: booking.status });
    }
    const city = (p: { city: { nameEn: string } }) => p.city.nameEn;
    const buffer = await pdfTicketRenderer.renderPdf({
      bookingId: booking.bookingRef ?? booking.id,
      issuedAt: new Date().toISOString(),
      office: null,
      carrier: { id: booking.trip.carrier.id, name: booking.trip.carrier.name, code: booking.trip.tripNumber ?? '' },
      trip: {
        id: booking.trip.id,
        origin: city(booking.trip.origin),
        destination: city(booking.trip.destination),
        departureAt: booking.trip.departureAt,
        basePriceMinor: booking.trip.priceMinor,
      },
      passengers: [
        {
          name: ticket.passenger.fullName ?? '-',
          phone: ticket.passenger.phone,
          seatLabel: ticket.seatLabel ?? '-',
          ticketNumber: ticket.ticketNumber,
          fareAmountMinor: ticket.fareMinor,
          qrPayload: ticket.qrPayload,
        },
      ],
      totals: { totalAmountMinor: ticket.fareMinor, commissionAmountMinor: 0, currency: 'SDG' },
    });
    return { buffer, filename: `${ticketNumber.replace(/[^A-Za-z0-9._-]+/g, '_')}.pdf` };
  }
}

export const customerBookingsService = new CustomerBookingsService();
