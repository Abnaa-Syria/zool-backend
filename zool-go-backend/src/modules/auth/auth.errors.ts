import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';

/** Auth-domain operational errors with Stage 1 stable codes. */
export const AuthErrors = {
  invalidOtp: () =>
    new AppError({
      message: 'Invalid OTP',
      statusCode: 401,
      code: ErrorCodes.OTP_INVALID,
    }),
  expiredOtp: () =>
    new AppError({
      message: 'OTP expired',
      statusCode: 401,
      code: ErrorCodes.OTP_EXPIRED,
    }),
  lockedOtp: () =>
    new AppError({
      message: 'OTP challenge locked due to too many attempts',
      statusCode: 401,
      code: ErrorCodes.OTP_LOCKED,
    }),
  cooldown: (retryAfterSeconds: number) =>
    new AppError({
      message: 'OTP resend cooldown active',
      statusCode: 429,
      code: ErrorCodes.OTP_COOLDOWN,
      details: { retryAfterSeconds },
    }),
  sessionInvalid: () =>
    new AppError({
      message: 'Refresh session is invalid',
      statusCode: 401,
      code: ErrorCodes.SESSION_INVALID,
    }),
};
