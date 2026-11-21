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

const MANAGER_PHONE = '+249900000521';
const PRICE = 1_500_000;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** D-SUS-01: carrier suspension stops sales; admin cancels trips with a full refund. */
describe('Carrier suspension and trip cancellation (D-SUS-01)', () => {
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
    const office = await request(app)
      .post('/api/v1/brokers')
      .set(auth(adminToken))
      .send({ code: 'ZG-BRK-9', name: 'Office', settlementPeriod: 'MONTHLY', manager: { displayName: 'Manager', phone: MANAGER_PHONE } });
    officeId = office.body.data.id;
    await request(app).put(`/api/v1/brokers/${officeId}/carriers`).set(auth(adminToken)).send([{ companyId, commissionPercent: 10 }]);
    tripId = (
      await request(app)
        .post('/api/v1/catalog/trips')
        .set(auth(adminToken))
        .send({
          companyId,
          origin: 'Khartoum',
          destination: 'Kassala',
          departureAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
          basePrice: PRICE,
          seatLabels: ['1', '2', '3', '4'],
        })
    ).body.data.id;

    managerToken = (await loginBrokerWithOtp(app, MANAGER_PHONE)).accessToken;
    const topUp = await request(app).post('/api/v1/broker/wallet/top-ups').set(auth(managerToken)).send({ amountMinor: 10_000_000, idempotencyKey: 'tu-1' });
    await request(app).post(`/api/v1/broker/wallet/top-ups/${topUp.body.data.id}/mock-confirm`).set(auth(managerToken)).send();
  });

  async function seats() {
    const res = await request(app).get(`/api/v1/broker/trips/${tripId}`).set(auth(managerToken));
    return res.body.data.seats as Array<{ id: string; status: string }>;
  }

  async function book(seatIds: string[], key: string) {
    expect((await request(app).post(`/api/v1/broker/trips/${tripId}/holds`).set(auth(managerToken)).send({ seatIds })).status).toBe(201);
    const res = await request(app)
      .post('/api/v1/broker/bookings/confirm')
      .set(auth(managerToken))
      .send({ tripId, seatIds, passengers: seatIds.map((_, i) => ({ fullName: `P${i}`, phone: '0911111111' })), idempotencyKey: key });
    expect(res.status).toBe(201);
    return res.body.data.booking.id as string;
  }

  const balance = async () => (await request(app).get('/api/v1/broker/wallet').set(auth(managerToken))).body.data.balanceMinor as number;

  it('suspension stops sales, releases holds, keeps confirmed bookings, and lists affected trips', async () => {
    const s = await seats();
    const bookingId = await book([s[0]!.id, s[1]!.id], 'bk-1');
    expect((await request(app).post(`/api/v1/broker/trips/${tripId}/holds`).set(auth(managerToken)).send({ seatIds: [s[2]!.id] })).status).toBe(201);

    const suspend = await request(app)
      .patch(`/api/v1/carriers/${companyId}`)
      .set(auth(adminToken))
      .send({ status: 'SUSPENDED', shortName: 'النيل', cashEnabled: false });
    expect(suspend.status).toBe(200);
    expect(suspend.body.data).toMatchObject({ status: 'SUSPENDED', shortName: 'النيل', cashEnabled: false });
    expect(suspend.body.data.suspendedAt).not.toBeNull();

    // Held seat released; sold seats untouched; no holds left.
    const seatRows = await getPrisma().tripSeat.findMany({ where: { tripId }, orderBy: { sortOrder: 'asc' } });
    expect(seatRows.map((r) => r.status)).toEqual(['SOLD', 'SOLD', 'FREE', 'FREE']);
    expect(await getPrisma().seatHold.count()).toBe(0);

    // Sales stopped for the broker.
    const search = await request(app).get('/api/v1/broker/trips').set(auth(managerToken));
    expect(search.body.data).toHaveLength(0);
    expect((await request(app).get(`/api/v1/broker/trips/${tripId}`).set(auth(managerToken))).status).toBe(404);

    // Confirmed booking still valid.
    expect((await getPrisma().booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe('CONFIRMED');

    const affected = await request(app).get(`/api/v1/carriers/${companyId}/affected-trips`).set(auth(adminToken));
    expect(affected.status).toBe(200);
    expect(affected.body.data).toEqual([
      expect.objectContaining({ tripId, confirmedBookings: 1, ticketCount: 2, totalAmountMinor: 2 * PRICE, byChannel: { BROKER: 1, DIRECT: 0 } }),
    ]);

    const reactivate = await request(app).patch(`/api/v1/carriers/${companyId}`).set(auth(adminToken)).send({ status: 'ACTIVE' });
    expect(reactivate.body.data.suspendedAt).toBeNull();
    expect((await request(app).get('/api/v1/broker/trips').set(auth(managerToken))).body.data).toHaveLength(1);
  });

  it('cancelling a trip refunds every booking in full, notifies the office, and is safe to re-run', async () => {
    const s = await seats();
    const before = await balance();
    await book([s[0]!.id], 'bk-a');
    await book([s[1]!.id, s[2]!.id], 'bk-b');
    expect(await balance()).toBe(before - 3 * PRICE);

    const cancel = await request(app).post(`/api/v1/admin/trips/${tripId}/cancel`).set(auth(adminToken)).send({ reason: 'Carrier suspended' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.data).toMatchObject({ refundedBookings: 2, refundedAmountMinor: 3 * PRICE, failed: [] });
    expect(cancel.body.data.trip.status).toBe('CANCELLED');
    expect(await balance()).toBe(before);

    const accruals = await getPrisma().commissionAccrual.findMany();
    expect(accruals.every((a) => a.status === 'CLAWED_BACK')).toBe(true);
    const notes = await getPrisma().notification.findMany({ where: { type: 'TRIP_CANCELLED' } });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.recipientType).toBe('BROKER_EMPLOYEE');

    // Re-run: nothing refunded twice.
    const again = await request(app).post(`/api/v1/admin/trips/${tripId}/cancel`).set(auth(adminToken)).send({ reason: 'retry' });
    expect(again.status).toBe(200);
    expect(again.body.data.refundedBookings).toBe(0);
    expect(await balance()).toBe(before);

    // Cancelled trips can no longer be sold.
    expect((await request(app).get(`/api/v1/broker/trips/${tripId}`).set(auth(managerToken))).status).toBe(404);
  });

  it('refuses to cancel a trip that already departed', async () => {
    await getPrisma().trip.update({ where: { id: tripId }, data: { status: 'IN_PROGRESS' } });
    const res = await request(app).post(`/api/v1/admin/trips/${tripId}/cancel`).set(auth(adminToken)).send({ reason: 'late' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TRIP_NOT_CANCELLABLE');
  });
});
