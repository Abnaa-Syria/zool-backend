import {
  BoardingMethod,
  BoardingScanResult,
  BoardingStatus,
  BookingPaymentStatus,
  BookingStatus,
  PrincipalType,
  TicketStatus,
  TripStatus,
  type Prisma,
} from '@prisma/client';
import { env } from '../../config/env';
import { getPrisma } from '../../infrastructure/database/prisma';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import { sha256Hex } from '../../shared/security/crypto';
import { verifyTicketQr } from '../../shared/security/ticket-qr';
import { compareSeatLabels, splitFare } from '../../shared/utils/money';
import { paginationMeta, parsePagination } from '../../shared/utils/pagination';
import { zonedDayRange, calendarDateInZone } from '../../shared/utils/timezone';
import { auditService } from '../audit/audit.service';
import { toTripDetailView } from '../catalog/trip-view';
import { notificationsService } from '../notifications/notifications.service';
import { trackingService } from '../tracking/tracking.service';
import { driverTripsRepository, type DriverTripRow, type ManifestTicketRow } from './driver-trips.repository';

/** Boarding may open this long before departure. */
const BOARDING_WINDOW_MS = 6 * 60 * 60 * 1000;

const TRANSITIONS: Record<TripStatus, TripStatus[]> = {
  SCHEDULED: [TripStatus.BOARDING, TripStatus.IN_PROGRESS],
  BOARDING: [TripStatus.IN_PROGRESS],
  IN_PROGRESS: [TripStatus.COMPLETED],
  COMPLETED: [],
  CANCELLED: [],
};

function stateError(message: string, details?: unknown) {
  return new AppError({ statusCode: 409, code: ErrorCodes.TRIP_STATE_INVALID, message, ...(details !== undefined ? { details } : {}) });
}

/** Fare of one ticket inside its booking (split by seat order) and the cash still to collect. */
function ticketMoney(t: ManifestTicketRow) {
  const labels = t.booking.tickets.map((x) => x.tripSeat?.seatLabel ?? '').sort(compareSeatLabels);
  const fares = splitFare(t.booking.totalAmount, labels.length);
  const fare = fares[Math.max(0, labels.indexOf(t.tripSeat?.seatLabel ?? ''))] ?? 0;
  const unpaidCash = t.booking.paymentStatus === BookingPaymentStatus.UNPAID_CASH && !t.cashCollection;
  return { fareMinor: fare, cashToCollectMinor: unpaidCash ? fare : 0, cashCollectedMinor: t.cashCollection?.amount ?? 0 };
}

function manifestEntry(t: ManifestTicketRow) {
  return {
    ticketNumber: t.ticketNumber,
    seatLabel: t.tripSeat?.seatLabel ?? null,
    isWomenOnlySeat: t.tripSeat?.isWomenOnly ?? false,
    passenger: { fullName: t.passenger.fullName, phone: t.passenger.phone, gender: t.passenger.gender },
    ticketStatus: t.status,
    boardingStatus: t.boardingStatus,
    boardingMethod: t.boardingMethod,
    boardedAt: t.boardedAt?.toISOString() ?? null,
    bookingRef: t.booking.bookingRef,
    channel: t.booking.channel,
    soldBy: t.booking.office?.name ?? null,
    paymentMethod: t.booking.paymentMethod,
    ...ticketMoney(t),
  };
}

/** Driver app: assigned trips, lifecycle, manifest, QR boarding, cash (D-CASH-01) and GPS (D-GPS-01). */
export class DriverTripsService {
  private async trip(driverId: string, tripId: string) {
    const trip = await driverTripsRepository.findForDriver(tripId, driverId);
    if (!trip) throw AppError.notFound('Trip not found or not assigned to you');
    return trip;
  }

  private async card(trip: DriverTripRow) {
    const tickets = await driverTripsRepository.manifest(trip.id);
    const live = tickets.filter((t) => t.status === TicketStatus.CONFIRMED);
    return {
      ...toTripDetailView(trip, undefined),
      vehicle: trip.vehicle ? { id: trip.vehicle.id, plateNumber: trip.vehicle.plateNumber, model: trip.vehicle.model } : null,
      counts: {
        booked: live.length,
        boarded: live.filter((t) => t.boardingStatus === BoardingStatus.BOARDED).length,
        noShow: live.filter((t) => t.boardingStatus === BoardingStatus.NO_SHOW).length,
      },
      cash: {
        expectedMinor: live.reduce((n, t) => n + ticketMoney(t).cashToCollectMinor + ticketMoney(t).cashCollectedMinor, 0),
        collectedMinor: live.reduce((n, t) => n + ticketMoney(t).cashCollectedMinor, 0),
      },
      allowedTransitions: TRANSITIONS[trip.status],
      startedAt: trip.startedAt?.toISOString() ?? null,
      completedAt: trip.completedAt?.toISOString() ?? null,
    };
  }

  async dashboard(driverId: string) {
    const tz = env().PLATFORM_TIMEZONE;
    const today = calendarDateInZone(new Date(), tz);
    const { from, to } = zonedDayRange(today, tz);
    const [todays] = await driverTripsRepository.list({ driverId, departureAt: { gte: from, lt: to }, status: { not: TripStatus.CANCELLED } }, { departureAt: 'asc' }, 0, 50);
    const [current] = await driverTripsRepository.list({ driverId, status: { in: [TripStatus.BOARDING, TripStatus.IN_PROGRESS] } }, { departureAt: 'asc' }, 0, 1);
    const [next] = await driverTripsRepository.list({ driverId, status: TripStatus.SCHEDULED, departureAt: { gt: new Date() } }, { departureAt: 'asc' }, 0, 1);
    const cards = await Promise.all(todays.map((t) => this.card(t)));
    return {
      date: today,
      kpis: { tripsToday: todays.length, bookedSeatsToday: cards.reduce((n, c) => n + c.counts.booked, 0), boardedToday: cards.reduce((n, c) => n + c.counts.boarded, 0) },
      currentTrip: current[0] ? await this.card(current[0]) : null,
      nextTrip: next[0] ? await this.card(next[0]) : null,
      todayTrips: cards,
    };
  }

  async list(driverId: string, query: { tab?: 'UPCOMING' | 'CURRENT' | 'COMPLETED'; page?: number; pageSize?: number }) {
    const tab = query.tab ?? 'UPCOMING';
    const { page, pageSize, skip, take } = parsePagination(query);
    const where: Prisma.TripWhereInput =
      tab === 'UPCOMING'
        ? { driverId, status: TripStatus.SCHEDULED }
        : tab === 'CURRENT'
          ? { driverId, status: { in: [TripStatus.BOARDING, TripStatus.IN_PROGRESS] } }
          : { driverId, status: { in: [TripStatus.COMPLETED, TripStatus.CANCELLED] } };
    const [rows, total] = await driverTripsRepository.list(where, { departureAt: tab === 'COMPLETED' ? 'desc' : 'asc' }, skip, take);
    return { items: await Promise.all(rows.map((t) => this.card(t))), meta: { ...paginationMeta(page, pageSize, total), tab } };
  }

  async detail(driverId: string, tripId: string) {
    const trip = await this.trip(driverId, tripId);
    return { ...(await this.card(trip)), live: await trackingService.viewById(trip.id) };
  }

  async manifest(driverId: string, tripId: string) {
    const trip = await this.trip(driverId, tripId);
    const entries = (await driverTripsRepository.manifest(trip.id))
      .filter((t) => t.status === TicketStatus.CONFIRMED)
      .map(manifestEntry)
      .sort((a, b) => compareSeatLabels(a.seatLabel ?? '', b.seatLabel ?? ''));
    return {
      tripId: trip.id,
      status: trip.status,
      counts: {
        booked: entries.length,
        boarded: entries.filter((e) => e.boardingStatus === BoardingStatus.BOARDED).length,
        pending: entries.filter((e) => e.boardingStatus === BoardingStatus.PENDING).length,
        noShow: entries.filter((e) => e.boardingStatus === BoardingStatus.NO_SHOW).length,
      },
      passengers: entries,
    };
  }

  async setStatus(driverId: string, tripId: string, status: TripStatus, requestId?: string) {
    const trip = await this.trip(driverId, tripId);
    if (!TRANSITIONS[trip.status].includes(status)) throw stateError(`Cannot move a ${trip.status} trip to ${status}`, { from: trip.status, to: status });
    if (status === TripStatus.BOARDING && trip.departureAt.getTime() - Date.now() > BOARDING_WINDOW_MS) {
      throw stateError('Boarding opens 6 hours before departure', { departureAt: trip.departureAt.toISOString() });
    }

    await getPrisma().$transaction(async (tx) => {
      const now = new Date();
      const data: Prisma.TripUpdateManyMutationInput =
        status === TripStatus.IN_PROGRESS ? { status, startedAt: now } : status === TripStatus.COMPLETED ? { status, completedAt: now } : { status };
      if (!(await driverTripsRepository.setStatus(trip.id, [trip.status], data, tx))) throw stateError('The trip status changed meanwhile');

      if (status === TripStatus.IN_PROGRESS) {
        // Departure: whoever did not board is a no-show (D-CASH-01 §4). Unpaid cash bookings with
        // nobody aboard count toward the customer's cash no-show limit (once per booking).
        const tickets = await driverTripsRepository.manifest(trip.id, tx);
        const pending = tickets.filter((t) => t.status === TicketStatus.CONFIRMED && t.boardingStatus === BoardingStatus.PENDING);
        if (pending.length > 0) {
          await tx.ticket.updateMany({ where: { id: { in: pending.map((t) => t.id) } }, data: { boardingStatus: BoardingStatus.NO_SHOW } });
        }
        const byBooking = new Map<string, ManifestTicketRow[]>();
        for (const t of tickets) byBooking.set(t.booking.id, [...(byBooking.get(t.booking.id) ?? []), t]);
        for (const list of byBooking.values()) {
          const b = list[0]!.booking;
          const nobodyBoarded = list.every((t) => t.boardingStatus !== BoardingStatus.BOARDED);
          if (b.paymentStatus === BookingPaymentStatus.UNPAID_CASH && nobodyBoarded && b.customerId) {
            await tx.customer.update({ where: { id: b.customerId }, data: { cashNoShowCount: { increment: 1 } } });
          }
        }
      }
      if (status === TripStatus.COMPLETED) {
        const tickets = await driverTripsRepository.manifest(trip.id, tx);
        const customers = [...new Set(tickets.filter((t) => t.boardingStatus === BoardingStatus.BOARDED && t.booking.customerId).map((t) => t.booking.customerId!))];
        await notificationsService.notify(
          customers.map((id) => ({ type: PrincipalType.CUSTOMER, id })),
          { type: 'RATE_TRIP', title: 'وصلت بالسلامة', body: 'كيف كانت رحلتك؟ قيّم شركة النقل.', data: { tripId: trip.id } },
          tx,
        );
      }
      await auditService.record({ action: 'trip.status_changed', resourceType: 'trip', resourceId: trip.id, requestId, metadata: { driverId, from: trip.status, to: status } }, tx);
    });
    return this.detail(driverId, tripId);
  }

  async stopEvent(driverId: string, tripId: string, stopId: string, event: 'ARRIVED' | 'DEPARTED') {
    const trip = await this.trip(driverId, tripId);
    if (trip.status !== TripStatus.IN_PROGRESS) throw stateError('Stops are recorded while the trip is in progress');
    const stop = trip.stops.find((s) => s.id === stopId);
    if (!stop) throw AppError.notFound('Stop not found on this trip');
    await getPrisma().tripStop.update({ where: { id: stop.id }, data: event === 'ARRIVED' ? { actualArrivalAt: new Date() } : { actualDepartureAt: new Date() } });
    return trackingService.viewById(trip.id);
  }

  async recordPositions(driverId: string, tripId: string, points: Array<{ lat: number; lng: number; speedKmh?: number; heading?: number; recordedAt: string }>) {
    const trip = await this.trip(driverId, tripId);
    if (trip.status !== TripStatus.BOARDING && trip.status !== TripStatus.IN_PROGRESS) throw stateError('GPS is accepted only while boarding or in progress');
    const now = Date.now();
    const valid = points.filter((p) => {
      const t = Date.parse(p.recordedAt);
      return Number.isFinite(t) && t <= now + 120_000 && t >= now - 24 * 3600_000;
    });
    if (valid.length > 0) {
      await getPrisma().vehiclePosition.createMany({
        data: valid.map((p) => ({
          tripId: trip.id,
          driverId,
          vehicleId: trip.vehicleId,
          latitude: p.lat,
          longitude: p.lng,
          speedKmh: p.speedKmh ?? null,
          heading: p.heading ?? null,
          recordedAt: new Date(p.recordedAt),
        })),
      });
    }
    return { accepted: valid.length, rejected: points.length - valid.length };
  }

  /** Verifies a QR code for this trip without boarding the passenger. Every scan is logged. */
  async scan(driverId: string, tripId: string, code: string) {
    const trip = await this.trip(driverId, tripId);
    const parsed = verifyTicketQr(code);
    const ticket = parsed ? await driverTripsRepository.findTicket(parsed.ticketNumber) : null;
    const result: BoardingScanResult = !parsed || !ticket
      ? BoardingScanResult.INVALID
      : ticket.booking.tripId !== trip.id || parsed.tripId !== trip.id
        ? BoardingScanResult.WRONG_TRIP
        : ticket.status !== TicketStatus.CONFIRMED || ticket.booking.status !== BookingStatus.CONFIRMED
          ? BoardingScanResult.CANCELLED
          : ticket.boardingStatus === BoardingStatus.BOARDED
            ? BoardingScanResult.ALREADY_BOARDED
            : BoardingScanResult.VALID;
    await getPrisma().boardingScan.create({
      data: { tripId: trip.id, driverId, ticketId: ticket?.id ?? null, method: BoardingMethod.QR, result, codeHash: sha256Hex(code) },
    });
    return {
      result,
      ticket: ticket && result !== BoardingScanResult.INVALID && result !== BoardingScanResult.WRONG_TRIP ? manifestEntry(ticket) : null,
      trip: { id: trip.id, tripNumber: trip.tripNumber, departureAt: trip.departureAt.toISOString(), origin: trip.origin, destination: trip.destination },
    };
  }

  /**
   * Boards a passenger (QR or manual). Idempotent: boarding an already boarded ticket returns it.
   * Unpaid cash tickets must be paid in full here: the collection is recorded per ticket and the
   * booking becomes PAID_CASH once every ticket is paid.
   */
  async board(driverId: string, tripId: string, input: { ticketNumber: string; method: 'QR' | 'MANUAL'; cashCollectedMinor?: number; requestId?: string }) {
    const trip = await this.trip(driverId, tripId);
    if (trip.status !== TripStatus.BOARDING && trip.status !== TripStatus.IN_PROGRESS) throw stateError('Start boarding first');
    const ticket = await driverTripsRepository.findTicket(input.ticketNumber);
    if (!ticket || ticket.booking.tripId !== trip.id) throw AppError.notFound('Ticket not found on this trip');
    if (ticket.status !== TicketStatus.CONFIRMED || ticket.booking.status !== BookingStatus.CONFIRMED) {
      throw new AppError({ statusCode: 409, code: ErrorCodes.BOOKING_NOT_CANCELLABLE, message: 'This ticket is not valid', details: { ticketStatus: ticket.status, bookingStatus: ticket.booking.status } });
    }
    if (ticket.boardingStatus === BoardingStatus.BOARDED) return { ...manifestEntry(ticket), replayed: true };

    const { cashToCollectMinor } = ticketMoney(ticket);
    if (cashToCollectMinor > 0 && input.cashCollectedMinor !== cashToCollectMinor) {
      throw new AppError({
        statusCode: 422,
        code: ErrorCodes.CASH_AMOUNT_MISMATCH,
        message: 'Collect the full cash fare before boarding',
        details: { cashToCollectMinor, cashCollectedMinor: input.cashCollectedMinor ?? 0 },
      });
    }

    await getPrisma().$transaction(async (tx) => {
      const moved = await tx.ticket.updateMany({
        where: { id: ticket.id, boardingStatus: { not: BoardingStatus.BOARDED } },
        data: { boardingStatus: BoardingStatus.BOARDED, boardedAt: new Date(), boardingMethod: input.method, boardedByDriverId: driverId },
      });
      if (moved.count === 0) return;
      if (cashToCollectMinor > 0) {
        await tx.cashCollection.create({ data: { ticketId: ticket.id, tripId: trip.id, driverId, amount: cashToCollectMinor } });
        const paid = await tx.cashCollection.count({ where: { ticket: { bookingId: ticket.booking.id } } });
        if (paid === ticket.booking._count.tickets) {
          await tx.booking.update({ where: { id: ticket.booking.id }, data: { paymentStatus: BookingPaymentStatus.PAID_CASH } });
        }
      }
      if (input.method === 'MANUAL') {
        await tx.boardingScan.create({ data: { tripId: trip.id, driverId, ticketId: ticket.id, method: BoardingMethod.MANUAL, result: BoardingScanResult.VALID } });
      }
      await auditService.record(
        { action: 'ticket.boarded', resourceType: 'ticket', resourceId: ticket.id, requestId: input.requestId, metadata: { tripId: trip.id, driverId, method: input.method, cashCollectedMinor: cashToCollectMinor } },
        tx,
      );
    });
    const fresh = await driverTripsRepository.findTicket(input.ticketNumber);
    return { ...manifestEntry(fresh!), replayed: false };
  }

  async markNoShow(driverId: string, tripId: string, ticketNumber: string) {
    const trip = await this.trip(driverId, tripId);
    if (trip.status !== TripStatus.BOARDING && trip.status !== TripStatus.IN_PROGRESS) throw stateError('No-shows are recorded during boarding or after departure');
    const ticket = await driverTripsRepository.findTicket(ticketNumber);
    if (!ticket || ticket.booking.tripId !== trip.id) throw AppError.notFound('Ticket not found on this trip');
    if (ticket.boardingStatus === BoardingStatus.BOARDED) throw stateError('The passenger already boarded');
    await getPrisma().ticket.update({ where: { id: ticket.id }, data: { boardingStatus: BoardingStatus.NO_SHOW } });
    return manifestEntry((await driverTripsRepository.findTicket(ticketNumber))!);
  }

  async cash(driverId: string, tripId: string) {
    const m = await this.manifest(driverId, tripId);
    const cashTickets = m.passengers.filter((p) => p.paymentMethod === 'CASH_ON_BOARD');
    return {
      tripId,
      expectedMinor: cashTickets.reduce((n, p) => n + p.cashToCollectMinor + p.cashCollectedMinor, 0),
      collectedMinor: cashTickets.reduce((n, p) => n + p.cashCollectedMinor, 0),
      outstandingMinor: cashTickets.filter((p) => p.boardingStatus !== BoardingStatus.NO_SHOW).reduce((n, p) => n + p.cashToCollectMinor, 0),
      tickets: cashTickets.map((p) => ({ ticketNumber: p.ticketNumber, seatLabel: p.seatLabel, passenger: p.passenger.fullName, fareMinor: p.fareMinor, collectedMinor: p.cashCollectedMinor, boardingStatus: p.boardingStatus })),
      currency: 'SDG' as const,
    };
  }
}

export const driverTripsService = new DriverTripsService();
