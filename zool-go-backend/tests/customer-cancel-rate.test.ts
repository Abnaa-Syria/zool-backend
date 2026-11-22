import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getPrisma } from '../src/infrastructure/database/prisma';
import { bootTestApp, shutdownTestApp, resetDatabase, seedCatalogAndSuperAdmin, loginWithOtp } from './helpers/app';
import { loginCustomer } from './helpers/mobile';
import { seedNetwork, sudanAt } from './helpers/network';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const P = (fullName: string) => ({ fullName, gender: 'MALE' as const });

describe('Customer cancellation, refunds, ratings and payment methods', () => {
  let app: Express;
  let adminToken: string;
  let token: string;
  let net: Awaited<ReturnType<typeof seedNetwork>>;
  let trip: string;

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
    trip = await net.schedule({ departure: sudanAt(2, '07:00'), priceMinor: 3_500_000 });
    token = (await loginCustomer(app, '+249912500001')).body.data.accessToken;
  });

  async function book(seats: string[], paymentMethod: 'ONLINE' | 'CASH_ON_BOARD', key: string, pay = true) {
    const h = await request(app).post(`/api/v1/customer/trips/${trip}/holds`).set(auth(token)).send({ seatLabels: seats });
    const res = await request(app)
      .post('/api/v1/customer/bookings')
      .set(auth(token))
      .set('Idempotency-Key', key)
      .send({ holdIds: h.body.data.holds.map((x: { id: string }) => x.id), passengers: seats.map((s) => P(`Pax ${s}`)), paymentMethod });
    expect(res.status).toBe(201);
    if (paymentMethod === 'ONLINE' && pay) {
      await request(app).post(`/api/v1/customer/payments/${res.body.data.payment.intentId}/mock-confirm`).set(auth(token));
    }
    return res.body.data.bookings[0].id as string;
  }

  it('cancels a paid online booking with the configured fee and refunds the rest', async () => {
    await request(app).patch('/api/v1/admin/settings').set(auth(adminToken)).send({ values: { 'refund.customerFeeBasisPoints': 1000 } });
    const id = await book(['1', '2'], 'ONLINE', 'cancel-paid-01');
    const quote = await request(app).get(`/api/v1/customer/bookings/${id}/cancellation-quote`).set(auth(token));
    expect(quote.body.data).toMatchObject({ cancellable: true, refundableMinor: 6_300_000, feeMinor: 700_000, method: 'ORIGINAL_PAYMENT_METHOD' });

    const res = await request(app).post(`/api/v1/customer/bookings/${id}/cancel`).set(auth(token)).send({ reason: 'Plans changed' });
    expect(res.status).toBe(200);
    expect(res.body.data.booking).toMatchObject({ status: 'CANCELLED', paymentStatus: 'PARTIALLY_REFUNDED', actions: { canCancel: false } });
    expect(res.body.data.refund).toMatchObject({ amountMinor: 6_300_000, status: 'SUCCEEDED', reason: 'CUSTOMER_CANCEL' });
    expect(res.body.data.booking.tickets.every((t: { status: string; qrPayload: string | null }) => t.status === 'CANCELLED' && t.qrPayload === null)).toBe(true);
    const seats = await request(app).get(`/api/v1/customer/trips/${trip}/seats`).set(auth(token));
    expect(seats.body.data.seats.find((s: { label: string }) => s.label === '1').state).toBe('AVAILABLE');
    expect((await request(app).post(`/api/v1/customer/bookings/${id}/cancel`).set(auth(token)).send({})).status).toBe(200); // replay-safe
  });

  it('cancels an unpaid cash booking without refund and an unpaid online checkout by voiding it', async () => {
    const cash = await book(['3'], 'CASH_ON_BOARD', 'cancel-cash-01');
    const q = await request(app).get(`/api/v1/customer/bookings/${cash}/cancellation-quote`).set(auth(token));
    expect(q.body.data).toMatchObject({ refundableMinor: 0, method: 'NONE_CASH_UNPAID' });
    const c = await request(app).post(`/api/v1/customer/bookings/${cash}/cancel`).set(auth(token)).send({});
    expect(c.body.data).toMatchObject({ booking: { status: 'CANCELLED', paymentStatus: 'UNPAID_CASH' }, refund: null });

    const pending = await book(['4'], 'ONLINE', 'cancel-unpaid-01', false);
    const v = await request(app).post(`/api/v1/customer/bookings/${pending}/cancel`).set(auth(token)).send({});
    expect(v.body.data.booking).toMatchObject({ status: 'CANCELLED', payment: { status: 'CANCELLED' } });
  });

  it('closes customer cancellation at the cutoff', async () => {
    const id = await book(['5'], 'CASH_ON_BOARD', 'cancel-cutoff-01');
    await request(app).patch('/api/v1/admin/settings').set(auth(adminToken)).send({ values: { 'refund.customerCutoffMinutesBeforeDeparture': 10080 } });
    const q = await request(app).get(`/api/v1/customer/bookings/${id}/cancellation-quote`).set(auth(token));
    expect(q.body.data.cancellable).toBe(false);
    const res = await request(app).post(`/api/v1/customer/bookings/${id}/cancel`).set(auth(token)).send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('BOOKING_NOT_CANCELLABLE');
    // The admin can still cancel (no fee).
    const admin = await request(app).post(`/api/v1/admin/bookings/${id}/cancel`).set(auth(adminToken)).send({ reason: 'Support request' });
    expect(admin.status).toBe(200);
    expect(admin.body.data.booking.status).toBe('CANCELLED');
  });

  it('trip cancelled by the admin refunds customer bookings in full (D-SUS-01)', async () => {
    await request(app).patch('/api/v1/admin/settings').set(auth(adminToken)).send({ values: { 'refund.customerFeeBasisPoints': 2000 } });
    const paid = await book(['6'], 'ONLINE', 'trip-cancel-01');
    const cash = await book(['7'], 'CASH_ON_BOARD', 'trip-cancel-02');
    const unpaid = await book(['8'], 'ONLINE', 'trip-cancel-03', false);
    const res = await request(app).post(`/api/v1/admin/trips/${trip}/cancel`).set(auth(adminToken)).send({ reason: 'Bus breakdown' });
    expect(res.status).toBe(200);
    expect(res.body.data.failed).toEqual([]);
    expect(res.body.data.refundedAmountMinor).toBe(3_500_000);

    const b = await request(app).get(`/api/v1/customer/bookings/${paid}`).set(auth(token));
    expect(b.body.data).toMatchObject({ status: 'CANCELLED', paymentStatus: 'REFUNDED', tripCancelled: true });
    expect(b.body.data.refunds[0]).toMatchObject({ amountMinor: 3_500_000, reason: 'CARRIER_CANCEL', status: 'SUCCEEDED' });
    expect((await request(app).get(`/api/v1/customer/bookings/${cash}`).set(auth(token))).body.data.status).toBe('CANCELLED');
    expect((await request(app).get(`/api/v1/customer/bookings/${unpaid}`).set(auth(token))).body.data.status).toBe('CANCELLED');
    const types = (await getPrisma().notification.findMany({ where: { type: 'TRIP_CANCELLED' } })).length;
    expect(types).toBe(2);
  });

  it('rates a completed trip once and updates the carrier rating', async () => {
    const id = await book(['9'], 'CASH_ON_BOARD', 'rate-key-01');
    expect((await request(app).post(`/api/v1/customer/bookings/${id}/rating`).set(auth(token)).send({ stars: 5 })).body.code).toBe('RATING_NOT_ALLOWED');
    await getPrisma().trip.update({ where: { id: trip }, data: { status: 'COMPLETED', completedAt: new Date() } });
    const r = await request(app).post(`/api/v1/customer/bookings/${id}/rating`).set(auth(token)).send({ stars: 3, comment: 'OK trip' });
    expect(r.status).toBe(201);
    const company = await getPrisma().transportCompany.findUnique({ where: { id: net.companyId } });
    expect(company).toMatchObject({ ratingAvgX100: 300, ratingCount: 1 });
    expect((await request(app).post(`/api/v1/customer/bookings/${id}/rating`).set(auth(token)).send({ stars: 4 })).status).toBe(409);
    expect((await request(app).get('/api/v1/customer/bookings?tab=PAST').set(auth(token))).body.data[0].rating).toMatchObject({ stars: 3 });
    expect((await request(app).post(`/api/v1/customer/bookings/${id}/rating`).set(auth(token)).send({ stars: 6 })).status).toBe(422);
  });

  it('lists payment methods with cash eligibility', async () => {
    const m = await request(app).get('/api/v1/customer/payments/methods').set(auth(token));
    expect(m.body.data.methods.map((x: { type: string; available: boolean }) => `${x.type}:${x.available}`)).toEqual(['ONLINE:true', 'CASH_ON_BOARD:true']);
    await request(app).patch('/api/v1/admin/settings').set(auth(adminToken)).send({ values: { 'cash.enabled': false } });
    const off = await request(app).get('/api/v1/customer/payments/methods').set(auth(token));
    expect(off.body.data.methods[1]).toMatchObject({ available: false, unavailableReason: 'CASH_DISABLED' });
  });
});
