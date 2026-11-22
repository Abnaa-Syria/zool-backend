import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env';
import { otpPolicy } from '../../shared/security/otp-policy';
import { RateLimitError } from '../../shared/errors/app-error';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticate } from '../../shared/middleware/authenticate';
import { validate } from '../../shared/middleware/validate';
import { authController } from './auth.controller';
import {
  otpRequestSchema,
  otpVerifySchema,
  phoneChangeOtpRequestSchema,
  phoneChangeOtpVerifySchema,
} from './auth.validation';

export const authRoutes = Router();

const otpRequestLimiter = rateLimit({
  windowMs: env().OTP_REQUEST_RATE_LIMIT_WINDOW_SECONDS * 1000,
  max: () => otpPolicy().requestsPerIp,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(
      new RateLimitError({
        message: 'Too many OTP requests',
      }),
    );
  },
});

const otpVerifyLimiter = rateLimit({
  windowMs: env().OTP_VERIFY_RATE_LIMIT_WINDOW_SECONDS * 1000,
  max: () => otpPolicy().requestsPerIp * 2,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(
      new RateLimitError({
        message: 'Too many OTP verifications',
      }),
    );
  },
});

authRoutes.post(
  '/otp/request',
  otpRequestLimiter,
  validate({ body: otpRequestSchema }),
  asyncHandler((req, res) => authController.requestOtp(req, res)),
);

authRoutes.post(
  '/otp/verify',
  otpVerifyLimiter,
  validate({ body: otpVerifySchema }),
  asyncHandler((req, res) => authController.verifyOtp(req, res)),
);

authRoutes.post(
  '/refresh',
  asyncHandler((req, res) => authController.refresh(req, res)),
);

authRoutes.post(
  '/logout',
  asyncHandler((req, res) => authController.logout(req, res)),
);

authRoutes.post(
  '/logout-all',
  authenticate,
  asyncHandler((req, res) => authController.logoutAll(req, res)),
);

authRoutes.get(
  '/me',
  authenticate,
  asyncHandler((req, res) => authController.me(req, res)),
);

authRoutes.post(
  '/phone/otp/request',
  authenticate,
  otpRequestLimiter,
  validate({ body: phoneChangeOtpRequestSchema }),
  asyncHandler((req, res) => authController.requestPhoneChangeOtp(req, res)),
);

authRoutes.post(
  '/phone/otp/verify',
  authenticate,
  otpVerifyLimiter,
  validate({ body: phoneChangeOtpVerifySchema }),
  asyncHandler((req, res) => authController.verifyPhoneChangeOtp(req, res)),
);
