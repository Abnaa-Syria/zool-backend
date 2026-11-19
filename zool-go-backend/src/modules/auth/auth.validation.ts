import { z } from 'zod';

export const otpRequestSchema = z.object({
  phone: z.string().min(8).max(32),
});

export const otpVerifySchema = z.object({
  phone: z.string().min(8).max(32),
  code: z.string().min(4).max(8),
  challengeId: z.string().min(1).optional(),
});

export const phoneChangeOtpRequestSchema = z
  .object({
    phone: z.string().min(8).max(32),
  })
  .strict();

export const phoneChangeOtpVerifySchema = z
  .object({
    phone: z.string().min(8).max(32),
    code: z.string().min(4).max(8),
    challengeId: z.string().min(1).optional(),
  })
  .strict();
