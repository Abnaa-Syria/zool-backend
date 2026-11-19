import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  bootTestApp,
  shutdownTestApp,
  resetDatabase,
  seedCatalogAndSuperAdmin,
  loginWithOtp,
  loginBrokerWithOtp,
} from './helpers/app';
import { getPrisma } from '../src/infrastructure/database/prisma';

const MANAGER_PHONE = '+249900000201';
const CLERK_PHONE = '+249900000202';
const BASE_PRICE = 20000;

describe('Stage 2.5 broker path hardening', () => {
  let app: Express;
  let adminToken: string;
  let officeId: string;
  let companyId: string;
  let tripId: string;
  let managerToken: string;
  let clerkToken: string;

  beforeAll(async () => {
    app = await bootTestApp();
  });

  afterAll(async () => {
    await shutdownTestApp();
  });

  const tomorrow = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const dayAfter = () => new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const ymd = (iso: string) => iso.slice(0, 10);

  beforeEach(async () => {
    await resetDatabase();
    await seedCatalogAndSuperAdmin();
    const admin = await loginWithOtp(app, '+249900000001');
    adminToken = admin.accessToken;

    const carrier = await request(app)
      .post('/api/v1/carriers')
      .set(auth(adminToken))
      .send({ key: 'hard_carrier', name: 'Hardening Carrier' });
    expect(carrier.status).toBe(201);
    companyId = carrier.body.data.id;

    const office = await request(app)
      .post('/api/v1/brokers')
      .set(auth(adminToken))
      .send({
        code: 'ZG-HARD-1',
        name: 'Hardening Office',
        settlementPeriod: 'MONTHLY',
        manager: { displayName: 'Mgr', phone: MANAGER_PHONE },
      });
    expect(office.status).toBe(201);
    officeId = office.body.data.id;

    await request(app)
      .put(`/api/v1/brokers/${officeId}/carriers`)
      .set(auth(adminToken))
      .send([{ companyId, commissionPercent: 8 }]);

    const trip = await request(app)
      .post('/api/v1/catalog/trips')
      .set(auth(adminToken))
      .send({
        companyId,
        origin: 'Khartoum',
        destination: 'Kassala',
        departureAt: tomorrow(),
        basePrice: BASE_PRICE,
        seatLabels: ['A1', 'A2', 'A3'],
      });
    expect(trip.status).toBe(201);
    tripId = trip.body.data.id;

    managerToken = (await loginBrokerWithOtp(app, MANAGER_PHONE)).accessToken;

    const clerk = await request(app)
      .post('/api/v1/broker/staff')
      .set(auth(managerToken))
      .send({ displayName: 'Clerk', phone: CLERK_PHONE, canBook: true });
    expect(clerk.status).toBe(201);
    clerkToken = (await loginBrokerWithOtp(app, CLERK_PHONE)).accessToken;

    const topUp = await request(app)
      .post('/api/v1/broker/wallet/top-ups')
      .set(auth(managerToken))
      .send({ amountMinor: 500000, idempotencyKey: 'hard-topup-1' });
    await request(app)
      .post(`/api/v1/broker/wallet/top-ups/${topUp.body.data.id}/mock-confirm`)
      .set(auth(managerToken));
  });

  it('admin can patch trip and append seats (skips duplicates)', async () => {
    const patched = await request(app)
      .patch(`/api/v1/catalog/trips/${tripId}`)
      .set(auth(adminToken))
      .send({ basePrice: 22000, isActive: true, origin: 'Omdurman' });
    expect(patched.status).toBe(200);
    expect(patched.body.data.basePrice).toBe(22000);
    expect(patched.body.data.origin).toBe('Omdurman');

    const seats = await request(app)
      .post(`/api/v1/catalog/trips/${tripId}/seats`)
      .set(auth(adminToken))
      .send({ seatLabels: ['A3', 'B1', 'B2'] });
    expect(seats.status).toBe(200);
    expect(seats.body.data.added).toBe(2);
    expect(seats.body.data.skipped).toBe(1);
    expect(seats.body.data.trip.seats.total).toBe(5);
  });

  it('broker search supports date range and trip detail exposes availability', async () => {
    await request(app)
      .post('/api/v1/catalog/trips')
      .set(auth(adminToken))
      .send({
        companyId,
        origin: 'Khartoum',
        destination: 'Atbara',
        departureAt: dayAfter(),
        basePrice: BASE_PRICE,
        seatLabels: ['C1'],
      });

    const range = await request(app)
      .get(
        `/api/v1/broker/trips?dateFrom=${ymd(tomorrow())}&dateTo=${ymd(dayAfter())}&origin=Khartoum`,
      )
      .set(auth(clerkToken));
    expect(range.status).toBe(200);
    expect(range.body.data.length).toBeGreaterThanOrEqual(2);
    expect(range.body.data[0].availability).toMatchObject({
      free: expect.any(Number),
      held: expect.any(Number),
      sold: expect.any(Number),
      total: expect.any(Number),
    });

    const detail = await request(app)
      .get(`/api/v1/broker/trips/${tripId}`)
      .set(auth(clerkToken));
    expect(detail.status).toBe(200);
    expect(detail.body.data.availability).toEqual({ free: 3, held: 0, sold: 0, total: 3 });
    expect(detail.body.data.commissionPercent).toBe(8);
  });

  it('holds return remainingSeconds; dispatch PDF + reports aggregates', async () => {
    const seats = await request(app).get(`/api/v1/broker/trips/${tripId}`).set(auth(clerkToken));
    const seatIds = seats.body.data.seats.slice(0, 2).map((s: { id: string }) => s.id);

    const hold = await request(app)
      .post(`/api/v1/broker/trips/${tripId}/holds`)
      .set(auth(clerkToken))
      .send({ seatIds });
    expect(hold.status).toBe(201);
    expect(hold.body.data.remainingSeconds).toBeGreaterThan(0);
    expect(hold.body.data.holds[0].remainingSeconds).toBeGreaterThan(0);

    const passengers = [
      { fullName: 'Alice Hard', phone: '0912000001' },
      { fullName: 'Bob Hard', phone: '0912000002' },
    ];
    const confirm = await request(app)
      .post('/api/v1/broker/bookings/confirm')
      .set(auth(clerkToken))
      .send({
        tripId,
        seatIds,
        passengers,
        idempotencyKey: 'hard-book-1',
      });
    expect(confirm.status).toBe(201);
    const booking = confirm.body.data.booking;

    const dispatch = await request(app)
      .post(`/api/v1/broker/bookings/${booking.id}/dispatch`)
      .set(auth(clerkToken))
      .send({ channel: 'download' });
    expect(dispatch.status).toBe(200);
    expect(dispatch.body.data.status).toBe('READY');
    expect(dispatch.body.data.document.bookingId).toBe(booking.id);
    expect(dispatch.body.data.pdfBase64.startsWith('JVBERi')).toBe(true);

    const ticketNumber = booking.tickets[0]!.ticketNumber as string;
    const pdf = await request(app)
      .get(`/api/v1/broker/bookings/${booking.id}/tickets/${ticketNumber}/pdf`)
      .set(auth(clerkToken))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
    expect((pdf.body as Buffer).subarray(0, 4).toString('utf8')).toBe('%PDF');

    const summary = await request(app)
      .get('/api/v1/broker/reports/summary')
      .set(auth(managerToken));
    expect(summary.status).toBe(200);
    expect(summary.body.data.ticketsSold).toBe(2);
    expect(summary.body.data.grossSalesMinor).toBe(BASE_PRICE * 2);

    const byEmp = await request(app)
      .get('/api/v1/broker/reports/by-employee')
      .set(auth(managerToken));
    expect(byEmp.body.data.items[0].ticketsSold).toBe(2);

    const byCarrier = await request(app)
      .get('/api/v1/broker/reports/by-carrier')
      .set(auth(managerToken));
    expect(byCarrier.body.data.items[0].companyId).toBe(companyId);

    const wallet = await request(app)
      .get('/api/v1/broker/reports/wallet-activity')
      .set(auth(managerToken));
    expect(wallet.body.data.topUps.totalMinor).toBe(500000);
    expect(wallet.body.data.bookingDebits.totalMinor).toBe(BASE_PRICE * 2);

    expect(await getPrisma().ticketDispatchAttempt.count()).toBe(1);
  });
});
