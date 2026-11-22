import {
  BookingChangeKind,
  BookingChannel,
  BookingLeg,
  BookingPaymentMethod,
  BookingPaymentStatus,
  BookingStatus,
  PaymentIntentPurpose,
  PrincipalType,
  Prisma,
  TicketStatus,
  TripSeatStatus,
  TripStatus,
  WalletLedgerType,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { env } from '../../config/env';
import { getPrisma, type PrismaTx } from '../../infrastructure/database/prisma';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import { assertNotInMaintenance, runtimeSettings } from '../../shared/settings/runtime-settings';
import { compareSeatLabels, computeCommission, decimalToNumber } from '../../shared/utils/money';
import { newBookingRef } from '../../shared/utils/references';
import { zonedDayRange } from '../../shared/utils/timezone';
import { auditService } from '../audit/audit.service';
import { BookingErrors } from '../bookings/bookings.errors';
import { catalogRepository } from '../catalog/catalog.repository';
import { CatalogErrors } from '../catalog/catalog.errors';
import { toTripCardView, type TripViewRow } from '../catalog/trip-view';
import { commissionsRepository } from '../commissions/commissions.repository';
import { notificationsService } from '../notifications/notifications.service';
import { getPaymentProvider } from '../payments';
import { WalletErrors } from '../wallets/wallets.errors';
import { walletsRepository } from '../wallets/wallets.repository';
import { walletsService } from '../wallets/wallets.service';
import { bookingChangesRepository, type ChangeBookingRow } from './booking-changes.repository';

/** Who changes the booking: the customer (direct channel) or a broker employee (office wallet). */
export type ChangeScope =
  | { channel: 'DIRECT'; customerId: string }
  | { channel: 'BROKER'; officeId: string; employeeId: string; seeWholeOffice: boolean };

/** New seats: customer seat holds, or broker employee holds on a trip. */
export type NewSeatsInput = { holdIds: string[] } | { tripId: string; seatIds: string[] };

const ISOLATION = Prisma.TransactionIsolationLevel.ReadCommitted;

function fail(statusCode: number, code: string, message: string, details?: unknown): AppError {
  return new AppError({ statusCode, code, message, ...(details !== undefined ? { details } : {}) });
}
const notAllowed = (message: string, details?: unknown) => fail(409, ErrorCodes.CHANGE_NOT_ALLOWED, message, details);

function ticketNumber(now = new Date()): string {
  return `ZG-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(5).toString('hex').toUpperCase()}`;
}

function activeTickets(b: ChangeBookingRow) {
  return b.tickets
    .filter((t) => t.status === TicketStatus.CONFIRMED)
    .sort((x, y) => compareSeatLabels(x.tripSeat?.seatLabel ?? '', y.tripSeat?.seatLabel ?? ''));
}

/**
 * D-CHG-01 "تعديل الرحلة" for customer and broker bookings.
 * - Seat change on the same trip: free, while the trip is SCHEDULED; same ticket number.
 * - Trip change: same carrier and cities, before `change.cutoffMinutesBeforeDeparture`, at most
 *   `change.maxChangesPerBooking` times; old booking → CHANGED, new booking linked by BookingChange.
 *   Money: difference + `change.feeMinor`. Customer online: pay (PaymentIntent CHANGE_DIFFERENCE,
 *   the old booking stays valid until paid) or refund; customer cash: collected at boarding;
 *   broker: wallet debit/credit and the commission is re-accrued on the new booking.
 */
export class BookingChangesService {
  private async load(scope: ChangeScope, bookingId: string, tx?: PrismaTx) {
    const b = await bookingChangesRepository.findBooking(bookingId, tx);
    const visible =
      b &&
      (scope.channel === 'DIRECT'
        ? b.channel === BookingChannel.DIRECT && b.customerId === scope.customerId
        : b.channel === BookingChannel.BROKER && b.officeId === scope.officeId && (scope.seeWholeOffice || b.employeeId === scope.employeeId));
    if (!b || !visible) throw BookingErrors.notFound();
    return b;
  }

  private assertChangeable(b: ChangeBookingRow, kind: 'SEAT' | 'TRIP') {
    if (b.status !== BookingStatus.CONFIRMED) throw notAllowed('Only confirmed bookings can be changed', { status: b.status });
    if (b.trip.status !== TripStatus.SCHEDULED || b.trip.departureAt.getTime() <= Date.now()) throw notAllowed('The trip already started');
    if (b.tickets.some((t) => t.boardingStatus === 'BOARDED')) throw notAllowed('A passenger already boarded');
    if (kind === 'TRIP') {
      const cutoff = runtimeSettings.number('change.cutoffMinutesBeforeDeparture');
      if ((b.trip.departureAt.getTime() - Date.now()) / 60_000 < cutoff) throw notAllowed('Trip changes are closed for this departure', { cutoffMinutes: cutoff });
      const max = runtimeSettings.number('change.maxChangesPerBooking');
      if (b.changeCount >= max) throw notAllowed('This booking reached the maximum number of changes', { max });
    }
  }

  // ------------------------------------------------------------------ seat change

  async changeSeat(scope: ChangeScope, bookingId: string, input: { fromSeatLabel: string; toSeatLabel: string; requestId?: string }) {
    const b = await this.load(scope, bookingId);
    this.assertChangeable(b, 'SEAT');
    const ticket = activeTickets(b).find((t) => t.tripSeat?.seatLabel === input.fromSeatLabel);
    if (!ticket?.tripSeat) throw AppError.validation('This seat is not part of the booking', { field: 'fromSeatLabel' });
    if (input.fromSeatLabel === input.toSeatLabel) throw AppError.validation('Choose a different seat', { field: 'toSeatLabel' });
    const passenger = b.passengers.find((p) => p.id === ticket.passengerId);

    await getPrisma().$transaction(async (tx) => {
      const target = await bookingChangesRepository.findSeatByLabel(b.tripId, input.toSeatLabel, tx);
      if (!target) throw CatalogErrors.seatNotFound();
      await bookingChangesRepository.lockSeats([target.id, ticket.tripSeat!.id], tx);
      const fresh = await bookingChangesRepository.findSeatByLabel(b.tripId, input.toSeatLabel, tx);
      const mine =
        fresh!.status === TripSeatStatus.HELD &&
        fresh!.hold !== null &&
        fresh!.hold.expiresAt.getTime() > Date.now() &&
        (scope.channel === 'DIRECT' ? fresh!.hold.customerId === scope.customerId : fresh!.hold.employeeId === scope.employeeId);
      if (fresh!.status !== TripSeatStatus.FREE && !mine) throw CatalogErrors.seatUnavailable({ unavailableSeatLabels: [input.toSeatLabel] });
      if (fresh!.isWomenOnly && passenger?.gender !== 'FEMALE') {
        throw fail(422, ErrorCodes.WOMEN_ONLY_SEAT, `Seat ${input.toSeatLabel} is for women only`, { seatLabel: input.toSeatLabel });
      }
      if (fresh!.hold) await tx.seatHold.delete({ where: { id: fresh!.hold.id } });
      await tx.tripSeat.update({ where: { id: fresh!.id }, data: { status: TripSeatStatus.SOLD } });
      await tx.tripSeat.update({ where: { id: ticket.tripSeat!.id }, data: { status: TripSeatStatus.FREE } });
      await tx.ticket.update({ where: { id: ticket.id }, data: { tripSeatId: fresh!.id } });
      await tx.bookingChange.create({
        data: {
          kind: BookingChangeKind.SEAT,
          bookingId: b.id,
          fromSeatLabel: input.fromSeatLabel,
          toSeatLabel: input.toSeatLabel,
          actorType: scope.channel === 'DIRECT' ? 'CUSTOMER' : 'BROKER_EMPLOYEE',
          actorId: scope.channel === 'DIRECT' ? scope.customerId : scope.employeeId,
        },
      });
      await auditService.record(
        { action: 'booking.seat_changed', resourceType: 'booking', resourceId: b.id, requestId: input.requestId, metadata: { from: input.fromSeatLabel, to: input.toSeatLabel, ticketNumber: ticket.ticketNumber } },
        tx,
      );
    });
    return { bookingId: b.id, ticketNumber: ticket.ticketNumber, fromSeatLabel: input.fromSeatLabel, toSeatLabel: input.toSeatLabel };
  }

  // ------------------------------------------------------------------ trip change

  /** Same carrier, same cities, one Sudan day: candidate trips with enough free seats. */
  async options(scope: ChangeScope, bookingId: string, date: string) {
    const b = await this.load(scope, bookingId);
    this.assertChangeable(b, 'TRIP');
    const from = b.trip.originStation?.city.id;
    const to = b.trip.destinationStation?.city.id;
    if (!from || !to) throw notAllowed('This trip has no structured route');
    const day = zonedDayRange(date, env().PLATFORM_TIMEZONE);
    const now = new Date();
    const trips = await bookingChangesRepository.alternativeTrips({
      companyId: b.trip.companyId,
      fromCityId: from,
      toCityId: to,
      excludeTripId: b.tripId,
      from: day.from > now ? day.from : now,
      to: day.to,
    });
    const counts = await catalogRepository.seatCountsByTrip(trips.map((t) => t.id));
    const n = activeTickets(b).length;
    return trips
      .filter((t) => (counts.get(t.id)?.FREE ?? 0) >= n && this.legOrderOk(b, t))
      .map((t) => ({ ...toTripCardView(t, counts.get(t.id)), priceDifferenceMinor: t.basePrice * n - (b.subtotalAmount ?? b.totalAmount) }));
  }

  /** Round trip: the outbound must still arrive before the return leaves, and vice versa. */
  private legOrderOk(b: ChangeBookingRow, t: { departureAt: Date; arrivalAt: Date | null }): boolean {
    if (!b.group || !b.leg) return true;
    const other = b.group.bookings.find((o) => o.id !== b.id && o.status === BookingStatus.CONFIRMED);
    if (!other) return true;
    if (b.leg === BookingLeg.OUTBOUND) return (t.arrivalAt ?? t.departureAt).getTime() <= other.trip.departureAt.getTime();
    return t.departureAt.getTime() >= (other.trip.arrivalAt ?? other.trip.departureAt).getTime();
  }

  private async resolveNewSeats(scope: ChangeScope, b: ChangeBookingRow, input: NewSeatsInput, tx?: PrismaTx) {
    const db = tx ?? getPrisma();
    const now = Date.now();
    let tripId: string;
    let seats: Array<{ id: string; seatLabel: string; isWomenOnly: boolean; holdId: string }>;
    if ('holdIds' in input) {
      if (scope.channel !== 'DIRECT') throw AppError.validation('Broker changes use tripId + seatIds');
      const holds = await db.seatHold.findMany({ where: { id: { in: input.holdIds } }, include: { tripSeat: true } });
      const ok = holds.filter((h) => h.customerId === scope.customerId && h.expiresAt.getTime() > now);
      if (ok.length !== input.holdIds.length || new Set(ok.map((h) => h.tripSeat.tripId)).size !== 1) throw BookingErrors.holdRequired({ holdIds: input.holdIds });
      tripId = ok[0]!.tripSeat.tripId;
      seats = ok.map((h) => ({ id: h.tripSeat.id, seatLabel: h.tripSeat.seatLabel, isWomenOnly: h.tripSeat.isWomenOnly, holdId: h.id }));
    } else {
      if (scope.channel !== 'BROKER') throw AppError.validation('Customer changes use holdIds');
      const rows = await db.tripSeat.findMany({ where: { tripId: input.tripId, id: { in: input.seatIds } }, include: { hold: true } });
      const ok = rows.filter((s) => s.status === TripSeatStatus.HELD && s.hold?.employeeId === scope.employeeId && s.hold.expiresAt.getTime() > now);
      if (rows.length !== input.seatIds.length) throw CatalogErrors.seatNotFound();
      if (ok.length !== input.seatIds.length) throw BookingErrors.holdRequired({ seatIds: input.seatIds });
      tripId = input.tripId;
      seats = ok.map((s) => ({ id: s.id, seatLabel: s.seatLabel, isWomenOnly: s.isWomenOnly, holdId: s.hold!.id }));
    }
    seats.sort((x, y) => compareSeatLabels(x.seatLabel, y.seatLabel));
    const trip = await bookingChangesRepository.findTripView(tripId, tx);
    if (!trip) throw CatalogErrors.tripNotFound();

    if (trip.id === b.tripId) throw notAllowed('Use the seat change for the same trip');
    if (trip.companyId !== b.trip.companyId) throw notAllowed('A booking can only move to another trip of the same carrier');
    const city = (s: TripViewRow['originStation']) => s?.city.id ?? null;
    if (city(trip.originStation) !== city(b.trip.originStation) || city(trip.destinationStation) !== city(b.trip.destinationStation) || city(trip.originStation) === null) {
      throw notAllowed('The new trip must serve the same cities');
    }
    if (!trip.isActive || trip.status !== TripStatus.SCHEDULED || trip.company.status !== 'ACTIVE' || trip.departureAt.getTime() <= now) throw CatalogErrors.tripNotBookable();
    if (!this.legOrderOk(b, trip)) throw fail(422, ErrorCodes.ROUND_TRIP_INVALID, 'The change would break the round-trip order');

    const tickets = activeTickets(b);
    if (seats.length !== tickets.length) throw BookingErrors.passengerSeatMismatch();
    const passengers = tickets.map((t) => b.passengers.find((p) => p.id === t.passengerId)!);
    seats.forEach((s, i) => {
      if (s.isWomenOnly && passengers[i]!.gender !== 'FEMALE') {
        throw fail(422, ErrorCodes.WOMEN_ONLY_SEAT, `Seat ${s.seatLabel} is for women only`, { seatLabel: s.seatLabel, passengerIndex: i });
      }
    });
    return { trip, seats, passengers };
  }

  private price(scope: ChangeScope, b: ChangeBookingRow, trip: TripViewRow, seatCount: number) {
    const fee = runtimeSettings.number('change.feeMinor');
    const newSubtotal = trip.basePrice * seatCount;
    const carried = scope.channel === 'DIRECT' ? Math.min(b.discountAmount, newSubtotal) : 0;
    const newTotal = newSubtotal - carried;
    const cash = b.paymentStatus === BookingPaymentStatus.UNPAID_CASH;
    const diff = newTotal + fee - b.totalAmount;
    return {
      oldTotalMinor: b.totalAmount,
      newSubtotalMinor: newSubtotal,
      discountCarriedMinor: carried,
      newTotalMinor: newTotal,
      changeFeeMinor: fee,
      priceDifferenceMinor: newTotal - b.totalAmount,
      /** Charged now (online difference or broker wallet debit) */
      payMinor: cash ? 0 : Math.max(diff, 0),
      /** Returned now (original method or broker wallet) */
      refundMinor: cash ? 0 : Math.max(-diff, 0),
      /** Cash bookings: the driver collects the new total + fee at boarding */
      collectOnBoardMinor: cash ? newTotal + fee : 0,
    };
  }

  async quote(scope: ChangeScope, bookingId: string, input: NewSeatsInput) {
    const b = await this.load(scope, bookingId);
    this.assertChangeable(b, 'TRIP');
    const { trip, seats } = await this.resolveNewSeats(scope, b, input);
    let commission: { percent: number; newCommissionMinor: number } | null = null;
    if (scope.channel === 'BROKER') {
      const assignment = await catalogRepository.findAssignment(scope.officeId, trip.companyId);
      if (!assignment) throw CatalogErrors.tripNotFound();
      const percent = decimalToNumber(assignment.commissionPercent);
      commission = { percent, newCommissionMinor: computeCommission(trip.basePrice * seats.length, percent) };
    }
    return {
      bookingId: b.id,
      newTrip: toTripCardView(trip, undefined),
      seats: seats.map((s) => s.seatLabel),
      ...this.price(scope, b, trip, seats.length),
      ...(commission ? { commission } : {}),
      currency: 'SDG' as const,
    };
  }

  /** Customer trip change. Returns the new booking id and, when a difference is due, the payment. */
  async changeCustomerTrip(customerId: string, bookingId: string, input: { holdIds: string[]; idempotencyKey: string; requestId?: string }) {
    const scope: ChangeScope = { channel: 'DIRECT', customerId };
    const checkoutKey = `${customerId}:${input.idempotencyKey}:chg`.slice(0, 191);
    const replay = await bookingChangesRepository.findByCheckoutKey(checkoutKey);
    if (replay) return { newBookingId: replay.id, replayed: true };
    assertNotInMaintenance();

    const out = await getPrisma().$transaction(
      async (tx) => {
        const b = await this.load(scope, bookingId, tx);
        this.assertChangeable(b, 'TRIP');
        const pending = await tx.bookingChange.findFirst({ where: { bookingId: b.id, newBooking: { status: BookingStatus.PENDING_PAYMENT } } });
        if (pending) throw notAllowed('A change of this booking is waiting for payment');
        const first = await this.resolveNewSeats(scope, b, input, tx);
        await bookingChangesRepository.lockSeats(first.seats.map((s) => s.id), tx);
        const { trip, seats, passengers } = await this.resolveNewSeats(scope, b, input, tx);
        const p = this.price(scope, b, trip, seats.length);
        const cash = b.paymentStatus === BookingPaymentStatus.UNPAID_CASH;
        const awaitingPayment = p.payMinor > 0;
        const now = new Date();

        const nb = await tx.booking.create({
          data: {
            bookingRef: newBookingRef(env().PLATFORM_TIMEZONE, now),
            channel: BookingChannel.DIRECT,
            customerId,
            tripId: trip.id,
            groupId: b.groupId,
            leg: b.leg,
            status: awaitingPayment ? BookingStatus.PENDING_PAYMENT : BookingStatus.CONFIRMED,
            paymentMethod: b.paymentMethod,
            paymentStatus: cash ? BookingPaymentStatus.UNPAID_CASH : awaitingPayment ? BookingPaymentStatus.PENDING : BookingPaymentStatus.PAID,
            subtotalAmount: p.newSubtotalMinor,
            discountAmount: p.discountCarriedMinor,
            totalAmount: cash ? p.collectOnBoardMinor : p.newTotalMinor,
            commissionAmount: 0,
            changeCount: b.changeCount + 1,
            confirmedAt: awaitingPayment ? null : now,
            checkoutKey,
          },
        });
        await this.copyPassengers(tx, nb.id, passengers, seats, now);
        await tx.bookingChange.create({
          data: {
            kind: BookingChangeKind.TRIP,
            bookingId: b.id,
            newBookingId: nb.id,
            priceDifferenceAmount: p.priceDifferenceMinor,
            changeFeeAmount: p.changeFeeMinor,
            actorType: 'CUSTOMER',
            actorId: customerId,
          },
        });

        let intentId: string | null = null;
        let refundId: string | null = null;
        if (awaitingPayment) {
          const intent = await tx.paymentIntent.create({
            data: {
              customerId,
              purpose: PaymentIntentPurpose.CHANGE_DIFFERENCE,
              bookingId: nb.id,
              amount: p.payMinor,
              provider: getPaymentProvider().name,
              idempotencyKey: `change:${checkoutKey}`,
              expiresAt: new Date(now.getTime() + runtimeSettings.number('payment.onlineIntentTtlSeconds') * 1000),
            },
          });
          const charge = await getPaymentProvider().createCharge({ intentId: intent.id, customerId, amount: p.payMinor, currency: 'SDG' });
          await tx.paymentIntent.update({ where: { id: intent.id }, data: { providerRef: charge.providerRef } });
          intentId = intent.id;
        } else {
          await bookingChangesRepository.retireChangedBooking(b.id, tx);
          if (p.refundMinor > 0) {
            const refund = await tx.refund.create({
              data: { bookingId: b.id, paymentIntentId: b.paymentIntents[0]?.id ?? null, amount: p.refundMinor, reason: 'CHANGE_DIFFERENCE', idempotencyKey: `change-refund:${nb.id}` },
            });
            refundId = refund.id;
          }
          await notificationsService.notify(
            [{ type: PrincipalType.CUSTOMER, id: customerId }],
            { type: 'TICKET_ISSUED', title: 'تم تعديل رحلتك', body: 'صدرت تذاكر جديدة للرحلة الجديدة.', data: { bookingId: nb.id } },
            tx,
          );
        }
        await auditService.record(
          { action: 'booking.trip_changed', resourceType: 'booking', resourceId: b.id, requestId: input.requestId, metadata: { newBookingId: nb.id, newTripId: trip.id, ...p } },
          tx,
        );
        return { newBookingId: nb.id, intentId, refundId };
      },
      { isolationLevel: ISOLATION, maxWait: 10_000, timeout: 20_000 },
    );
    return { ...out, replayed: false };
  }

  /** Broker trip change: wallet difference + commission re-accrual, all in one transaction. */
  async changeBrokerTrip(
    scope: Extract<ChangeScope, { channel: 'BROKER' }>,
    bookingId: string,
    input: { tripId: string; seatIds: string[]; idempotencyKey: string; requestId?: string },
  ) {
    const checkoutKey = `${scope.officeId}:${input.idempotencyKey}:chg`.slice(0, 191);
    const replay = await bookingChangesRepository.findByCheckoutKey(checkoutKey);
    if (replay) return { newBookingId: replay.id, replayed: true };
    assertNotInMaintenance();
    const wallet = await walletsRepository.findByOfficeId(scope.officeId);
    if (!wallet) throw WalletErrors.walletNotFound();

    const out = await getPrisma().$transaction(
      async (tx) => {
        await walletsService.lock(wallet.id, tx);
        const b = await this.load(scope, bookingId, tx);
        this.assertChangeable(b, 'TRIP');
        const { trip, seats, passengers } = await this.resolveNewSeats(scope, b, { tripId: input.tripId, seatIds: input.seatIds }, tx);
        const assignment = await catalogRepository.findAssignment(scope.officeId, trip.companyId, tx);
        if (!assignment) throw CatalogErrors.tripNotFound();
        const p = this.price(scope, b, trip, seats.length);
        const commission = computeCommission(p.newTotalMinor, decimalToNumber(assignment.commissionPercent));
        const now = new Date();

        const nb = await tx.booking.create({
          data: {
            bookingRef: newBookingRef(env().PLATFORM_TIMEZONE, now),
            channel: BookingChannel.BROKER,
            officeId: scope.officeId,
            employeeId: scope.employeeId,
            tripId: trip.id,
            groupId: b.groupId,
            leg: b.leg,
            status: BookingStatus.CONFIRMED,
            paymentMethod: BookingPaymentMethod.WALLET,
            paymentStatus: BookingPaymentStatus.PAID,
            subtotalAmount: p.newTotalMinor,
            totalAmount: p.newTotalMinor,
            commissionAmount: commission,
            changeCount: b.changeCount + 1,
            confirmedAt: now,
            checkoutKey,
          },
        });
        await this.copyPassengers(tx, nb.id, passengers, seats, now);

        const ledgerKey = `change:${checkoutKey}`;
        if (p.payMinor > 0) {
          const debit = await walletsService.debit(tx, { walletId: wallet.id, amount: p.payMinor, type: WalletLedgerType.DEBIT_BOOKING, idempotencyKey: ledgerKey, referenceType: 'booking', referenceId: nb.id });
          if (debit.replayed) throw BookingErrors.idempotencyInFlight();
        } else if (p.refundMinor > 0) {
          await walletsService.credit(tx, { walletId: wallet.id, amount: p.refundMinor, type: WalletLedgerType.CREDIT_REFUND, idempotencyKey: ledgerKey, referenceType: 'booking', referenceId: b.id });
        }
        await commissionsRepository.markClawedBack(b.id, tx);
        await commissionsRepository.createAccrual({ bookingId: nb.id, officeId: scope.officeId, amount: commission }, tx);
        await bookingChangesRepository.retireChangedBooking(b.id, tx);
        await tx.bookingChange.create({
          data: {
            kind: BookingChangeKind.TRIP,
            bookingId: b.id,
            newBookingId: nb.id,
            priceDifferenceAmount: p.priceDifferenceMinor,
            changeFeeAmount: p.changeFeeMinor,
            actorType: 'BROKER_EMPLOYEE',
            actorId: scope.employeeId,
          },
        });
        await auditService.record(
          { action: 'booking.trip_changed', resourceType: 'booking', resourceId: b.id, requestId: input.requestId, metadata: { newBookingId: nb.id, newTripId: trip.id, officeId: scope.officeId, commission, ...p } },
          tx,
        );
        return { newBookingId: nb.id };
      },
      { isolationLevel: ISOLATION, maxWait: 10_000, timeout: 20_000 },
    );
    return { ...out, replayed: false };
  }

  private async copyPassengers(
    tx: PrismaTx,
    bookingId: string,
    passengers: Array<{ fullName: string; phone: string | null; idNumber: string | null; gender: 'MALE' | 'FEMALE' | null }>,
    seats: Array<{ id: string; holdId: string }>,
    now: Date,
  ) {
    for (const [i, seat] of seats.entries()) {
      const p = passengers[i]!;
      const row = await tx.bookingPassenger.create({ data: { bookingId, fullName: p.fullName, phone: p.phone, idNumber: p.idNumber, gender: p.gender } });
      await tx.ticket.create({ data: { bookingId, tripSeatId: seat.id, passengerId: row.id, ticketNumber: ticketNumber(now) } });
    }
    const sold = await tx.tripSeat.updateMany({ where: { id: { in: seats.map((s) => s.id) }, status: TripSeatStatus.HELD }, data: { status: TripSeatStatus.SOLD } });
    if (sold.count !== seats.length) throw CatalogErrors.seatUnavailable();
    await tx.seatHold.deleteMany({ where: { id: { in: seats.map((s) => s.holdId) } } });
  }
}

export const bookingChangesService = new BookingChangesService();
