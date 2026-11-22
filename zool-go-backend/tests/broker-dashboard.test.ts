import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { bootTestApp, shutdownTestApp, resetDatabase, seedCatalogAndSuperAdmin, loginWithOtp, loginBrokerWithOtp } from './helpers/app';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const PRICE = 200_000;

describe('GET /broker/dashboard', () => {
  let app: Express;

  beforeAll(async () => {
    app = await bootTestApp();
  });

  afterAll(async () => {
    await shutdownTestApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedCatalogAndSuperAdmin();
  });

  it('shows office-wide numbers to the manager and own sales to a clerk without reports access', async () => {
    const admin = (await loginWithOtp(app, '+249900000001')).accessToken;
    const companyId = (await request(app).post('/api/v1/carriers').set(auth(admin)).send({ key: 'nile_bus', name: 'Nile Bus' })).body.data.id;
    const officeId = (
      await request(app)
        .post('/api/v1/brokers')
        .set(auth(admin))
        .send({ code: 'ZG-BRK-D', name: 'Office', settlementPeriod: 'MONTHLY', manager: { displayName: 'Manager', phone: '+249900000901' } })
    ).body.data.id;
    await request(app).put(`/api/v1/brokers/${officeId}/carriers`).set(auth(admin)).send([{ companyId, commissionPercent: 10 }]);
    const tripId = (
      await request(app)
        .post('/api/v1/catalog/trips')
        .set(auth(admin))
        .send({ companyId, origin: 'Khartoum', destination: 'Kassala', departureAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), basePrice: PRICE, seatLabels: ['1', '2', '3'] })
    ).body.data.id;

    const manager = (await loginBrokerWithOtp(app, '+249900000901')).accessToken;
    await request(app).post('/api/v1/broker/staff').set(auth(manager)).send({ displayName: 'Clerk', phone: '+249900000902', canBook: true });
    const clerk = (await loginBrokerWithOtp(app, '+249900000902')).accessToken;
    const tu = await request(app).post('/api/v1/broker/wallet/top-ups').set(auth(manager)).send({ amountMinor: 5_000_000, idempotencyKey: 'tu-d' });
    await request(app).post(`/api/v1/broker/wallet/top-ups/${tu.body.data.id}/mock-confirm`).set(auth(manager)).send();

    const seats = (await request(app).get(`/api/v1/broker/trips/${tripId}`).set(auth(manager))).body.data.seats as Array<{ id: string }>;
    const book = async (token: string, seatId: string, key: string) => {
      await request(app).post(`/api/v1/broker/trips/${tripId}/holds`).set(auth(token)).send({ seatIds: [seatId] });
      const res = await request(app)
        .post('/api/v1/broker/bookings/confirm')
        .set(auth(token))
        .send({ tripId, seatIds: [seatId], passengers: [{ fullName: 'Passenger', phone: '0911111111' }], idempotencyKey: key });
      expect(res.status).toBe(201);
    };
    await book(manager, seats[0]!.id, 'm-1');
    await book(clerk, seats[1]!.id, 'c-1');

    const m = await request(app).get('/api/v1/broker/dashboard').set(auth(manager));
    expect(m.status).toBe(200);
    expect(m.body.data).toMatchObject({ scope: 'OFFICE', bookingsCount: 2, ticketsSold: 2, grossSalesMinor: 2 * PRICE, commissionAccruedMinor: 2 * (PRICE / 10) });

    const c = await request(app).get('/api/v1/broker/dashboard').set(auth(clerk));
    expect(c.status).toBe(200);
    expect(c.body.data).toMatchObject({ scope: 'SELF', bookingsCount: 1, ticketsSold: 1, grossSalesMinor: PRICE });

    // The clerk still cannot open the office-wide reports.
    expect((await request(app).get('/api/v1/broker/reports/summary').set(auth(clerk))).status).toBe(403);
  });
});
