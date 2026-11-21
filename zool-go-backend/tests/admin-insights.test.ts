import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { bootTestApp, shutdownTestApp, resetDatabase, seedCatalogAndSuperAdmin, loginWithOtp, loginBrokerWithOtp } from './helpers/app';
import { getPrisma } from '../src/infrastructure/database/prisma';

const MANAGER_PHONE = '+249900000531';
const PRICE = 1_500_000;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Admin overview, reports and CSV export (Milestone C)', () => {
  let app: Express;
  let adminToken: string;
  let managerToken: string;
  let companyId: string;
  let officeId: string;
  let tripId: string;

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
    companyId = (await request(app).post('/api/v1/carriers').set(auth(adminToken)).send({ key: 'nile_bus', name: 'Nile Bus' })).body.data.id;
    officeId = (
      await request(app)
        .post('/api/v1/brokers')
        .set(auth(adminToken))
        .send({ code: 'ZG-BRK-R', name: 'Reports Office', settlementPeriod: 'MONTHLY', manager: { displayName: 'Manager', phone: MANAGER_PHONE } })
    ).body.data.id;
    await request(app).put(`/api/v1/brokers/${officeId}/carriers`).set(auth(adminToken)).send([{ companyId, commissionPercent: 10 }]);
    tripId = (
      await request(app)
        .post('/api/v1/catalog/trips')
        .set(auth(adminToken))
        .send({ companyId, origin: 'Khartoum', destination: 'Kassala', departureAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), basePrice: PRICE, seatLabels: ['1', '2', '3', '4'] })
    ).body.data.id;
    managerToken = (await loginBrokerWithOtp(app, MANAGER_PHONE)).accessToken;
    const tu = await request(app).post('/api/v1/broker/wallet/top-ups').set(auth(managerToken)).send({ amountMinor: 10_000_000, idempotencyKey: 'tu-r' });
    await request(app).post(`/api/v1/broker/wallet/top-ups/${tu.body.data.id}/mock-confirm`).set(auth(managerToken)).send();

    // Two bookings, one cancelled.
    const seats = (await request(app).get(`/api/v1/broker/trips/${tripId}`).set(auth(managerToken))).body.data.seats as Array<{ id: string }>;
    const ids: string[] = [];
    for (const [i, seat] of seats.slice(0, 2).entries()) {
      await request(app).post(`/api/v1/broker/trips/${tripId}/holds`).set(auth(managerToken)).send({ seatIds: [seat.id] });
      const res = await request(app)
        .post('/api/v1/broker/bookings/confirm')
        .set(auth(managerToken))
        .send({ tripId, seatIds: [seat.id], passengers: [{ fullName: i === 0 ? 'Omar' : 'Ali', phone: '0911111111' }], idempotencyKey: `bk-${i}` });
      expect(res.status).toBe(201);
      ids.push(res.body.data.booking.id);
    }
    await request(app).post(`/api/v1/admin/bookings/${ids[1]}/cancel`).set(auth(adminToken)).send({ reason: 'test cancel' });
  });

  const today = () => new Date().toISOString().slice(0, 10);
  const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  it('summary matches the bookings and wallet state for the window', async () => {
    const res = await request(app).get(`/api/v1/admin/reports/summary?from=${today()}&to=${tomorrow()}`).set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      bookingsCount: 1,
      bookingsAmountMinor: PRICE,
      cancelledCount: 1,
      refundedAmountMinor: PRICE,
      unsettledCommissionMinor: PRICE / 10,
      settledCommissionMinor: 0,
      walletsBalanceMinor: 10_000_000 - PRICE,
      currency: 'SDG',
    });

    const byCarrier = await request(app).get(`/api/v1/admin/reports/by-carrier?from=${today()}&to=${tomorrow()}`).set(auth(adminToken));
    expect(byCarrier.body.data).toEqual([{ company: { id: companyId, name: 'Nile Bus' }, bookingsCount: 1, bookingsAmountMinor: PRICE, commissionAmountMinor: PRICE / 10 }]);
    const byOffice = await request(app).get(`/api/v1/admin/reports/by-office?from=${today()}&to=${tomorrow()}`).set(auth(adminToken));
    expect(byOffice.body.data[0]).toMatchObject({ office: { id: officeId, code: 'ZG-BRK-R' }, bookingsCount: 1 });
  });

  it('validates the reporting window', async () => {
    expect((await request(app).get('/api/v1/admin/reports/summary').set(auth(adminToken))).status).toBe(422);
    const reversed = await request(app).get(`/api/v1/admin/reports/summary?from=${tomorrow()}&to=${today()}`).set(auth(adminToken));
    expect(reversed.status).toBe(422);
    const huge = await request(app).get('/api/v1/admin/reports/summary?from=2026-01-01&to=2026-12-31').set(auth(adminToken));
    expect(huge.body.code).toBe('RANGE_TOO_LARGE');
  });

  it('overview includes sections only for the permissions the caller holds', async () => {
    const full = await request(app).get('/api/v1/admin/overview').set(auth(adminToken));
    expect(full.status).toBe(200);
    expect(full.body.data).toMatchObject({ bookingsCount: 1, walletsBalanceMinor: 10_000_000 - PRICE, unsettledCommissionMinor: PRICE / 10, draftSettlementsCount: 0, pendingTopUpsCount: 0 });

    const role = await request(app).post('/api/v1/roles').set(auth(adminToken)).send({ key: 'ops_only', name: 'Ops', permissionKeys: ['bookings.view'] });
    await request(app).post('/api/v1/admins').set(auth(adminToken)).send({ displayName: 'Ops user', employeeCode: 'ZG-EMP-OPS', phone: '+249900000532', roleIds: [role.body.data.id] });
    await new Promise((r) => setTimeout(r, 1100));
    const ops = (await loginWithOtp(app, '+249900000532')).accessToken;
    const limited = await request(app).get('/api/v1/admin/overview').set(auth(ops));
    expect(limited.body.data.bookingsCount).toBe(1);
    expect(limited.body.data).not.toHaveProperty('walletsBalanceMinor');
    expect(limited.body.data).not.toHaveProperty('unsettledCommissionMinor');
    expect((await request(app).get(`/api/v1/admin/reports/summary?from=${today()}&to=${tomorrow()}`).set(auth(ops))).status).toBe(403);
  });

  it('exports bookings as CSV with BOM, same filters as the list, and audit', async () => {
    const res = await request(app).get('/api/v1/admin/bookings/export.csv').set(auth(adminToken)).buffer(true).parse((r, cb) => {
      let data = '';
      r.setEncoding('utf8');
      r.on('data', (c: string) => (data += c));
      r.on('end', () => cb(null, data));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const text = res.body as string;
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).trim().split('\r\n');
    expect(lines[0]).toContain('bookingId,bookingRef,channel,status');
    expect(lines).toHaveLength(3);
    expect(text).toContain('CANCELLED');
    expect(await getPrisma().auditLog.count({ where: { action: 'bookings.exported' } })).toBe(1);

    const filtered = await request(app).get('/api/v1/admin/bookings/export.csv?status=CONFIRMED').set(auth(adminToken)).buffer(true);
    expect(String(filtered.text).trim().split('\r\n')).toHaveLength(2);
  });
});

