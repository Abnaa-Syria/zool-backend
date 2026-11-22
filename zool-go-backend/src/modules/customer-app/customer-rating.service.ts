import { PaymentIntentStatus } from '@prisma/client';
import { getPrisma } from '../../infrastructure/database/prisma';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import { runtimeSettings } from '../../shared/settings/runtime-settings';
import { BookingErrors } from '../bookings/bookings.errors';
import { getPaymentProvider, isMockPaymentEnabled } from '../payments';
import { customerBookingsRepository } from './customer-bookings.repository';
import { customerActions } from './customer-bookings.service';

export class CustomerRatingService {
  /** One rating per completed booking; the carrier aggregate is recomputed in the same transaction. */
  async rate(customerId: string, bookingId: string, input: { stars: number; comment?: string }) {
    const b = await customerBookingsRepository.findForCustomer(bookingId, customerId);
    if (!b) throw BookingErrors.notFound();
    if (!customerActions(b).canRate) {
      throw new AppError({
        statusCode: 409,
        code: ErrorCodes.RATING_NOT_ALLOWED,
        message: b.rating ? 'This booking is already rated' : 'Only completed trips can be rated',
      });
    }
    await getPrisma().$transaction(async (tx) => {
      await tx.carrierRating.create({
        data: { bookingId, customerId, companyId: b.trip.companyId, stars: input.stars, comment: input.comment?.trim() || null },
      });
      const agg = await tx.carrierRating.aggregate({ where: { companyId: b.trip.companyId }, _avg: { stars: true }, _count: { _all: true } });
      await tx.transportCompany.update({
        where: { id: b.trip.companyId },
        data: { ratingAvgX100: Math.round((agg._avg.stars ?? 0) * 100), ratingCount: agg._count._all },
      });
    });
    return { bookingId, stars: input.stars, comment: input.comment?.trim() || null };
  }

  /** Checkout payment options. Saved cards wait for the PSP choice (D-PAY-01). */
  async paymentMethods(customerId: string) {
    const c = await getPrisma().customer.findUniqueOrThrow({ where: { id: customerId }, select: { cashNoShowCount: true } });
    const reason = !runtimeSettings.boolean('cash.enabled')
      ? 'CASH_DISABLED'
      : c.cashNoShowCount >= runtimeSettings.number('cash.noShowLimit')
        ? 'NO_SHOW_LIMIT'
        : null;
    const pending = await getPrisma().paymentIntent.count({ where: { customerId, status: PaymentIntentStatus.PENDING } });
    return {
      methods: [
        { type: 'ONLINE', available: true, provider: getPaymentProvider().name, isMock: isMockPaymentEnabled(), savedCards: [] as unknown[] },
        {
          type: 'CASH_ON_BOARD',
          available: reason === null,
          unavailableReason: reason,
          limits: {
            maxSeatsPerBooking: runtimeSettings.number('cash.maxSeatsPerBooking'),
            maxOpenBookings: runtimeSettings.number('cash.maxOpenBookingsPerCustomer'),
            cutoffMinutesBeforeDeparture: runtimeSettings.number('cash.cutoffMinutesBeforeDeparture'),
          },
        },
      ],
      pendingPayments: pending,
    };
  }
}

export const customerRatingService = new CustomerRatingService();
