import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';

export const BookingErrors = {
  notFound: () => AppError.notFound('Booking not found'),
  holdRequired: (details?: unknown) =>
    new AppError({
      message: 'Seats must be held by you before confirming (hold may have expired)',
      statusCode: 409,
      code: ErrorCodes.HOLD_REQUIRED,
      details,
    }),
  exposureCeilingExceeded: (details: { ceiling: number; usedToday: number; requested: number }) =>
    new AppError({
      message: 'Daily booking exposure ceiling exceeded for this office',
      statusCode: 409,
      code: ErrorCodes.EXPOSURE_CEILING_EXCEEDED,
      details,
    }),
  notCancellable: (status: string) =>
    new AppError({
      message: `Booking cannot be cancelled in status ${status}`,
      statusCode: 409,
      code: ErrorCodes.BOOKING_NOT_CANCELLABLE,
      details: { status },
    }),
  /** Broker-only flow (wallet refund, office ticket) called for a direct-customer booking. */
  brokerChannelRequired: (bookingId: string) =>
    new AppError({
      message: 'This operation is only available for broker-office bookings',
      statusCode: 409,
      code: ErrorCodes.BOOKING_CHANNEL_UNSUPPORTED,
      details: { bookingId },
    }),
  idempotencyInFlight: () =>
    AppError.conflict('A request with this idempotencyKey is already being processed; retry shortly'),
  passengerSeatMismatch: () =>
    AppError.validation('Number of passengers must equal number of seats', {
      field: 'passengers',
    }),
};
