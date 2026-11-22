import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env';
import { RateLimitError } from '../../shared/errors/app-error';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { validate } from '../../shared/middleware/validate';
import type { MobileAuthController } from './mobile-auth.controller';
import { mobileLogoutSchema, mobileOtpRequestSchema, mobileOtpVerifySchema, mobileRefreshSchema } from './mobile-auth.validation';

function limiter(windowSeconds: number, max: number, message: string) {
  return rateLimit({
    windowMs: windowSeconds * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new RateLimitError({ message })),
  });
}

/** `/otp/request`, `/otp/verify`, `/refresh`, `/logout` for one mobile principal. */
export function createMobileAuthRoutes(controller: MobileAuthController): Router {
  const e = env();
  const router = Router();
  router.post(
    '/otp/request',
    limiter(e.OTP_REQUEST_RATE_LIMIT_WINDOW_SECONDS, e.OTP_REQUEST_RATE_LIMIT_MAX, 'Too many OTP requests'),
    validate({ body: mobileOtpRequestSchema }),
    asyncHandler((req, res) => controller.requestOtp(req, res)),
  );
  router.post(
    '/otp/verify',
    limiter(e.OTP_VERIFY_RATE_LIMIT_WINDOW_SECONDS, e.OTP_VERIFY_RATE_LIMIT_MAX, 'Too many OTP verifications'),
    validate({ body: mobileOtpVerifySchema }),
    asyncHandler((req, res) => controller.verifyOtp(req, res)),
  );
  router.post('/refresh', validate({ body: mobileRefreshSchema }), asyncHandler((req, res) => controller.refresh(req, res)));
  router.post('/logout', validate({ body: mobileLogoutSchema }), asyncHandler((req, res) => controller.logout(req, res)));
  return router;
}
