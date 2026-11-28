import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { bootTestApp, shutdownTestApp, resetDatabase, seedCatalogAndSuperAdmin, loginWithOtp } from './helpers/app';
import { loginCustomer, loginDriver, waitOtpCooldown } from './helpers/mobile';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const mobile = { 'X-Client-Platform': 'android' };

describe('Customer, driver and broker-mobile authentication', () => {
  let app: Express;
  let adminToken: string;

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
  });

  it('creates the customer on first login, then logs the same account in again', async () => {
    const first = await loginCustomer(app, '0912345678');
    expect(first.body.data).toMatchObject({ isNewCustomer: true, tokenType: 'Bearer', customer: { phone: '+249912345678', profileIncomplete: true } });
    expect(first.body.data.refreshToken).toBeTruthy();
    expect(first.headers['set-cookie']).toBeUndefined();

    const token = first.body.data.accessToken as string;
    const patched = await request(app).patch('/api/v1/customer/me').set(auth(token)).send({ displayName: 'Amna Osman', email: 'Amna@Example.com' });
    expect(patched.status).toBe(200);
    expect(patched.body.data).toMatchObject({ displayName: 'Amna Osman', email: 'amna@example.com', profileIncomplete: false, stats: { tripsCount: 0 } });

    const prefs = await request(app).patch('/api/v1/customer/me/preferences').set(auth(token)).send({ language: 'en', tripAlerts: false });
    expect(prefs.body.data.preferences).toEqual({ language: 'en', tripAlerts: false });
    expect((await request(app).patch('/api/v1/customer/me').set(auth(token)).send({ status: 'ACTIVE' })).status).toBe(422);

    const again = await loginCustomer(app, '+249912345678');
    expect(again.body.data.isNewCustomer).toBe(false);
    expect(again.body.data.customer.id).toBe(first.body.data.customer.id);
  });

  it('rotates refresh tokens, detects reuse and logs out', async () => {
    const login = await loginCustomer(app, '+249912000001');
    const r1 = login.body.data.refreshToken as string;

    const refreshed = await request(app).post('/api/v1/customer/auth/refresh').send({ refreshToken: r1 });
    expect(refreshed.status).toBe(200);
    const r2 = refreshed.body.data.refreshToken as string;
    expect(r2).not.toBe(r1);
    expect(refreshed.body.data.customer.phone).toBe('+249912000001');

    // Reusing the rotated token revokes the whole family (r2 too).
    expect((await request(app).post('/api/v1/customer/auth/refresh').send({ refreshToken: r1 })).body.code).toBe('SESSION_INVALID');
    expect((await request(app).post('/api/v1/customer/auth/refresh').send({ refreshToken: r2 })).status).toBe(401);

    const fresh = await loginCustomer(app, '+249912000001');
    const r3 = fresh.body.data.refreshToken as string;
    expect((await request(app).post('/api/v1/customer/auth/logout').send({ refreshToken: r3 })).status).toBe(200);
    expect((await request(app).post('/api/v1/customer/auth/refresh').send({ refreshToken: r3 })).status).toBe(401);
  });

  it('keeps principals apart: a customer token cannot call driver, broker or admin routes', async () => {
    const token = (await loginCustomer(app, '+249912000002')).body.data.accessToken as string;
    expect((await request(app).get('/api/v1/driver/me').set(auth(token))).status).toBe(401);
    expect((await request(app).get('/api/v1/broker/auth/me').set(auth(token))).status).toBe(401);
    expect((await request(app).get('/api/v1/admins').set(auth(token))).status).toBe(401);
    expect((await request(app).get('/api/v1/customer/me').set(auth(adminToken))).status).toBe(401);
  });

  it('admin suspension kills customer tokens at once and blocks new logins', async () => {
    const login = await loginCustomer(app, '+249912000003');
    const token = login.body.data.accessToken as string;
    const id = login.body.data.customer.id as string;
    expect((await request(app).patch(`/api/v1/admin/customers/${id}`).set(auth(adminToken)).send({ status: 'SUSPENDED' })).status).toBe(200);

    expect((await request(app).get('/api/v1/customer/me').set(auth(token))).body.code).toBe('AUTH_AUTHZ_STALE');
    expect((await request(app).post('/api/v1/customer/auth/refresh').send({ refreshToken: login.body.data.refreshToken })).status).toBe(401);
    await waitOtpCooldown();
    expect((await request(app).post('/api/v1/customer/auth/otp/request').send({ phone: '+249912000003' })).status).toBe(401);
  });

  it('deletes the account: PII removed, phone freed for a brand-new account', async () => {
    const login = await loginCustomer(app, '+249912000004');
    const token = login.body.data.accessToken as string;
    await request(app).patch('/api/v1/customer/me').set(auth(token)).send({ displayName: 'Old Name' });
    expect((await request(app).delete('/api/v1/customer/me').set(auth(token))).status).toBe(200);
    expect((await request(app).get('/api/v1/customer/me').set(auth(token))).status).toBe(401);

    const admin = await request(app).get(`/api/v1/admin/customers/${login.body.data.customer.id}`).set(auth(adminToken));
    expect(admin.body.data).toMatchObject({ status: 'DELETED', displayName: null, phone: null });

    const fresh = await loginCustomer(app, '+249912000004');
    expect(fresh.body.data.isNewCustomer).toBe(true);
    expect(fresh.body.data.customer.id).not.toBe(login.body.data.customer.id);
  });

  it('rejects a wrong code and locks after the max attempts', async () => {
    const req = await request(app).post('/api/v1/customer/auth/otp/request').send({ phone: '+249912000005' });
    const wrong = req.body.data.devOtp === '000000' ? '111111' : '000000';
    const bad = await request(app).post('/api/v1/customer/auth/otp/verify').send({ phone: '+249912000005', code: wrong, challengeId: req.body.data.challengeId });
    expect(bad.body.code).toBe('OTP_INVALID');
    // A consumed challenge cannot be used twice.
    const ok = await request(app).post('/api/v1/customer/auth/otp/verify').send({ phone: '+249912000005', code: req.body.data.devOtp, challengeId: req.body.data.challengeId });
    expect(ok.status).toBe(200);
    const replay = await request(app).post('/api/v1/customer/auth/otp/verify').send({ phone: '+249912000005', code: req.body.data.devOtp, challengeId: req.body.data.challengeId });
    expect(replay.body.code).toBe('OTP_INVALID');
  });

  it('logs in only admin-created drivers and exposes the driver profile', async () => {
    expect((await request(app).post('/api/v1/driver/auth/otp/request').send({ phone: '+249900000777' })).status).toBe(401);

    const companyId = (await request(app).post('/api/v1/carriers').set(auth(adminToken)).send({ key: 'nile_bus', name: 'Nile Bus' })).body.data.id;
    const created = await request(app)
      .post('/api/v1/admin/drivers')
      .set(auth(adminToken))
      .send({ companyId, displayName: 'Osman Driver', phone: '+249900000777', licenseNumber: 'L-1', licenseExpiry: '2099-01-01' });
    expect(created.status).toBe(201);

    const login = await loginDriver(app, '+249900000777');
    expect(login.body.data.driver).toMatchObject({ displayName: 'Osman Driver', company: { id: companyId }, license: { status: 'VALID' } });
    const token = login.body.data.accessToken as string;
    expect((await request(app).get('/api/v1/driver/me').set(auth(token))).status).toBe(200);
    expect((await request(app).get('/api/v1/customer/me').set(auth(token))).status).toBe(401);

    // Suspending the driver ends the session immediately.
    await request(app).patch(`/api/v1/admin/drivers/${created.body.data.id}`).set(auth(adminToken)).send({ status: 'SUSPENDED' });
    expect((await request(app).get('/api/v1/driver/me').set(auth(token))).status).toBe(401);
    expect((await request(app).post('/api/v1/driver/auth/refresh').send({ refreshToken: login.body.data.refreshToken })).status).toBe(401);
  });

  it('broker mobile clients get the refresh token in the body instead of a cookie', async () => {
    await request(app)
      .post('/api/v1/brokers')
      .set(auth(adminToken))
      .send({ code: 'ZG-BRK-M1', name: 'Mobile Office', settlementPeriod: 'MONTHLY', manager: { displayName: 'Manager', phone: '+249900000931' } });
    const otp = await request(app).post('/api/v1/broker/auth/otp/request').send({ phone: '+249900000931' });
    const verify = await request(app)
      .post('/api/v1/broker/auth/otp/verify')
      .set(mobile)
      .send({ phone: '+249900000931', code: otp.body.data.devOtp, challengeId: otp.body.data.challengeId });
    expect(verify.status).toBe(200);
    expect(verify.headers['set-cookie']).toBeUndefined();
    const r1 = verify.body.data.refreshToken as string;
    expect(r1).toBeTruthy();

    const refreshed = await request(app).post('/api/v1/broker/auth/refresh').set(mobile).send({ refreshToken: r1 });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.refreshToken).toBeTruthy();
    expect(refreshed.body.data.employee.office.code).toBe('ZG-BRK-M1');
    expect((await request(app).post('/api/v1/broker/auth/logout').set(mobile).send({ refreshToken: refreshed.body.data.refreshToken })).status).toBe(200);
    expect((await request(app).post('/api/v1/broker/auth/refresh').set(mobile).send({ refreshToken: refreshed.body.data.refreshToken })).status).toBe(401);
  });

  it('serves public app config, cities with stations and popular destinations', async () => {
    const config = await request(app).get('/api/v1/public/app-config');
    expect(config.body.data).toMatchObject({ defaultCountryCode: '+249', currency: 'SDG', features: { cashOnBoard: true, roundTrip: true } });

    await request(app).patch('/api/v1/admin/settings').set(auth(adminToken)).send({ values: { 'support.phone': '+249900000999' } });
    expect((await request(app).get('/api/v1/public/app-config')).body.data.support.phone).toBe('+249900000999');

    // Map tiles: OpenStreetMap until a MapTiler key is set in the settings.
    expect(config.body.data.maps).toMatchObject({ provider: 'osm' });
    await request(app).patch('/api/v1/admin/settings').set(auth(adminToken)).send({ values: { 'maps.maptilerKey': 'test-key-123' } });
    const maps = (await request(app).get('/api/v1/public/app-config')).body.data.maps;
    expect(maps).toMatchObject({ provider: 'maptiler', tileUrlRetina: 'https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}@2x.png?key=test-key-123' });

    const city = await request(app).post('/api/v1/admin/cities').set(auth(adminToken)).send({ code: 'KRT', nameAr: 'الخرطوم', nameEn: 'Khartoum', isPopular: true });
    expect(city.status).toBe(201);
    await request(app).post('/api/v1/admin/stations').set(auth(adminToken)).send({ cityId: city.body.data.id, nameAr: 'الميناء البري', nameEn: 'Land Port' });

    const cities = await request(app).get('/api/v1/public/cities?q=Khar');
    expect(cities.body.data).toHaveLength(1);
    expect(cities.body.data[0].stations[0]).toMatchObject({ nameEn: 'Land Port' });
    const popular = await request(app).get('/api/v1/public/destinations/popular');
    expect(popular.body.data[0]).toMatchObject({ city: { code: 'KRT' }, fromPriceMinor: null });
  });
});
