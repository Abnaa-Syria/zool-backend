import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { bootTestApp, shutdownTestApp, resetDatabase, seedCatalogAndSuperAdmin, loginWithOtp, loginBrokerWithOtp } from './helpers/app';
import { runtimeSettings } from '../src/shared/settings/runtime-settings';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Admin API improvements from dashboard integration', () => {
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
    await runtimeSettings.reload();
    await seedCatalogAndSuperAdmin();
    adminToken = (await loginWithOtp(app, '+249900000001')).accessToken;
  });

  it('refuses to delete a role that is still assigned (ROLE_IN_USE)', async () => {
    const role = await request(app).post('/api/v1/roles').set(auth(adminToken)).send({ key: 'ops_team', name: 'Ops', permissionKeys: ['bookings.view'] });
    await request(app)
      .post('/api/v1/admins')
      .set(auth(adminToken))
      .send({ displayName: 'Ops Member', employeeCode: 'ZG-EMP-OPS2', phone: '+249900000801', roleIds: [role.body.data.id] });
    const del = await request(app).delete(`/api/v1/roles/${role.body.data.id}`).set(auth(adminToken));
    expect(del.status).toBe(409);
    expect(del.body).toMatchObject({ code: 'ROLE_IN_USE', details: { memberCount: 1 } });
  });

  it('filters admins by q and status across all pages', async () => {
    const role = await request(app).post('/api/v1/roles').set(auth(adminToken)).send({ key: 'viewer_x', name: 'Viewer', permissionKeys: ['bookings.view'] });
    await request(app)
      .post('/api/v1/admins')
      .set(auth(adminToken))
      .send({ displayName: 'Hiba Osman', employeeCode: 'ZG-EMP-HIBA', phone: '+249900000802', roleIds: [role.body.data.id] });
    const byName = await request(app).get('/api/v1/admins?q=Hiba').set(auth(adminToken));
    expect(byName.body.data.map((a: { displayName: string }) => a.displayName)).toEqual(['Hiba Osman']);
    const byPhone = await request(app).get('/api/v1/admins?q=900000802').set(auth(adminToken));
    expect(byPhone.body.meta.total).toBe(1);
    const suspended = await request(app).get('/api/v1/admins?status=SUSPENDED').set(auth(adminToken));
    expect(suspended.body.meta.total).toBe(0);
  });

  it('resets a setting override back to the .env default', async () => {
    await request(app).patch('/api/v1/admin/settings').set(auth(adminToken)).send({ values: { 'booking.seatHoldTtlSeconds': 600 } });
    expect(runtimeSettings.number('booking.seatHoldTtlSeconds')).toBe(600);
    const reset = await request(app).delete('/api/v1/admin/settings/booking.seatHoldTtlSeconds').set(auth(adminToken));
    expect(reset.status).toBe(200);
    const row = reset.body.data.find((s: { key: string }) => s.key === 'booking.seatHoldTtlSeconds');
    expect(row).toMatchObject({ isDefault: true, value: row.defaultValue });
    expect(runtimeSettings.number('booking.seatHoldTtlSeconds')).toBe(row.defaultValue);
    expect((await request(app).delete('/api/v1/admin/settings/nope.key').set(auth(adminToken))).status).toBe(404);
  });

  it('stores the admin cancel reason on the booking, finds it by reference, and names the actor in audit', async () => {
    const companyId = (await request(app).post('/api/v1/carriers').set(auth(adminToken)).send({ key: 'nile_bus', name: 'Nile Bus' })).body.data.id;
    const officeId = (
      await request(app)
        .post('/api/v1/brokers')
        .set(auth(adminToken))
        .send({ code: 'ZG-BRK-I', name: 'Office', settlementPeriod: 'MONTHLY', manager: { displayName: 'Manager', phone: '+249900000803' } })
    ).body.data.id;
    await request(app).put(`/api/v1/brokers/${officeId}/carriers`).set(auth(adminToken)).send([{ companyId, commissionPercent: 10 }]);
    const tripId = (
      await request(app)
        .post('/api/v1/catalog/trips')
        .set(auth(adminToken))
        .send({ companyId, origin: 'Khartoum', destination: 'Atbara', departureAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), basePrice: 100_000, seatLabels: ['1'] })
    ).body.data.id;
    const manager = (await loginBrokerWithOtp(app, '+249900000803')).accessToken;
    const tu = await request(app).post('/api/v1/broker/wallet/top-ups').set(auth(manager)).send({ amountMinor: 1_000_000, idempotencyKey: 'tu-i' });
    await request(app).post(`/api/v1/broker/wallet/top-ups/${tu.body.data.id}/mock-confirm`).set(auth(manager)).send();
    const seatId = (await request(app).get(`/api/v1/broker/trips/${tripId}`).set(auth(manager))).body.data.seats[0].id;
    await request(app).post(`/api/v1/broker/trips/${tripId}/holds`).set(auth(manager)).send({ seatIds: [seatId] });
    const booking = (
      await request(app)
        .post('/api/v1/broker/bookings/confirm')
        .set(auth(manager))
        .send({ tripId, seatIds: [seatId], passengers: [{ fullName: 'Ali', phone: '0911111111' }], idempotencyKey: 'bk-i' })
    ).body.data.booking;

    expect(booking.bookingRef).toMatch(/^BK-\d{8}-[2-9A-HJKMNP-Z]{6}$/);
    const byRef = await request(app).get(`/api/v1/admin/bookings?q=${booking.bookingRef}`).set(auth(adminToken));
    expect(byRef.body.data.map((b: { id: string }) => b.id)).toEqual([booking.id]);

    await request(app).post(`/api/v1/admin/bookings/${booking.id}/cancel`).set(auth(adminToken)).send({ reason: 'Passenger request by phone' });
    const detail = await request(app).get(`/api/v1/admin/bookings/${booking.id}`).set(auth(adminToken));
    expect(detail.body.data).toMatchObject({ status: 'CANCELLED', cancelReason: 'Passenger request by phone', customer: null });

    const audit = await request(app).get(`/api/v1/audit-logs?resourceType=booking&resourceId=${booking.id}`).set(auth(adminToken));
    const adminEntry = audit.body.data.find((e: { action: string }) => e.action === 'booking.cancelled.admin');
    expect(adminEntry.actor).toMatchObject({ displayName: expect.any(String) });
  });
});
