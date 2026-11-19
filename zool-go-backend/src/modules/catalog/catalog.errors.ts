import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';

export const CatalogErrors = {
  tripNotFound: () => AppError.notFound('Trip not found'),
  seatNotFound: () => AppError.notFound('One or more seats were not found on this trip'),
  holdNotFound: () => AppError.notFound('Seat hold not found'),
  seatUnavailable: (details?: unknown) =>
    new AppError({
      message: 'One or more seats are no longer available',
      statusCode: 409,
      code: ErrorCodes.SEAT_UNAVAILABLE,
      details,
    }),
  tripNotBookable: () =>
    new AppError({
      message: 'Trip is not open for booking',
      statusCode: 409,
      code: ErrorCodes.CONFLICT,
    }),
};
