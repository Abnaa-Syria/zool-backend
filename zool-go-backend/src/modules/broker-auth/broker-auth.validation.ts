import { z } from 'zod';

export const brokerOtpRequestSchema = z.object({
  phone: z.string().min(8).max(32),
});

export const brokerOtpVerifySchema = z.object({
  phone: z.string().min(8).max(32),
  code: z.string().min(4).max(8),
  challengeId: z.string().min(1).optional(),
});
