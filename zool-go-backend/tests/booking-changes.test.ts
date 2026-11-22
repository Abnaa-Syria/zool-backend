import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getPrisma } from '../src/infrastructure/database/prisma';
import { bootTestApp, shutdownTestApp, resetDatabase, seedCatalogAndSuperAdmin, loginWithOtp, loginBrokerWithOtp } from './helpers/app';
import { loginCustomer } from './helpers/mobile';
import { seedNetwork, sudanAt, sudanDate } from './helpers/network';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const P = (fullName: string, gender: 'MALE' | 'FEMALE' = 'MALE') => ({ fullName, gender });

describe('D-CHG-01 booking changes (customer and broker)', () => {
  let app: Express;
  let adminToken: string;
  let token: string;
  let net: Awaited<ReturnType<typeof seedNetwork>>;
  let t1: string;
  let tCheap: string;
  let tDear: string;

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
    t1 = await net.schedule({ departure: sudanAt(2, '07:00'), priceMinor: 3_500_000 });
    tCheap = await net.schedule({ departure: sudanAt(3, '07:00'), priceMinor: 3_000_000 });
    tDear = await net.schedule({ departure: sudanAt(3, '20:00'), priceMinor: 4_000_000 });
    token = (await loginCustomer(app, '+249912600001')).body.data.accessToken;
  });

  async function hold(tripId: string, seatLabels: string[]) {
    const r = await request(app).post(`/api/v1/customer/trips/${tripId}/holds`).set(auth(token)).send({ seatLabels });
    expect(r.status).toBe(201);
    return r.body.data.holds.map((h: { id: string }) => h.id) as string[];
  }

  async function book(paymentMethod: 'ONLINE' | 'CASH_ON_BOARD', key: string) {
    const res = await request(app)
      .post('/api/v1/customer/bookings')
      .set(auth(token))
      .set('Idempotency-Key', key)
      .send({ holdIds: await hold(t1, ['1', '2']), passengers: [P('Ali'), P('Sara', 'FEMALE')], paymentMethod });
    expect(res.status).toBe(201);
    if (paymentMethod === 'ONLINE') await request(app).post(`/api/v1/customer/payments/${res.body.data.payment.intentId}/mock-confirm`).set(auth(token));
    return res.body.data.bookings[0];
  }

  it('changes a seat on the same trip, keeping the ticket number', async () => {
    const b = await book('CASH_ON_BOARD', 'chg-seat-001');
    const ticket = b.tickets[0].ticketNumber;
    const res = await request(app).post(`/api/v1/customer/bookings/${b.id}/change-seat`).set(auth(token)).send({ fromSeatLabel: '1', toSeatLabel: '5' });
    expect(res.status).toBe(200);
    expect(res.body.data.tickets.map((t: { seatLabel: string }) => t.seatLabel)).toEqual(['2', '5']);
    expect(res.body.data.tickets.find((t: { seatLabel: string }) => t.seatLabel === '5').ticketNumber).toBe(ticket);
    const map = await request(app).get(`/api/v1/customer/trips/${t1}/seats`).set(auth(token));
    const st = (l: string) => map.body.data.seats.find((s: { label: string }) => s.label === l).state;
    expect([st('1'), st('5')]).toEqual(['AVAILABLE', 'SOLD']);
    // Ali (male) cannot move to a women-only seat; a sold seat is refused.
    expect((await request(app).post(`/api/v1/customer/bookings/${b.id}/change-seat`).set(auth(token)).send({ fromSeatLabel: '5', toSeatLabel: '11' })).body.code).toBe('WOMEN_ONLY_SEAT');
    expect((await request(app).post(`/api/v1/customer/bookings/${b.id}/change-seat`).set(auth(token)).send({ fromSeatLabel: '5', toSeatLabel: '2' })).status).toBe(409);
  });

  it('moves a paid booking to a cheaper trip and refunds the difference', async () => {
    const b = await book('ONLINE', 'chg-cheap-001');
    const options = await request(app).get(`/api/v1/customer/bookings/${b.id}/change-options?date=${sudanDate(sudanAt(3, '07:00'))}`).set(auth(token));
    expect(options.body.data.map((t: { id: string }) => t.id)).toEqual([tCheap, tDear]);
    expect(options.body.data[0].priceDifferenceMinor).toBe(-1_000_000);

    const holdIds = await hold(tCheap, ['3', '4']);
    const quote = await request(app).post(`/api/v1/customer/bookings/${b.id}/change-quote`).set(auth(token)).send({ holdIds });
    expect(quote.body.data).toMatchObject({ oldTotalMinor: 7_000_000, newTotalMinor: 6_000_000, payMinor: 0, refundMinor: 1_000_000 });

    const res = await request(app).post(`/api/v1/customer/bookings/${b.id}/change`).set(auth(token)).set('Idempotency-Key', 'chg-cheap-key').send({ holdIds });
    expect(res.status).toBe(201);
    expect(res.body.data.booking).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID', changeCount: 1, amounts: { totalMinor: 6_000_000 } });
    expect(res.body.data.booking.tickets.map((t: { passenger: { fullName: string }; seatLabel: string }) => `${t.seatLabel}:${t.passenger.fullName}`)).toEqual(['3:Ali', '4:Sara']);
    expect(res.body.data.refund).toMatchObject({ amountMinor: 1_000_000, reason: 'CHANGE_DIFFERENCE', status: 'SUCCEEDED' });
    const old = await request(app).get(`/api/v1/customer/bookings/${b.id}`).set(auth(token));
    expect(old.body.data).toMatchObject({ status: 'CHANGED', replacedByBookingId: res.body.data.booking.id });
    expect(old.body.data.tickets[0]).toMatchObject({ status: 'CHANGED', qrPayload: null });
    const replay = await request(app).post(`/api/v1/customer/bookings/${b.id}/change`).set(auth(token)).set('Idempotency-Key', 'chg-cheap-key').send({ holdIds });
    expect(replay.status).toBe(200);
  });

  it('moves a paid booking to a dearer trip: old stays valid until the difference is paid', async () => {
    await request(app).patch('/api/v1/admin/settings').set(auth(adminToken)).send({ values: { 'change.feeMinor': 50_000 } });
    const b = await book('ONLINE', 'chg-dear-001');
    const holdIds = await hold(tDear, ['5', '6']);
    const res = await request(app).post(`/api/v1/customer/bookings/${b.id}/change`).set(auth(token)).set('Idempotency-Key', 'chg-dear-key').send({ holdIds });
    expect(res.status).toBe(201);
    expect(res.body.data.booking.status).toBe('PENDING_PAYMENT');
    expect(res.body.data.payment).toMatchObject({ amountMinor: 1_050_000, status: 'PENDING' });
    expect((await request(app).get(`/api/v1/customer/bookings/${b.id}`).set(auth(token))).body.data.status).toBe('CONFIRMED');

    await request(app).post(`/api/v1/customer/payments/${res.body.data.payment.intentId}/mock-confirm`).set(auth(token));
    expect((await request(app).get(`/api/v1/customer/bookings/${b.id}`).set(auth(token))).body.data.status).toBe('CHANGED');
    expect((await request(app).get(`/api/v1/customer/bookings/${res.body.data.booking.id}`).set(auth(token))).body.data).toMatchObject({ status: 'CONFIRMED', changeCount: 1 });
  });

  it('cash bookings change with the new total collected at boarding; limits apply', async () => {
    const b = await book('CASH_ON_BOARD', 'chg-cash-001');
    const res = await request(app).post(`/api/v1/customer/bookings/${b.id}/change`).set(auth(token)).set('Idempotency-Key', 'chg-cash-key').send({ holdIds: await hold(tDear, ['7', '8']) });
    expect(res.body.data.booking).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'UNPAID_CASH', amounts: { totalMinor: 8_000_000 } });
    expect(res.body.data.booking.tickets[0].cashToCollectMinor).toBe(4_000_000);

    await request(app).patch('/api/v1/admin/settings').set(auth(adminToken)).send({ values: { 'change.maxChangesPerBooking': 1 } });
    const again = await request(app).post(`/api/v1/customer/bookings/${res.body.data.booking.id}/change-quote`).set(auth(token)).send({ holdIds: await hold(tCheap, ['9', '10']) });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('CHANGE_NOT_ALLOWED');
  });

  it('broker change: wallet difference, commission re-accrued', async () => {
    const office = await request(app)
      .post('/api/v1/brokers')
      .set(auth(adminToken))
      .send({ code: 'ZG-BRK-C1', name: 'Office', settlementPeriod: 'MONTHLY', manager: { displayName: 'Manager', phone: '+249900000941' } });
    await request(app).put(`/api/v1/brokers/${office.body.data.id}/carriers`).set(auth(adminToken)).send([{ companyId: net.companyId, commissionPercent: 10 }]);
    const mgr = (await loginBrokerWithOtp(app, '+249900000941')).accessToken;
    const tu = await request(app).post('/api/v1/broker/wallet/top-ups').set(auth(mgr)).send({ amountMinor: 20_000_000, idempotencyKey: 'tu-chg-1' });
    await request(app).post(`/api/v1/broker/wallet/top-ups/${tu.body.data.id}/mock-confirm`).set(auth(mgr)).send();

    const seatId = async (tripId: string, label: string) =>
      (await request(app).get(`/api/v1/broker/trips/${tripId}`).set(auth(mgr))).body.data.seats.find((s: { label: string }) => s.label === label).id as string;
    const s1 = await seatId(t1, '1');
    await request(app).post(`/api/v1/broker/trips/${t1}/holds`).set(auth(mgr)).send({ seatIds: [s1] });
    const booked = await request(app)
      .post('/api/v1/broker/bookings/confirm')
      .set(auth(mgr))
      .send({ tripId: t1, seatIds: [s1], passengers: [{ fullName: 'Pax One', phone: '0911111111' }], idempotencyKey: 'brk-chg-book' });
    expect(booked.status).toBe(201);
    const bookingId = booked.body.data.booking.id;

    const s2 = await seatId(tDear, '2');
    await request(app).post(`/api/v1/broker/trips/${tDear}/holds`).set(auth(mgr)).send({ seatIds: [s2] });
    const quote = await request(app).post(`/api/v1/broker/bookings/${bookingId}/change-quote`).set(auth(mgr)).send({ tripId: tDear, seatIds: [s2] });
    expect(quote.body.data).toMatchObject({ payMinor: 500_000, refundMinor: 0, commission: { newCommissionMinor: 400_000 }, newTrip: { seatsTotal: 28 } });
    const res = await request(app).post(`/api/v1/broker/bookings/${bookingId}/change`).set(auth(mgr)).send({ tripId: tDear, seatIds: [s2], idempotencyKey: 'brk-chg-key1' });
    expect(res.status).toBe(201);
    expect(res.body.data.booking).toMatchObject({ status: 'CONFIRMED', totalAmountMinor: 4_000_000, commissionAmountMinor: 400_000 });

    const wallet = await request(app).get('/api/v1/broker/wallet').set(auth(mgr));
    expect(wallet.body.data.balanceMinor).toBe(20_000_000 - 3_500_000 - 500_000);
    const accruals = await getPrisma().commissionAccrual.findMany({ orderBy: { createdAt: 'asc' } });
    expect(accruals.map((a) => `${a.amount}:${a.status}`)).toEqual(['350000:CLAWED_BACK', '400000:UNSETTLED']);
    const oldB = (await request(app).get(`/api/v1/broker/bookings/${bookingId}`).set(auth(mgr))).body.data;
    expect(oldB).toMatchObject({ status: 'CHANGED', replacedByBookingId: res.body.data.booking.id });
    expect(res.body.data.booking.replacesBookingId).toBe(bookingId);

    // Seat change on the broker side.
    const nb = res.body.data.booking.id;
    const seat = await request(app).post(`/api/v1/broker/bookings/${nb}/change-seat`).set(auth(mgr)).send({ fromSeatLabel: '2', toSeatLabel: '3' });
    expect(seat.status).toBe(200);
    expect(seat.body.data.tickets[0].seatLabel).toBe('3');
  });
});
