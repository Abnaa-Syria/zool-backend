import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { bootTestApp, shutdownTestApp, resetDatabase, seedCatalogAndSuperAdmin, loginWithOtp, loginBrokerWithOtp } from './helpers/app';
import { seedNetwork, sudanAt } from './helpers/network';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Broker round trip (D-RT-01) and women-only seats', () => {
  let app: Express;
  let mgr: string;
  let out: string;
  let back: string;

  beforeAll(async () => {
    app = await bootTestApp();
  });
  afterAll(async () => {
    await shutdownTestApp();
  });
  beforeEach(async () => {
    await resetDatabase();
    await seedCatalogAndSuperAdmin();
    const admin = (await loginWithOtp(app, '+249900000001')).accessToken;
    const net = await seedNetwork(app, admin);
    out = await net.schedule({ departure: sudanAt(2, '07:00'), priceMinor: 3_500_000 });
    back = await net.schedule({ departure: sudanAt(4, '07:00'), priceMinor: 3_000_000, back: true });
    const office = await request(app)
      .post('/api/v1/brokers')
      .set(auth(admin))
      .send({ code: 'ZG-BRK-R1', name: 'Office', settlementPeriod: 'MONTHLY', manager: { displayName: 'Manager', phone: '+249900000951' } });
    await request(app).put(`/api/v1/brokers/${office.body.data.id}/carriers`).set(auth(admin)).send([{ companyId: net.companyId, commissionPercent: 10 }]);
    mgr = (await loginBrokerWithOtp(app, '+249900000951')).accessToken;
    const tu = await request(app).post('/api/v1/broker/wallet/top-ups').set(auth(mgr)).send({ amountMinor: 20_000_000, idempotencyKey: 'tu-rt-1' });
    await request(app).post(`/api/v1/broker/wallet/top-ups/${tu.body.data.id}/mock-confirm`).set(auth(mgr)).send();
  });

  async function seatIds(tripId: string, labels: string[]) {
    const seats = (await request(app).get(`/api/v1/broker/trips/${tripId}`).set(auth(mgr))).body.data.seats as Array<{ id: string; label: string }>;
    const ids = labels.map((l) => seats.find((s) => s.label === l)!.id);
    expect((await request(app).post(`/api/v1/broker/trips/${tripId}/holds`).set(auth(mgr)).send({ seatIds: ids })).status).toBe(201);
    return ids;
  }

  const pax = [
    { fullName: 'Ali Omer', phone: '0911111111', gender: 'MALE' },
    { fullName: 'Sara Ali', phone: '0911111112', gender: 'FEMALE' },
  ];

  it('quotes and books both legs with one wallet check, two debits and a group', async () => {
    const o = await seatIds(out, ['1', '2']);
    const r = await seatIds(back, ['3', '4']);
    const quote = await request(app).post('/api/v1/broker/bookings/quote').set(auth(mgr)).send({ tripId: out, seatIds: o, passengers: pax, returnTrip: { tripId: back, seatIds: r } });
    expect(quote.status).toBe(200);
    expect(quote.body.data).toMatchObject({ combinedTotalMinor: 13_000_000, combinedCommissionMinor: 1_300_000, balanceAfterMinor: 7_000_000, sufficientBalance: true });

    const body = { tripId: out, seatIds: o, passengers: pax, returnTrip: { tripId: back, seatIds: r }, idempotencyKey: 'rt-book-1' };
    const res = await request(app).post('/api/v1/broker/bookings/confirm').set(auth(mgr)).send(body);
    expect(res.status).toBe(201);
    expect(res.body.data.booking.trip.id).toBe(out);
    expect(res.body.data.returnBooking.trip.id).toBe(back);
    expect(res.body.data.balanceAfterMinor).toBe(7_000_000);
    expect(res.body.data.returnBooking.tickets.every((t: { qrPayload: string | null }) => t.qrPayload)).toBe(true);

    const replay = await request(app).post('/api/v1/broker/bookings/confirm').set(auth(mgr)).send(body);
    expect(replay.status).toBe(200);
    expect(replay.body.data.returnBooking.id).toBe(res.body.data.returnBooking.id);
    expect((await request(app).get('/api/v1/broker/wallet').set(auth(mgr))).body.data.balanceMinor).toBe(7_000_000);

    // Search and tabs on the bookings list.
    const byName = await request(app).get('/api/v1/broker/bookings?q=Sara').set(auth(mgr));
    expect(byName.body.meta.total).toBe(2);
    const byRef = await request(app).get(`/api/v1/broker/bookings?q=${res.body.data.booking.bookingRef}`).set(auth(mgr));
    expect(byRef.body.data.map((b: { id: string }) => b.id)).toEqual([res.body.data.booking.id]);
    await request(app).post(`/api/v1/broker/bookings/${res.body.data.returnBooking.id}/cancel`).set(auth(mgr));
    expect((await request(app).get('/api/v1/broker/bookings?tab=ACTIVE').set(auth(mgr))).body.meta.total).toBe(1);
    expect((await request(app).get('/api/v1/broker/bookings?tab=CANCELLED').set(auth(mgr))).body.meta.total).toBe(1);
  });

  it('rejects a same-direction "return" and a man on a women-only seat', async () => {
    const o = await seatIds(out, ['5']);
    const bad = await request(app)
      .post('/api/v1/broker/bookings/confirm')
      .set(auth(mgr))
      .send({ tripId: out, seatIds: o, passengers: [pax[0]], returnTrip: { tripId: out, seatIds: o }, idempotencyKey: 'rt-bad-1' });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('ROUND_TRIP_INVALID');

    const w = await seatIds(out, ['11']);
    const man = await request(app).post('/api/v1/broker/bookings/confirm').set(auth(mgr)).send({ tripId: out, seatIds: w, passengers: [pax[0]], idempotencyKey: 'rt-women-1' });
    expect(man.status).toBe(422);
    expect(man.body.code).toBe('WOMEN_ONLY_SEAT');
    const woman = await request(app).post('/api/v1/broker/bookings/confirm').set(auth(mgr)).send({ tripId: out, seatIds: w, passengers: [pax[1]], idempotencyKey: 'rt-women-2' });
    expect(woman.status).toBe(201);
    expect((await request(app).get('/api/v1/broker/wallet').set(auth(mgr))).body.data.balanceMinor).toBe(16_500_000);
  });
});
