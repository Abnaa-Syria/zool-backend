import { expect } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

/** Waits out the OTP resend cooldown (1 s in .env.test) between logins of the same phone. */
export const waitOtpCooldown = () => new Promise((r) => setTimeout(r, 1100));

async function login(app: Express, principal: 'customer' | 'driver', phone: string) {
  let otp = await request(app).post(`/api/v1/${principal}/auth/otp/request`).send({ phone });
  if (otp.body.code === 'OTP_COOLDOWN') {
    await waitOtpCooldown();
    otp = await request(app).post(`/api/v1/${principal}/auth/otp/request`).send({ phone });
  }
  expect(otp.status).toBe(200);
  const verify = await request(app)
    .post(`/api/v1/${principal}/auth/otp/verify`)
    .set('X-Client-Platform', 'android')
    .send({ phone, code: otp.body.data.devOtp, challengeId: otp.body.data.challengeId });
  expect(verify.status).toBe(200);
  return verify;
}

/** Full customer OTP login; returns the verify response (`body.data.accessToken`, `refreshToken`, `customer`). */
export const loginCustomer = (app: Express, phone: string) => login(app, 'customer', phone);
export const loginDriver = (app: Express, phone: string) => login(app, 'driver', phone);
