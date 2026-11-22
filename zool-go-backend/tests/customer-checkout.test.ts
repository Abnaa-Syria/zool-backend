import { createHmac } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { env } from '../src/config/env';
import { getPrisma } from '../src/infrastructure/database/prisma';
import { verifyTicketQr } from '../src/shared/security/ticket-qr';
import { bootTestApp, shutdownTestApp, resetDatabase, seedCatalogAndSuperAdmin, loginWithOtp } from './helpers/app';
import { loginCustomer } from './helpers/mobile';
import { DAY, seedNetwork, sudanAt } from './helpers/network';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const P = (fullName: string, gender: 'MALE' | 'FEMALE' = 'MALE') => ({ fullName, gender });

describe('Customer checkout: cash, online, round trip, coupons, tickets', () => {
  let app: Express;
  let adminToken: string;
  let token: string;
  let customerId: string;
  let net: Awaited<ReturnType<typeof seedNetwork>>;
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
    adminToken = (await loginWithOtp(app, '+249900000001')).accessToken;
    net = await seedNetwork(app, adminToken);
    out = await net.schedule({ departure: sudanAt(2, '07:00'), priceMinor: 3_500_000 });
    back = await net.schedule({ departure: sudanAt(4, '07:00'), priceMinor: 3_000_000, back: true });
    const login = await loginCustomer(app, '+249912400001');
    token = login.body.data.accessToken;
    customerId = login.body.data.customer.id;
  });

  async function hold(tripId: string, seatLabels: string[], t = token) {
    const res = await request(app).post(`/api/v1/customer/trips/${tripId}/holds`).set(auth(t)).send({ seatLabels });
    expect(res.status).toBe(201);
    return res.body.data.holds.map((h: { id: string }) => h.id) as string[];
  }

  const create = (body: object, key: string, t = token) =>
    request(app).post('/api/v1/customer/bookings').set(auth(t)).set('Idempotency-Key', key).send(body);

  it('cash on board: confirmed at once with signed QR tickets, idempotent, listed, PDF', async () => {
    const holdIds = await hold(out, ['1', '2']);
    const quote = await request(app).post('/api/v1/customer/bookings/quote').set(auth(token)).send({ holdIds, passengers: [P('Ali'), P('Sara', 'FEMALE')] });
    expect(quote.status).toBe(200);
    expect(quote.body.data).toMatchObject({ type: 'ONE_WAY', totalMinor: 7_000_000, cashAllowed: true, cashBlockedReason: null });

    const body = { holdIds, passengers: [P('Ali'), P('Sara', 'FEMALE')], paymentMethod: 'CASH_ON_BOARD' };
    const res = await create(body, 'cash-key-0001');
    expect(res.status).toBe(201);
    const booking = res.body.data.bookings[0];
    expect(booking).toMatchObject({ status: 'CONFIRMED', paymentMethod: 'CASH_ON_BOARD', paymentStatus: 'UNPAID_CASH', amounts: { totalMinor: 7_000_000 } });
    expect(booking.bookingRef).toMatch(/^BK-/);
    expect(booking.tickets.map((t: { seatLabel: string }) => t.seatLabel)).toEqual(['1', '2']);
    expect(booking.tickets[0]).toMatchObject({ passenger: { fullName: 'Ali' }, cashToCollectMinor: 3_500_000, boardingStatus: 'PENDING' });
    expect(verifyTicketQr(booking.tickets[0].qrPayload)).toEqual({ ticketNumber: booking.tickets[0].ticketNumber, tripId: out });
    expect(verifyTicketQr(booking.tickets[0].qrPayload.replace(/.$/, 'x'))).toBeNull();
    expect(res.body.data.payment).toBeNull();

    const replay = await create(body, 'cash-key-0001');
    expect(replay.status).toBe(200);
    expect(replay.body.data.replayed).toBe(true);
    expect(replay.body.data.bookings[0].id).toBe(booking.id);

    const seats = await request(app).get(`/api/v1/customer/trips/${out}/seats`).set(auth(token));
    expect(seats.body.data.seats.find((s: { label: string }) => s.label === '1').state).toBe('SOLD');

    const list = await request(app).get('/api/v1/customer/bookings?tab=UPCOMING').set(auth(token));
    expect(list.body.data.map((b: { id: string }) => b.id)).toEqual([booking.id]);
    expect((await request(app).get('/api/v1/customer/bookings?tab=PAST').set(auth(token))).body.data).toHaveLength(0);

    const ticket = await request(app).get(`/api/v1/customer/tickets/${booking.tickets[0].ticketNumber}`).set(auth(token));
    expect(ticket.body.data.ticket.seatLabel).toBe('1');
    const pdf = await request(app).get(`/api/v1/customer/tickets/${booking.tickets[0].ticketNumber}/pdf`).set(auth(token));
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');

    // Another customer cannot read it.
    const other = (await loginCustomer(app, '+249912400002')).body.data.accessToken;
    expect((await request(app).get(`/api/v1/customer/bookings/${booking.id}`).set(auth(other))).status).toBe(404);
    expect((await request(app).get(`/api/v1/customer/tickets/${booking.tickets[0].ticketNumber}`).set(auth(other))).status).toBe(404);

    const notes = await getPrisma().notification.findMany({ where: { recipientId: customerId } });
    expect(notes.map((n) => n.type)).toEqual(['TICKET_ISSUED']);
  });

  it('enforces women-only seats and cash limits', async () => {
    const women = await hold(out, ['11']);
    const bad = await request(app).post('/api/v1/customer/bookings/quote').set(auth(token)).send({ holdIds: women, passengers: [P('Omar')] });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('WOMEN_ONLY_SEAT');
    expect((await request(app).post('/api/v1/customer/bookings/quote').set(auth(token)).send({ holdIds: women, passengers: [P('Huda', 'FEMALE')] })).status).toBe(200);

    await request(app).patch('/api/v1/admin/settings').set(auth(adminToken)).send({ values: { 'cash.maxOpenBookingsPerCustomer': 1 } });
    expect((await create({ holdIds: await hold(out, ['3']), passengers: [P('Amal')], paymentMethod: 'CASH_ON_BOARD' }, 'cash-lim-0001')).status).toBe(201);
    const second = await hold(back, ['4']);
    const quote = await request(app).post('/api/v1/customer/bookings/quote').set(auth(token)).send({ holdIds: second, passengers: [P('Amal')] });
    expect(quote.body.data).toMatchObject({ cashAllowed: false, cashBlockedReason: 'OPEN_CASH_LIMIT' });
    const refused = await create({ holdIds: second, passengers: [P('Amal')], paymentMethod: 'CASH_ON_BOARD' }, 'cash-lim-0002');
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'CASH_NOT_ALLOWED', details: { reason: 'OPEN_CASH_LIMIT' } });

    await getPrisma().customer.update({ where: { id: customerId }, data: { cashNoShowCount: 2 } });
    const q2 = await request(app).post('/api/v1/customer/bookings/quote').set(auth(token)).send({ holdIds: second, passengers: [P('Amal')] });
    expect(q2.body.data.cashBlockedReason).toBe('NO_SHOW_LIMIT');
  });

  it('online payment: pending until paid (mock confirm), then tickets become valid', async () => {
    const res = await create({ holdIds: await hold(out, ['5']), passengers: [P('Ali')], paymentMethod: 'ONLINE' }, 'online-key-001');
    expect(res.status).toBe(201);
    const booking = res.body.data.bookings[0];
    expect(booking).toMatchObject({ status: 'PENDING_PAYMENT', paymentStatus: 'PENDING', actions: { canPay: true } });
    expect(booking.tickets[0].qrPayload).toBeNull();
    const payment = res.body.data.payment;
    expect(payment).toMatchObject({ status: 'PENDING', amountMinor: 3_500_000, nextAction: { type: 'MOCK_CONFIRM' } });

    const paid = await request(app).post(`/api/v1/customer/payments/${payment.intentId}/mock-confirm`).set(auth(token));
    expect(paid.status).toBe(200);
    expect(paid.body.data).toMatchObject({ status: 'SUCCEEDED', bookingStatuses: ['CONFIRMED'] });
    const after = await request(app).get(`/api/v1/customer/bookings/${booking.id}`).set(auth(token));
    expect(after.body.data).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' });
    expect(after.body.data.tickets[0].qrPayload).toBeTruthy();
    expect(after.body.data.tickets[0].cashToCollectMinor).toBe(0);
    expect((await request(app).post(`/api/v1/customer/payments/${payment.intentId}/mock-confirm`).set(auth(token))).body.code).toBe('PAYMENT_NOT_PENDING');
  });

  it('online payment confirmed by the signed provider webhook', async () => {
    const res = await create({ holdIds: await hold(out, ['6']), passengers: [P('Ali')], paymentMethod: 'ONLINE' }, 'online-key-wh1');
    const intentId = res.body.data.payment.intentId as string;
    const sign = (payload: string) => createHmac('sha256', env().PAYMENT_WEBHOOK_SECRET).update(payload).digest('hex');
    const hook = (amountMinor: number, eventId: string) => {
      const body = JSON.stringify({ eventId, intentId, amountMinor, currency: 'SDG', paymentReference: 'PSP-1', occurredAt: new Date().toISOString() });
      return request(app).post('/api/v1/payments/webhooks/mock').set('Content-Type', 'application/json').set('x-payment-signature', sign(body)).send(body);
    };
    expect((await hook(1, 'evt-c-bad')).body.code).toBe('PAYMENT_MISMATCH');
    const ok = await hook(3_500_000, 'evt-c-ok');
    expect(ok.status).toBe(200);
    expect(ok.body.data.customerPayment.status).toBe('SUCCEEDED');
    expect((await hook(3_500_000, 'evt-c-ok')).status).toBe(200); // replay is harmless
    const b = await request(app).get(`/api/v1/customer/bookings/${res.body.data.bookings[0].id}`).set(auth(token));
    expect(b.body.data.status).toBe('CONFIRMED');
  });

  it('unpaid online checkout expires: seats and coupon are released', async () => {
    await getPrisma().coupon.create({
      data: { code: 'NILE10', discountType: 'PERCENT', value: 1000, validFrom: new Date(Date.now() - DAY), validTo: new Date(Date.now() + 30 * DAY), maxRedemptions: 1 },
    });
    const res = await create({ holdIds: await hold(out, ['7']), passengers: [P('Ali')], couponCode: 'nile10', paymentMethod: 'ONLINE' }, 'online-key-exp');
    const booking = res.body.data.bookings[0];
    expect(booking.amounts).toEqual({ subtotalMinor: 3_500_000, discountMinor: 350_000, totalMinor: 3_150_000, currency: 'SDG' });
    expect((await getPrisma().coupon.findUnique({ where: { code: 'NILE10' } }))!.redeemedCount).toBe(1);

    await getPrisma().paymentIntent.update({ where: { id: res.body.data.payment.intentId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const after = await request(app).get(`/api/v1/customer/bookings/${booking.id}`).set(auth(token));
    expect(after.body.data).toMatchObject({ status: 'EXPIRED', payment: { status: 'EXPIRED', nextAction: null } });
    expect(after.body.data.tickets[0]).toMatchObject({ status: 'CANCELLED', qrPayload: null });
    const seats = await request(app).get(`/api/v1/customer/trips/${out}/seats`).set(auth(token));
    expect(seats.body.data.seats.find((s: { label: string }) => s.label === '7').state).toBe('AVAILABLE');
    expect((await getPrisma().coupon.findUnique({ where: { code: 'NILE10' } }))!.redeemedCount).toBe(0);
    expect((await request(app).get('/api/v1/customer/bookings?tab=CANCELLED').set(auth(token))).body.data).toHaveLength(1);
  });

  it('round trip: two legs, one checkout, discount split per leg', async () => {
    await getPrisma().coupon.create({
      data: { code: 'RT20', discountType: 'PERCENT', value: 2000, validFrom: new Date(Date.now() - DAY), validTo: new Date(Date.now() + 30 * DAY) },
    });
    const holdIds = [...(await hold(out, ['1', '2'])), ...(await hold(back, ['3', '4']))];
    const passengers = [P('Ali'), P('Sara', 'FEMALE')];
    const quote = await request(app).post('/api/v1/customer/bookings/quote').set(auth(token)).send({ holdIds, passengers, couponCode: 'RT20' });
    expect(quote.status).toBe(200);
    expect(quote.body.data).toMatchObject({ type: 'ROUND_TRIP', subtotalMinor: 13_000_000, discountMinor: 2_600_000, totalMinor: 10_400_000 });
    expect(quote.body.data.legs.map((l: { leg: string; discountMinor: number }) => [l.leg, l.discountMinor])).toEqual([
      ['OUTBOUND', 1_400_000],
      ['RETURN', 1_200_000],
    ]);
    expect(quote.body.data.legs[1].seats.map((s: { label: string; passengerName: string }) => `${s.label}:${s.passengerName}`)).toEqual(['3:Ali', '4:Sara']);

    const res = await create({ holdIds, passengers, couponCode: 'RT20', paymentMethod: 'ONLINE' }, 'round-trip-001');
    expect(res.status).toBe(201);
    expect(res.body.data.bookings.map((b: { leg: string }) => b.leg)).toEqual(['OUTBOUND', 'RETURN']);
    expect(res.body.data.groupId).toBeTruthy();
    expect(res.body.data.payment.amountMinor).toBe(10_400_000);
    expect(res.body.data.bookings[0].group.otherLeg.bookingId).toBe(res.body.data.bookings[1].id);
    await request(app).post(`/api/v1/customer/payments/${res.body.data.payment.intentId}/mock-confirm`).set(auth(token));
    const legs = await request(app).get('/api/v1/customer/bookings?tab=UPCOMING').set(auth(token));
    expect(legs.body.data.map((b: { status: string }) => b.status)).toEqual(['CONFIRMED', 'CONFIRMED']);
  });

  it('rejects an invalid round trip and holds of another customer', async () => {
    const out2 = await net.schedule({ departure: sudanAt(6, '07:00'), priceMinor: 3_500_000 });
    const sameWay = [...(await hold(out, ['1'])), ...(await hold(out2, ['1']))];
    const r = await request(app).post('/api/v1/customer/bookings/quote').set(auth(token)).send({ holdIds: sameWay, passengers: [P('Ali')] });
    expect(r.body.code).toBe('ROUND_TRIP_INVALID');

    const otherToken = (await loginCustomer(app, '+249912400003')).body.data.accessToken;
    const theirs = await hold(back, ['9'], otherToken);
    const stolen = await create({ holdIds: theirs, passengers: [P('Ali')], paymentMethod: 'CASH_ON_BOARD' }, 'steal-key-001');
    expect(stolen.status).toBe(409);
    expect(stolen.body.code).toBe('HOLD_REQUIRED');
    expect((await request(app).post('/api/v1/customer/bookings').set(auth(token)).send({ holdIds: sameWay, passengers: [P('Amal')], paymentMethod: 'ONLINE' })).status).toBe(422);
  });
});
