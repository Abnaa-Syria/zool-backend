import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { bootTestApp, shutdownTestApp, resetDatabase, seedCatalogAndSuperAdmin, loginWithOtp } from './helpers/app';
import { loginCustomer, loginDriver } from './helpers/mobile';
import { seedNetwork, sudanAt } from './helpers/network';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Limits the admin can change at runtime (D-SET-02)', () => {
  let app: Express;
  let adminToken: string;
  let net: Awaited<ReturnType<typeof seedNetwork>>;

  const setSettings = (values: Record<string, unknown>) =>
    request(app).patch('/api/v1/admin/settings').set(auth(adminToken)).send({ values });

  beforeAll(async () => {
    app = await bootTestApp();
  });
  afterAll(async () => {
    await shutdownTestApp();
  });
  beforeEach(async () => {
    await resetDatabase();
    await seedCatalogAndSuperAdmin();
    adminToken = (await loginWithOtp(app, '+249900000001')).accessToken;
    net = await seedNetwork(app, adminToken);
  });

  it('login code limits per phone and the resend cooldown follow the settings', async () => {
    expect((await setSettings({ 'security.otpRequestsPerPhone': 2, 'security.otpResendCooldownSeconds': 1 })).status).toBe(200);
    const ask = () => request(app).post('/api/v1/customer/auth/otp/request').send({ phone: '+249912900001' });
    expect((await ask()).status).toBe(200);
    await new Promise((r) => setTimeout(r, 1100));
    expect((await ask()).status).toBe(200);
    await new Promise((r) => setTimeout(r, 1100));
    const third = await ask();
    expect(third.status).toBe(429);
    expect((await request(app).get('/api/v1/public/app-config')).body.data.otp.resendAfterSeconds).toBe(1);
  });

  it('caps seats one customer can hold per trip and across trips', async () => {
    const t1 = await net.schedule({ departure: sudanAt(2, '07:00'), priceMinor: 3_500_000 });
    const t2 = await net.schedule({ departure: sudanAt(3, '07:00'), priceMinor: 3_500_000 });
    const token = (await loginCustomer(app, '+249912900002')).body.data.accessToken;
    await setSettings({ 'booking.customerMaxSeatsPerHold': 2, 'booking.customerMaxHeldSeats': 3 });

    const many = await request(app).post(`/api/v1/customer/trips/${t1}/holds`).set(auth(token)).send({ seatLabels: ['1', '2', '3'] });
    expect(many.status).toBe(422);
    expect((await request(app).post(`/api/v1/customer/trips/${t1}/holds`).set(auth(token)).send({ seatLabels: ['1', '2'] })).status).toBe(201);
    const hoard = await request(app).post(`/api/v1/customer/trips/${t2}/holds`).set(auth(token)).send({ seatLabels: ['1', '2'] });
    expect(hoard.status).toBe(409);
    expect(hoard.body).toMatchObject({ code: 'HOLD_LIMIT_REACHED', details: { held: 2, max: 3 } });
    expect((await request(app).post(`/api/v1/customer/trips/${t2}/holds`).set(auth(token)).send({ seatLabels: ['1'] })).status).toBe(201);
  });

  it('limits coupon guessing per customer', async () => {
    const t1 = await net.schedule({ departure: sudanAt(2, '07:00'), priceMinor: 3_500_000 });
    const token = (await loginCustomer(app, '+249912900003')).body.data.accessToken;
    await setSettings({ 'security.couponAttemptsPerHour': 2 });
    const h = await request(app).post(`/api/v1/customer/trips/${t1}/holds`).set(auth(token)).send({ seatLabels: ['1'] });
    const quote = (code: string) =>
      request(app).post('/api/v1/customer/bookings/quote').set(auth(token)).send({ holdIds: [h.body.data.holds[0].id], passengers: [{ fullName: 'Ali Omer', gender: 'MALE' }], couponCode: code });
    expect((await quote('GUESS1')).body.code).toBe('COUPON_INVALID');
    expect((await quote('GUESS2')).body.code).toBe('COUPON_INVALID');
    expect((await quote('GUESS3')).status).toBe(429);
  });

  it('boarding window follows the settings', async () => {
    const trip = await net.schedule({ departure: new Date(Date.now() + 3 * 3600_000), priceMinor: 3_500_000, withDriver: true });
    const driver = (await loginDriver(app, net.driverPhone)).body.data.accessToken;
    await setSettings({ 'driver.boardingWindowMinutes': 60 });
    const early = await request(app).post(`/api/v1/driver/trips/${trip}/status`).set(auth(driver)).send({ status: 'BOARDING' });
    expect(early.body).toMatchObject({ code: 'TRIP_STATE_INVALID', details: { windowMinutes: 60 } });
    await setSettings({ 'driver.boardingWindowMinutes': 240 });
    expect((await request(app).post(`/api/v1/driver/trips/${trip}/status`).set(auth(driver)).send({ status: 'BOARDING' })).status).toBe(200);
  });
});
