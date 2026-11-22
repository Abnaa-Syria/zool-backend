import { z } from 'zod';

export const mobileOtpRequestSchema = z.object({ phone: z.string().min(8).max(32) }).strict();

export const mobileOtpVerifySchema = z
  .object({
    phone: z.string().min(8).max(32),
    code: z.string().min(4).max(8),
    challengeId: z.string().min(1).max(64).optional(),
  })
  .strict();

/** Mobile apps keep the refresh token in secure storage and send it in the body. */
export const mobileRefreshSchema = z.object({ refreshToken: z.string().min(20).max(200) }).strict();
export const mobileLogoutSchema = z.object({ refreshToken: z.string().min(20).max(200).optional() }).strict();
