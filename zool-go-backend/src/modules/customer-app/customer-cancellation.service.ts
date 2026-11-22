import {
  BookingChannel,
  BookingPaymentStatus,
  BookingStatus,
  PaymentIntentStatus,
  PrincipalType,
  RefundReason,
  RefundStatus,
  TicketStatus,
  TripSeatStatus,
} from '@prisma/client';
import { getPrisma } from '../../infrastructure/database/prisma';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import { runtimeSettings } from '../../shared/settings/runtime-settings';
import { auditService } from '../audit/audit.service';
import { BookingErrors } from '../bookings/bookings.errors';
import { notificationsService } from '../notifications/notifications.service';
import { getPaymentProvider } from '../payments';
import { customerBookingsRepository, type CustomerBookingRow } from './customer-bookings.repository';
import { customerActions } from './customer-bookings.service';
import { customerCheckoutService } from './customer-checkout.service';

export type CancelActor = { type: 'CUSTOMER'; customerId: string } | { type: 'ADMIN'; adminId: string };

/**
 * Cancellation of direct (customer app) bookings.
 * - Customer: until `refund.customerCutoffMinutesBeforeDeparture`, fee `refund.customerFeeBasisPoints`
 *   (D-REF-02 engineering default: no fee until a PO policy exists).
 * - Admin / trip cancelled by the carrier (D-SUS-01): any time before departure, never a fee.
 * Paid online bookings are refunded to the original method through the provider port; unpaid cash
 * bookings need no refund; an unpaid online checkout is voided as a whole (both legs).
 */
export class CustomerCancellationService {
  private refundFor(b: CustomerBookingRow, feeWaived: boolean) {
    const paid = b.paymentStatus === BookingPaymentStatus.PAID && b.totalAmount > 0;
    if (!paid) return { refundableMinor: 0, feeMinor: 0, method: b.paymentStatus === BookingPaymentStatus.UNPAID_CASH ? 'NONE_CASH_UNPAID' : 'NONE' };
    const fee = feeWaived ? 0 : Math.floor((b.totalAmount * runtimeSettings.number('refund.customerFeeBasisPoints')) / 10_000);
    return { refundableMinor: b.totalAmount - fee, feeMinor: fee, method: 'ORIGINAL_PAYMENT_METHOD' };
  }

  async quote(customerId: string, bookingId: string) {
    const b = await customerBookingsRepository.findForCustomer(bookingId, customerId);
    if (!b) throw BookingErrors.notFound();
    const actions = customerActions(b);
    const deadline = new Date(b.trip.departureAt.getTime() - runtimeSettings.number('refund.customerCutoffMinutesBeforeDeparture') * 60_000);
    return {
      bookingId: b.id,
      cancellable: actions.canCancel,
      deadline: deadline.toISOString(),
      ...(b.status === BookingStatus.PENDING_PAYMENT
        ? { refundableMinor: 0, feeMinor: 0, method: 'NONE', voidsWholeCheckout: b.groupId !== null }
        : { ...this.refundFor(b, false), voidsWholeCheckout: false }),
      currency: 'SDG' as const,
    };
  }

  async cancel(input: { bookingId: string; actor: CancelActor; reason?: string; carrierCancelled?: boolean; requestId?: string }) {
    const b = await getPrisma().booking.findUnique({ where: { id: input.bookingId }, select: { customerId: true, channel: true } });
    const customerId = input.actor.type === 'CUSTOMER' ? input.actor.customerId : b?.customerId;
    if (!b || b.channel !== BookingChannel.DIRECT || !customerId || (input.actor.type === 'CUSTOMER' && b.customerId !== customerId)) {
      throw BookingErrors.notFound();
    }
    const booking = (await customerBookingsRepository.findForCustomer(input.bookingId, customerId))!;
    const isAdmin = input.actor.type === 'ADMIN';
    const adminId = input.actor.type === 'ADMIN' ? input.actor.adminId : undefined;

    if (booking.status === BookingStatus.CANCELLED) return { booking: booking.id, status: booking.status, replayed: true, refund: null };
    if (booking.status !== BookingStatus.CONFIRMED && booking.status !== BookingStatus.PENDING_PAYMENT) {
      throw BookingErrors.notCancellable(booking.status);
    }
    if (!isAdmin && !customerActions(booking).canCancel) {
      throw new AppError({ statusCode: 409, code: ErrorCodes.BOOKING_NOT_CANCELLABLE, message: 'This booking can no longer be cancelled', details: { status: booking.status } });
    }
    if (isAdmin && booking.tickets.some((t) => t.boardingStatus === 'BOARDED')) {
      throw new AppError({ statusCode: 409, code: ErrorCodes.BOOKING_NOT_CANCELLABLE, message: 'A passenger already boarded' });
    }

    // Unpaid online checkout: void the payment window (both legs of a round trip).
    if (booking.status === BookingStatus.PENDING_PAYMENT) {
      const intent = (await customerBookingsRepository.findIntents(booking)).find((i) => i.status === PaymentIntentStatus.PENDING);
      if (intent) await getPrisma().$transaction((tx) => customerCheckoutService.voidIntent(intent.id, 'CANCELLED', tx));
      await auditService.record({ actorAdminId: adminId, action: 'customer.booking.cancelled', resourceType: 'booking', resourceId: booking.id, requestId: input.requestId, metadata: { unpaid: true } });
      return { booking: booking.id, status: BookingStatus.CANCELLED, replayed: false, refund: null };
    }

    const { refundableMinor, feeMinor } = this.refundFor(booking, isAdmin || input.carrierCancelled === true);
    const intent = (await customerBookingsRepository.findIntents(booking)).find((i) => i.status === PaymentIntentStatus.SUCCEEDED) ?? null;
    const reason = input.carrierCancelled ? RefundReason.CARRIER_CANCEL : isAdmin ? RefundReason.ADMIN : RefundReason.CUSTOMER_CANCEL;

    const refundId = await getPrisma().$transaction(async (tx) => {
      const moved = await tx.booking.updateMany({
        where: { id: booking.id, status: BookingStatus.CONFIRMED },
        data: {
          status: BookingStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelReason: input.reason?.slice(0, 500) ?? null,
          ...(refundableMinor > 0 ? { paymentStatus: feeMinor > 0 ? BookingPaymentStatus.PARTIALLY_REFUNDED : BookingPaymentStatus.REFUNDED } : {}),
        },
      });
      if (moved.count === 0) throw BookingErrors.notCancellable(BookingStatus.CANCELLED);
      await tx.ticket.updateMany({ where: { bookingId: booking.id }, data: { status: TicketStatus.CANCELLED } });
      const seatIds = booking.tickets.map((t) => t.tripSeatId).filter((id): id is string => id !== null);
      await tx.tripSeat.updateMany({ where: { id: { in: seatIds }, status: TripSeatStatus.SOLD }, data: { status: TripSeatStatus.FREE } });

      let rid: string | null = null;
      if (refundableMinor > 0) {
        const refund = await tx.refund.create({
          data: { bookingId: booking.id, paymentIntentId: intent?.id ?? null, amount: refundableMinor, reason, idempotencyKey: `cancel:${booking.id}` },
        });
        rid = refund.id;
      }
      await notificationsService.notify(
        [{ type: PrincipalType.CUSTOMER, id: customerId }],
        input.carrierCancelled
          ? { type: 'TRIP_CANCELLED', title: 'أُلغيت رحلتك', body: 'ألغت شركة النقل الرحلة، وسيُسترد المبلغ كاملًا.', data: { bookingId: booking.id } }
          : { type: 'BOOKING_REFUNDED', title: 'تم إلغاء الحجز', body: refundableMinor > 0 ? 'سيُعاد المبلغ إلى وسيلة الدفع الأصلية.' : 'تم إلغاء حجزك.', data: { bookingId: booking.id } },
        tx,
      );
      await auditService.record(
        {
          actorAdminId: adminId,
          action: 'customer.booking.cancelled',
          resourceType: 'booking',
          resourceId: booking.id,
          requestId: input.requestId,
          metadata: { by: input.actor.type, reason: input.reason ?? null, refundableMinor, feeMinor, carrierCancelled: input.carrierCancelled ?? false },
        },
        tx,
      );
      return rid;
    });

    const refund = refundId ? await customerRefundsService.process(refundId) : null;
    return { booking: booking.id, status: BookingStatus.CANCELLED, replayed: false, refund, feeMinor };
  }
}

/** Sends queued refunds to the provider; failures stay PENDING for the admin refunds queue. */
export class CustomerRefundsService {
  async process(refundId: string) {
    const refund = await getPrisma().refund.findUnique({ where: { id: refundId }, include: { paymentIntent: true } });
    if (!refund) throw AppError.notFound('Refund not found');
    if (refund.status === RefundStatus.SUCCEEDED) return this.view(refund);
    try {
      const result = await getPaymentProvider().refundCharge({
        refundId: refund.id,
        intentId: refund.paymentIntentId ?? '',
        providerRef: refund.paymentIntent?.providerRef ?? null,
        amount: refund.amount,
        currency: 'SDG',
      });
      const updated = await getPrisma().refund.update({
        where: { id: refund.id },
        data: { providerRef: result.providerRef, ...(result.status === 'SUCCEEDED' ? { status: RefundStatus.SUCCEEDED, processedAt: new Date() } : {}) },
      });
      return this.view(updated);
    } catch {
      return this.view(refund);
    }
  }

  view(r: { id: string; amount: number; status: RefundStatus; reason: RefundReason; providerRef: string | null; processedAt: Date | null; createdAt: Date }) {
    return { id: r.id, amountMinor: r.amount, status: r.status, reason: r.reason, providerRef: r.providerRef, processedAt: r.processedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString() };
  }
}

export const customerRefundsService = new CustomerRefundsService();
export const customerCancellationService = new CustomerCancellationService();
