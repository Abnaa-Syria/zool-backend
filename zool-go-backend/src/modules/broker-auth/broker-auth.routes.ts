import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env';
import { RateLimitError } from '../../shared/errors/app-error';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticateBroker } from '../../shared/middleware/authenticate-broker';
import { validate } from '../../shared/middleware/validate';
import { brokerAuthController } from './broker-auth.controller';
import { brokerOtpRequestSchema, brokerOtpVerifySchema } from './broker-auth.validation';

/** Mounted at `${API_PREFIX}/broker/auth` */
export const brokerAuthRoutes = Router();

const otpRequestLimiter = rateLimit({
  windowMs: env().OTP_REQUEST_RATE_LIMIT_WINDOW_SECONDS * 1000,
  max: env().OTP_REQUEST_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(new RateLimitError({ message: 'Too many OTP requests' }));
  },
});

const otpVerifyLimiter = rateLimit({
  windowMs: env().OTP_VERIFY_RATE_LIMIT_WINDOW_SECONDS * 1000,
  max: env().OTP_VERIFY_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(new RateLimitError({ message: 'Too many OTP verifications' }));
  },
});

brokerAuthRoutes.post(
  '/otp/request',
  otpRequestLimiter,
  validate({ body: brokerOtpRequestSchema }),
  asyncHandler((req, res) => brokerAuthController.requestOtp(req, res)),
);

brokerAuthRoutes.post(
  '/otp/verify',
  otpVerifyLimiter,
  validate({ body: brokerOtpVerifySchema }),
  asyncHandler((req, res) => brokerAuthController.verifyOtp(req, res)),
);

brokerAuthRoutes.post(
  '/refresh',
  asyncHandler((req, res) => brokerAuthController.refresh(req, res)),
);

brokerAuthRoutes.post(
  '/logout',
  asyncHandler((req, res) => brokerAuthController.logout(req, res)),
);

brokerAuthRoutes.get(
  '/me',
  authenticateBroker,
  asyncHandler((req, res) => brokerAuthController.me(req, res)),
);
