import {
  BookingChannel,
  BookingGroupType,
  BookingLeg,
  BookingPaymentMethod,
  BookingPaymentStatus,
  BookingStatus,
  PaymentIntentPurpose,
  PaymentIntentStatus,
  PrincipalType,
  Prisma,
  TransportCompanyStatus,
  TripSeatStatus,
  type Coupon,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { env } from '../../config/env';
import { getPrisma, type PrismaTx } from '../../infrastructure/database/prisma';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import { assertNotInMaintenance, runtimeSettings } from '../../shared/settings/runtime-settings';
import { compareSeatLabels } from '../../shared/utils/money';
import { normalizePhone } from '../../shared/utils/phone';
import { newBookingRef } from '../../shared/utils/references';
import { auditService } from '../audit/audit.service';
import { BookingErrors } from '../bookings/bookings.errors';
import { BOOKABLE_TRIP_STATUSES } from '../catalog/catalog.repository';
import { CatalogErrors } from '../catalog/catalog.errors';
import { toTripCardView, type TripViewRow } from '../catalog/trip-view';
import { computeCouponDiscount } from '../coupons/coupons.service';
import { notificationsService } from '../notifications/notifications.service';
import {
  getPaymentProvider,
  isMockPaymentEnabled,
  registerCustomerIntentWebhookHandler,
  type ParsedWebhookEvent,
} from '../payments';
import { bookingChangesRepository } from '../booking-changes/booking-changes.repository';
import { customerBookingsRepository, type CustomerHoldRow } from './customer-bookings.repository';

export interface CheckoutPassenger {
  fullName: string;
  gender: 'MALE' | 'FEMALE';
  phone?: string;
  idNumber?: string;
}

export interface CheckoutInput {
  holdIds: string[];
  passengers: CheckoutPassenger[];
  couponCode?: string;
  paymentMethod?: 'ONLINE' | 'CASH_ON_BOARD';
}

export type CashBlockReason =
  | 'CASH_DISABLED'
  | 'CARRIER_CASH_DISABLED'
  | 'TOO_MANY_SEATS'
  | 'OPEN_CASH_LIMIT'
  | 'TOO_CLOSE_TO_DEPARTURE'
  | 'NO_SHOW_LIMIT';

interface Leg {
  leg: BookingLeg | null;
  trip: TripViewRow;
  /** Seats sorted by label; passenger i sits in seat i */
  seats: Array<{ id: string; label: string; isWomenOnly: boolean }>;
  holdIds: string[];
  subtotalMinor: number;
  discountMinor: number;
  totalMinor: number;
}

const ISOLATION = Prisma.TransactionIsolationLevel.ReadCommitted;

function fail(statusCode: number, code: string, message: string, details?: unknown): AppError {
  return new AppError({ statusCode, code, message, ...(details !== undefined ? { details } : {}) });
}

function ticketNumber(now = new Date()): string {
  return `ZG-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(5).toString('hex').toUpperCase()}`;
}

function passengerPhone(phone?: string): string | null {
  if (!phone?.trim()) return null;
  try {
    return normalizePhone(phone);
  } catch {
    return phone.trim();
  }
}

/** Splits a total discount across legs in proportion to their subtotals (integers, exact sum). */
function splitDiscount(discount: number, subtotals: number[]): number[] {
  const total = subtotals.reduce((a, b) => a + b, 0);
  if (discount === 0 || total === 0) return subtotals.map(() => 0);
  const parts = subtotals.map((s) => Math.floor((discount * s) / total));
  parts[0]! += discount - parts.reduce((a, b) => a + b, 0);
  return parts;
}

/**
 * Customer checkout (D-CASH-01, D-RT-01): quote and create, online payment completion and expiry.
 * One checkout = one booking, or a round-trip group of two bookings paid together.
 */
export class CustomerCheckoutService {
  // ------------------------------------------------------------------ validation

  private async legs(customerId: string, input: CheckoutInput, tx?: PrismaTx): Promise<Leg[]> {
    const holdIds = [...new Set(input.holdIds)];
    if (holdIds.length !== input.holdIds.length) throw AppError.validation('Duplicate holdIds', { field: 'holdIds' });
    const holds = await customerBookingsRepository.findHolds(holdIds, tx);
    const now = Date.now();
    const missing = holdIds.filter((id) => !holds.some((h) => h.id === id && h.customerId === customerId));
    if (missing.length > 0) throw BookingErrors.holdRequired({ holdIds: missing });
    const expired = holds.filter((h) => h.expiresAt.getTime() <= now).map((h) => h.id);
    if (expired.length > 0) throw fail(409, ErrorCodes.HOLD_EXPIRED, 'Seat hold expired; select the seats again', { holdIds: expired });

    const byTrip = new Map<string, CustomerHoldRow[]>();
    for (const h of holds) byTrip.set(h.tripSeat.tripId, [...(byTrip.get(h.tripSeat.tripId) ?? []), h]);
    if (byTrip.size > 2) throw fail(422, ErrorCodes.ROUND_TRIP_INVALID, 'A checkout covers one trip or a round trip (two trips)');

    const legs = [...byTrip.values()]
      .map((hs) => {
        const trip = hs[0]!.tripSeat.trip;
        const seats = hs
          .map((h) => ({ id: h.tripSeat.id, label: h.tripSeat.seatLabel, isWomenOnly: h.tripSeat.isWomenOnly, holdId: h.id }))
          .sort((a, b) => compareSeatLabels(a.label, b.label));
        return { trip, seats, holdIds: seats.map((s) => s.holdId) };
      })
      .sort((a, b) => a.trip.departureAt.getTime() - b.trip.departureAt.getTime());

    for (const l of legs) {
      if (
        !l.trip.isActive ||
        !BOOKABLE_TRIP_STATUSES.includes(l.trip.status) ||
        l.trip.company.status !== TransportCompanyStatus.ACTIVE ||
        l.trip.departureAt.getTime() <= now
      ) {
        throw CatalogErrors.tripNotBookable();
      }
      if (l.seats.length !== input.passengers.length) throw BookingErrors.passengerSeatMismatch();
      l.seats.forEach((seat, i) => {
        if (seat.isWomenOnly && input.passengers[i]!.gender !== 'FEMALE') {
          throw fail(422, ErrorCodes.WOMEN_ONLY_SEAT, `Seat ${seat.label} is for women only`, { tripId: l.trip.id, seatLabel: seat.label, passengerIndex: i });
        }
      });
    }

    if (legs.length === 2) {
      const [out, back] = legs as [(typeof legs)[0], (typeof legs)[0]];
      const city = (p: TripViewRow['originStation']) => p?.city.id ?? null;
      const mirrored =
        city(out.trip.originStation) !== null &&
        city(out.trip.originStation) === city(back.trip.destinationStation) &&
        city(out.trip.destinationStation) === city(back.trip.originStation);
      if (!mirrored) throw fail(422, ErrorCodes.ROUND_TRIP_INVALID, 'The return trip must go back between the same two cities');
      const outArrival = (out.trip.arrivalAt ?? out.trip.departureAt).getTime();
      if (back.trip.departureAt.getTime() < outArrival) {
        throw fail(422, ErrorCodes.ROUND_TRIP_INVALID, 'The return trip must depart after the outbound trip arrives');
      }
    }

    return legs.map((l, i) => {
      const subtotal = l.trip.basePrice * l.seats.length;
      return {
        leg: legs.length === 2 ? (i === 0 ? BookingLeg.OUTBOUND : BookingLeg.RETURN) : null,
        trip: l.trip,
        seats: l.seats.map(({ holdId: _h, ...s }) => s),
        holdIds: l.holdIds,
        subtotalMinor: subtotal,
        discountMinor: 0,
        totalMinor: subtotal,
      };
    });
  }

  private async coupon(customerId: string, code: string | undefined, legs: Leg[], tx?: PrismaTx): Promise<Coupon | null> {
    if (!code) return null;
    const coupon = await customerBookingsRepository.findCoupon(code.trim().toUpperCase(), tx);
    const now = Date.now();
    const subtotal = legs.reduce((a, l) => a + l.subtotalMinor, 0);
    const reason = !coupon || !coupon.isActive
      ? 'NOT_FOUND'
      : coupon.validFrom.getTime() > now || coupon.validTo.getTime() < now
        ? 'EXPIRED'
        : coupon.companyId && legs.some((l) => l.trip.companyId !== coupon.companyId)
          ? 'WRONG_CARRIER'
          : coupon.minSubtotalAmount !== null && subtotal < coupon.minSubtotalAmount
            ? 'BELOW_MINIMUM'
            : coupon.maxRedemptions !== null && coupon.redeemedCount >= coupon.maxRedemptions
              ? 'USED_UP'
              : (await customerBookingsRepository.countCouponUses(coupon.id, customerId, tx)) >= coupon.perCustomerLimit
                ? 'ALREADY_USED'
                : null;
    if (reason) throw fail(422, ErrorCodes.COUPON_INVALID, 'Coupon cannot be applied', { reason, ...(coupon?.minSubtotalAmount ? { minSubtotalMinor: coupon.minSubtotalAmount } : {}) });
    const discount = computeCouponDiscount(coupon!, subtotal);
    splitDiscount(discount, legs.map((l) => l.subtotalMinor)).forEach((d, i) => {
      legs[i]!.discountMinor = d;
      legs[i]!.totalMinor = legs[i]!.subtotalMinor - d;
    });
    return coupon;
  }

  /** D-CASH-01 eligibility for this checkout; null = allowed. */
  private async cashBlock(customerId: string, legs: Leg[], tx?: PrismaTx): Promise<CashBlockReason | null> {
    if (!runtimeSettings.boolean('cash.enabled')) return 'CASH_DISABLED';
    if (legs.some((l) => !l.trip.company.cashEnabled)) return 'CARRIER_CASH_DISABLED';
    if (legs.some((l) => l.seats.length > runtimeSettings.number('cash.maxSeatsPerBooking'))) return 'TOO_MANY_SEATS';
    const cutoffMs = runtimeSettings.number('cash.cutoffMinutesBeforeDeparture') * 60_000;
    if (legs.some((l) => l.trip.departureAt.getTime() - Date.now() < cutoffMs)) return 'TOO_CLOSE_TO_DEPARTURE';
    const customer = await (tx ?? getPrisma()).customer.findUniqueOrThrow({ where: { id: customerId }, select: { cashNoShowCount: true } });
    if (customer.cashNoShowCount >= runtimeSettings.number('cash.noShowLimit')) return 'NO_SHOW_LIMIT';
    const open = await customerBookingsRepository.countOpenCashBookings(customerId, tx);
    if (open + legs.length > runtimeSettings.number('cash.maxOpenBookingsPerCustomer')) return 'OPEN_CASH_LIMIT';
    return null;
  }

  // ------------------------------------------------------------------ quote

  async quote(customerId: string, input: CheckoutInput) {
    const legs = await this.legs(customerId, input);
    const coupon = await this.coupon(customerId, input.couponCode, legs);
    const cashBlockedReason = await this.cashBlock(customerId, legs);
    const sum = (k: 'subtotalMinor' | 'discountMinor' | 'totalMinor') => legs.reduce((a, l) => a + l[k], 0);
    const holds = await customerBookingsRepository.findHolds(input.holdIds);
    const holdExpiresAt = new Date(Math.min(...holds.map((h) => h.expiresAt.getTime())));
    return {
      type: legs.length === 2 ? 'ROUND_TRIP' : 'ONE_WAY',
      legs: legs.map((l) => ({
        leg: l.leg,
        trip: toTripCardView(l.trip, undefined),
        seats: l.seats.map((s, i) => ({ label: s.label, isWomenOnly: s.isWomenOnly, passengerName: input.passengers[i]!.fullName })),
        unitPriceMinor: l.trip.basePrice,
        subtotalMinor: l.subtotalMinor,
        discountMinor: l.discountMinor,
        totalMinor: l.totalMinor,
      })),
      subtotalMinor: sum('subtotalMinor'),
      discountMinor: sum('discountMinor'),
      totalMinor: sum('totalMinor'),
      currency: 'SDG' as const,
      coupon: coupon ? { code: coupon.code, discountMinor: sum('discountMinor') } : null,
      cashAllowed: cashBlockedReason === null,
      cashBlockedReason,
      holdExpiresAt: holdExpiresAt.toISOString(),
    };
  }

  // ------------------------------------------------------------------ create

  async create(customerId: string, input: CheckoutInput & { paymentMethod: 'ONLINE' | 'CASH_ON_BOARD'; idempotencyKey: string; requestId?: string }) {
    const baseKey = `${customerId}:${input.idempotencyKey}`.slice(0, 180);
    const replay = await customerBookingsRepository.findByCheckoutKey(`${baseKey}:1`);
    if (replay) return { ...(await this.result(customerId, replay.id)), replayed: true };
    assertNotInMaintenance();

    const cash = input.paymentMethod === 'CASH_ON_BOARD';
    let created: { bookingIds: string[]; intentId: string | null };
    try {
      created = await getPrisma().$transaction(
        async (tx) => {
          const preliminary = await this.legs(customerId, input, tx);
          await customerBookingsRepository.lockSeats(preliminary.flatMap((l) => l.seats.map((s) => s.id)), tx);
          // Re-validate under the row locks (a concurrent checkout may have just sold the seats).
          const legs = await this.legs(customerId, input, tx);
          const coupon = await this.coupon(customerId, input.couponCode, legs, tx);
          if (cash) {
            const reason = await this.cashBlock(customerId, legs, tx);
            if (reason) throw fail(409, ErrorCodes.CASH_NOT_ALLOWED, 'Cash on board is not available for this booking', { reason });
          }
          const total = legs.reduce((a, l) => a + l.totalMinor, 0);
          const now = new Date();
          const paidInFull = total === 0;
          const confirmed = cash || paidInFull;

          const group =
            legs.length === 2
              ? await tx.bookingGroup.create({ data: { type: BookingGroupType.ROUND_TRIP, channel: BookingChannel.DIRECT, customerId } })
              : null;

          const bookingIds: string[] = [];
          for (const [i, l] of legs.entries()) {
            const booking = await tx.booking.create({
              data: {
                bookingRef: newBookingRef(env().PLATFORM_TIMEZONE, now),
                channel: BookingChannel.DIRECT,
                customerId,
                tripId: l.trip.id,
                groupId: group?.id ?? null,
                leg: l.leg,
                status: confirmed ? BookingStatus.CONFIRMED : BookingStatus.PENDING_PAYMENT,
                paymentMethod: cash ? BookingPaymentMethod.CASH_ON_BOARD : BookingPaymentMethod.ONLINE,
                paymentStatus: paidInFull ? BookingPaymentStatus.PAID : cash ? BookingPaymentStatus.UNPAID_CASH : BookingPaymentStatus.PENDING,
                subtotalAmount: l.subtotalMinor,
                discountAmount: l.discountMinor,
                totalAmount: l.totalMinor,
                commissionAmount: 0,
                confirmedAt: confirmed ? now : null,
                checkoutKey: `${baseKey}:${i + 1}`,
              },
            });
            bookingIds.push(booking.id);
            for (const [p, seat] of l.seats.entries()) {
              const passenger = input.passengers[p]!;
              const row = await tx.bookingPassenger.create({
                data: {
                  bookingId: booking.id,
                  fullName: passenger.fullName,
                  gender: passenger.gender,
                  phone: passengerPhone(passenger.phone),
                  idNumber: passenger.idNumber?.trim() || null,
                },
              });
              await tx.ticket.create({ data: { bookingId: booking.id, tripSeatId: seat.id, passengerId: row.id, ticketNumber: ticketNumber(now) } });
            }
            const sold = await tx.tripSeat.updateMany({ where: { id: { in: l.seats.map((s) => s.id) }, status: TripSeatStatus.HELD }, data: { status: TripSeatStatus.SOLD } });
            if (sold.count !== l.seats.length) throw CatalogErrors.seatUnavailable();
            await tx.seatHold.deleteMany({ where: { id: { in: l.holdIds } } });
          }

          if (coupon) {
            if (!(await customerBookingsRepository.takeCouponUse(coupon.id, coupon.maxRedemptions, tx))) {
              throw fail(422, ErrorCodes.COUPON_INVALID, 'Coupon cannot be applied', { reason: 'USED_UP' });
            }
            await tx.couponRedemption.create({
              data: { couponId: coupon.id, customerId, bookingId: bookingIds[0]!, discountAmount: legs.reduce((a, l) => a + l.discountMinor, 0) },
            });
          }

          let intentId: string | null = null;
          if (!confirmed) {
            const ttl = runtimeSettings.number('payment.onlineIntentTtlSeconds') * 1000;
            const intent = await tx.paymentIntent.create({
              data: {
                customerId,
                purpose: PaymentIntentPurpose.BOOKING,
                bookingId: group ? null : bookingIds[0]!,
                groupId: group?.id ?? null,
                amount: total,
                provider: getPaymentProvider().name,
                idempotencyKey: `booking:${baseKey}`,
                expiresAt: new Date(now.getTime() + ttl),
              },
            });
            const charge = await getPaymentProvider().createCharge({ intentId: intent.id, customerId, amount: total, currency: 'SDG' });
            await tx.paymentIntent.update({ where: { id: intent.id }, data: { providerRef: charge.providerRef } });
            intentId = intent.id;
          } else {
            await notificationsService.notify(
              [{ type: PrincipalType.CUSTOMER, id: customerId }],
              { type: 'TICKET_ISSUED', title: 'تم إصدار تذكرتك', body: cash ? 'حجزك مؤكد، ادفع للسائق عند الصعود.' : 'حجزك مؤكد.', data: { bookingId: bookingIds[0] } },
              tx,
            );
          }

          await auditService.record(
            {
              action: 'customer.booking.created',
              resourceType: 'booking',
              resourceId: bookingIds[0]!,
              requestId: input.requestId,
              metadata: { customerId, bookingIds, paymentMethod: input.paymentMethod, totalAmount: total, coupon: coupon?.code ?? null },
            },
            tx,
          );
          return { bookingIds, intentId };
        },
        { isolationLevel: ISOLATION, maxWait: 10_000, timeout: 20_000 },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const again = await customerBookingsRepository.findByCheckoutKey(`${baseKey}:1`);
        if (again) return { ...(await this.result(customerId, again.id)), replayed: true };
      }
      throw error;
    }
    return { ...(await this.result(customerId, created.bookingIds[0]!)), replayed: false };
  }

  /** `{ group, bookingIds, payment }` for a checkout identified by its first booking. */
  private async result(customerId: string, firstBookingId: string) {
    const first = await customerBookingsRepository.findForCustomer(firstBookingId, customerId);
    if (!first) throw BookingErrors.notFound();
    const bookingIds = first.group ? [...first.group.bookings].sort((a, b) => (a.leg === BookingLeg.OUTBOUND ? -1 : b.leg === BookingLeg.OUTBOUND ? 1 : 0)).map((b) => b.id) : [first.id];
    const intents = await customerBookingsRepository.findIntents(first);
    return {
      groupId: first.groupId,
      bookingIds,
      payment: intents[0] ? this.paymentView(intents[0]) : null,
    };
  }

  paymentView(intent: { id: string; status: PaymentIntentStatus; amount: number; provider: string; expiresAt: Date; succeededAt: Date | null; failureReason: string | null }) {
    const pending = intent.status === PaymentIntentStatus.PENDING;
    return {
      intentId: intent.id,
      status: intent.status,
      amountMinor: intent.amount,
      currency: 'SDG' as const,
      provider: intent.provider,
      expiresAt: intent.expiresAt.toISOString(),
      succeededAt: intent.succeededAt?.toISOString() ?? null,
      failureReason: intent.failureReason,
      /** What the app does next; a real PSP adapter returns a redirect/SDK action (D-PAY-01) */
      nextAction: pending
        ? isMockPaymentEnabled() && intent.provider === 'mock'
          ? { type: 'MOCK_CONFIRM' as const, endpoint: `/customer/payments/${intent.id}/mock-confirm` }
          : { type: 'AWAIT_PROVIDER' as const }
        : null,
    };
  }

  // ------------------------------------------------------------------ payment outcome

  /**
   * Marks the intent paid and confirms its bookings. If the intent had already expired (payment
   * arrived late) the money is recorded and a refund is queued for the admin refunds queue.
   */
  async completeIntent(intentId: string, input: { providerRef?: string | null; providerEventId?: string; amountMinor?: number }) {
    const intent = await customerBookingsRepository.findIntent(intentId);
    if (!intent) return null;
    if (input.amountMinor !== undefined && input.amountMinor !== intent.amount) {
      throw fail(409, ErrorCodes.PAYMENT_MISMATCH, 'Paid amount does not match the payment', { expectedAmountMinor: intent.amount, paidAmountMinor: input.amountMinor });
    }
    if (intent.status === PaymentIntentStatus.SUCCEEDED) return { intentId, status: intent.status, replayed: true };

    await getPrisma().$transaction(async (tx) => {
      const data = {
        succeededAt: new Date(),
        ...(input.providerRef ? { providerRef: input.providerRef } : {}),
        ...(input.providerEventId ? { providerEventId: input.providerEventId } : {}),
      };
      const fresh = await customerBookingsRepository.transitionIntent(intentId, PaymentIntentStatus.SUCCEEDED, data, tx);
      const bookings = await customerBookingsRepository.bookingsOfIntent(intent, tx);
      if (!fresh) {
        // Expired or cancelled before the money arrived: keep the money traceable and refund it.
        const current = await customerBookingsRepository.findIntent(intentId, tx);
        if (current?.status === PaymentIntentStatus.SUCCEEDED) return;
        await tx.paymentIntent.update({ where: { id: intentId }, data: { status: PaymentIntentStatus.SUCCEEDED, ...data } });
        await tx.refund.create({
          data: { bookingId: bookings[0]!.id, paymentIntentId: intentId, amount: intent.amount, reason: 'ADMIN', idempotencyKey: `late-payment:${intentId}` },
        });
        await auditService.record({ action: 'customer.payment.late', resourceType: 'payment_intent', resourceId: intentId, metadata: { amount: intent.amount } }, tx);
        return;
      }
      await tx.booking.updateMany({
        where: { id: { in: bookings.map((b) => b.id) }, status: BookingStatus.PENDING_PAYMENT },
        data: { status: BookingStatus.CONFIRMED, paymentStatus: BookingPaymentStatus.PAID, confirmedAt: new Date() },
      });
      if (intent.purpose === PaymentIntentPurpose.CHANGE_DIFFERENCE && intent.bookingId) {
        // D-CHG-01: the difference is paid, so the old booking is replaced now.
        const change = await bookingChangesRepository.findChangeByNewBooking(intent.bookingId, tx);
        if (change) await bookingChangesRepository.retireChangedBooking(change.bookingId, tx);
      }
      await notificationsService.notify(
        [{ type: PrincipalType.CUSTOMER, id: intent.customerId }],
        { type: 'PAYMENT_SUCCEEDED', title: 'تم الدفع وإصدار تذكرتك', body: 'حجزك مؤكد. تجد التذكرة في رحلاتي.', data: { bookingId: bookings[0]!.id } },
        tx,
      );
      await auditService.record({ action: 'customer.payment.succeeded', resourceType: 'payment_intent', resourceId: intentId, metadata: { amount: intent.amount, bookings: bookings.map((b) => b.id) } }, tx);
    });
    const after = await customerBookingsRepository.findIntent(intentId);
    return { intentId, status: after!.status, replayed: false };
  }

  /** Dev/test only: simulate the provider confirming the payment. */
  async mockConfirm(customerId: string, intentId: string) {
    if (!isMockPaymentEnabled()) throw fail(403, ErrorCodes.MOCK_PAYMENT_DISABLED, 'Mock payment is disabled');
    const intent = await customerBookingsRepository.findIntent(intentId);
    if (!intent || intent.customerId !== customerId) throw AppError.notFound('Payment not found');
    if (intent.status !== PaymentIntentStatus.PENDING) throw fail(409, ErrorCodes.PAYMENT_NOT_PENDING, 'Payment is not pending', { status: intent.status });
    await this.completeIntent(intentId, { providerRef: intent.providerRef ?? `mock_${intentId}` });
    return this.getPayment(customerId, intentId);
  }

  async getPayment(customerId: string, intentId: string) {
    await this.expireOverdue();
    const intent = await customerBookingsRepository.findIntent(intentId);
    if (!intent || intent.customerId !== customerId) throw AppError.notFound('Payment not found');
    const bookings = await customerBookingsRepository.bookingsOfIntent(intent);
    return { ...this.paymentView(intent), bookingIds: bookings.map((b) => b.id), bookingStatuses: bookings.map((b) => b.status) };
  }

  /** Ends one unpaid intent: bookings EXPIRED (or CANCELLED), seats and coupon released. */
  async voidIntent(intentId: string, to: 'EXPIRED' | 'CANCELLED', tx: PrismaTx): Promise<boolean> {
    const intent = await customerBookingsRepository.findIntent(intentId, tx);
    if (!intent) return false;
    const ok = await customerBookingsRepository.transitionIntent(
      intentId,
      to === 'EXPIRED' ? PaymentIntentStatus.EXPIRED : PaymentIntentStatus.CANCELLED,
      { failedAt: new Date(), failureReason: to === 'EXPIRED' ? 'expired' : 'cancelled_by_customer' },
      tx,
    );
    if (!ok) return false;
    const bookings = (await customerBookingsRepository.bookingsOfIntent(intent, tx)).filter((b) => b.status === BookingStatus.PENDING_PAYMENT);
    if (bookings.length === 0) return true;
    await tx.booking.updateMany({
      where: { id: { in: bookings.map((b) => b.id) } },
      data: { status: to === 'EXPIRED' ? BookingStatus.EXPIRED : BookingStatus.CANCELLED, cancelledAt: new Date() },
    });
    await customerBookingsRepository.releaseBookingSeats(
      bookings.map((b) => b.id),
      bookings.flatMap((b) => b.tickets.map((t) => t.tripSeatId).filter((id): id is string => id !== null)),
      tx,
    );
    for (const b of bookings) await customerBookingsRepository.releaseCoupon(b.couponRedemption, tx);
    if (to === 'EXPIRED') {
      await notificationsService.notify(
        [{ type: PrincipalType.CUSTOMER, id: intent.customerId }],
        { type: 'PAYMENT_FAILED', title: 'انتهت مهلة الدفع', body: 'لم يكتمل الدفع في الوقت المحدد، وتم إلغاء الحجز وتحرير المقاعد.', data: { bookingId: bookings[0]!.id } },
        tx,
      );
    }
    return true;
  }

  /** Lazy + periodic sweep of unpaid checkouts past their payment window. */
  async expireOverdue(limit = 50): Promise<number> {
    const overdue = await customerBookingsRepository.overdueIntents(limit);
    let n = 0;
    for (const { id } of overdue) {
      if (await getPrisma().$transaction((tx) => this.voidIntent(id, 'EXPIRED', tx))) n += 1;
    }
    return n;
  }

  /** Webhook path (registered with the payments module). */
  async onWebhook(event: ParsedWebhookEvent) {
    const intent = await customerBookingsRepository.findIntent(event.intentId);
    if (!intent) return null;
    if (event.currency !== 'SDG') throw fail(409, ErrorCodes.PAYMENT_MISMATCH, 'Unsupported currency', { currency: event.currency });
    const result = await this.completeIntent(intent.id, {
      providerRef: event.paymentReference,
      providerEventId: event.providerEventId,
      amountMinor: event.amountMinor,
    });
    return { customerPayment: result };
  }
}

export const customerCheckoutService = new CustomerCheckoutService();
registerCustomerIntentWebhookHandler((event) => customerCheckoutService.onWebhook(event));
