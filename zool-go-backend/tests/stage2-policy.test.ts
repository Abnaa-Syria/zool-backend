import { createHmac } from 'node:crypto';
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
import { env } from '../src/config/env';
import { getPrisma } from '../src/infrastructure/database/prisma';

const MANAGER_PHONE = '+249900000301';
const CLERK_PHONE = '+249900000302';
const BASE_PRICE = 15000;
const RECEIPT_PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

describe('Stage 2.6 policy locks', () => {
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
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function topUp(amountMinor: number, key: string) {
    const created = await request(app)
      .post('/api/v1/broker/wallet/top-ups')
      .set(auth(managerToken))
      .send({ amountMinor, idempotencyKey: key });
    expect(created.status).toBe(201);
    const confirmed = await request(app)
      .post(`/api/v1/broker/wallet/top-ups/${created.body.data.id}/mock-confirm`)
      .set(auth(managerToken));
    expect(confirmed.status).toBe(200);
    return created.body.data.id as string;
  }

  beforeEach(async () => {
    await resetDatabase();
    await seedCatalogAndSuperAdmin();
    const admin = await loginWithOtp(app, '+249900000001');
    adminToken = admin.accessToken;

    const carrier = await request(app)
      .post('/api/v1/carriers')
      .set(auth(adminToken))
      .send({ key: 'policy_carrier', name: 'Policy Carrier' });
    companyId = carrier.body.data.id;

    const office = await request(app)
      .post('/api/v1/brokers')
      .set(auth(adminToken))
      .send({
        code: 'ZG-POL-1',
        name: 'Policy Office',
        timeZone: 'Africa/Khartoum',
        manager: { displayName: 'Mgr', phone: MANAGER_PHONE },
      });
    expect(office.status).toBe(201);
    officeId = office.body.data.id;

    await request(app)
      .put(`/api/v1/brokers/${officeId}/carriers`)
      .set(auth(adminToken))
      .send([{ companyId, commissionPercent: 10 }]);

    const trip = await request(app)
      .post('/api/v1/catalog/trips')
      .set(auth(adminToken))
      .send({
        companyId,
        origin: 'Khartoum',
        destination: 'Atbara',
        departureAt: tomorrow(),
        basePrice: BASE_PRICE,
        seatLabels: ['A1', 'A2', 'A3'],
      });
    tripId = trip.body.data.id;

    managerToken = (await loginBrokerWithOtp(app, MANAGER_PHONE)).accessToken;
    await request(app)
      .post('/api/v1/broker/staff')
      .set(auth(managerToken))
      .send({ displayName: 'Clerk', phone: CLERK_PHONE, canBook: true });
    clerkToken = (await loginBrokerWithOtp(app, CLERK_PHONE)).accessToken;
  });

  it('uses office timezone for the exposure day and SDG *Minor money fields', async () => {
    await request(app)
      .patch(`/api/v1/brokers/${officeId}`)
      .set(auth(adminToken))
      .send({ timeZone: 'America/Los_Angeles', exposureCeilingOverride: 1 });

    await topUp(200000, 'pol-topup-tz');

    const seats = await request(app).get(`/api/v1/broker/trips/${tripId}`).set(auth(clerkToken));
    const first = seats.body.data.seats[0] as { id: string };
    expect(
      (
        await request(app)
          .post(`/api/v1/broker/trips/${tripId}/holds`)
          .set(auth(clerkToken))
          .send({ mode: 'MANUAL', seatIds: [first.id] })
      ).status,
    ).toBe(201);

    const booked = await request(app)
      .post('/api/v1/broker/bookings/confirm')
      .set(auth(clerkToken))
      .send({
        tripId,
        seatIds: [first.id],
        passengers: [{ fullName: 'One', phone: '0913000001' }],
        idempotencyKey: 'pol-tz-1',
      });
    expect(booked.status).toBe(201);
    expect(booked.body.data.booking.totalAmountMinor).toBe(BASE_PRICE);
    expect(booked.body.data.balanceAfterMinor).toBeDefined();

    const utcStartToday = new Date();
    utcStartToday.setUTCHours(0, 0, 0, 0);
    await getPrisma().booking.update({
      where: { id: booked.body.data.booking.id },
      data: { confirmedAt: utcStartToday },
    });

    const remaining = await request(app).get(`/api/v1/broker/trips/${tripId}`).set(auth(clerkToken));
    const second = (remaining.body.data.seats as Array<{ id: string; status: string }>).find(
      (s) => s.status === 'FREE',
    )!;
    expect(
      (
        await request(app)
          .post(`/api/v1/broker/trips/${tripId}/holds`)
          .set(auth(clerkToken))
          .send({ seatIds: [second.id] })
      ).status,
    ).toBe(201);

    const secondBook = await request(app)
      .post('/api/v1/broker/bookings/confirm')
      .set(auth(clerkToken))
      .send({
        tripId,
        seatIds: [second.id],
        passengers: [{ fullName: 'Two', phone: '0913000002' }],
        idempotencyKey: 'pol-tz-2',
      });
    expect(secondBook.status).toBe(201);

    const wallet = await request(app).get('/api/v1/broker/wallet').set(auth(managerToken));
    expect(wallet.body.data.currency).toBe('SDG');
    expect(wallet.body.data.balanceMinor).toBe(200000 - BASE_PRICE * 2);
    expect(wallet.body.data.lowBalanceThresholdMinor).toBeDefined();
  });

  it('rejects WhatsApp/SMS dispatch', async () => {
    await topUp(50000, 'pol-dispatch');
    const seats = await request(app).get(`/api/v1/broker/trips/${tripId}`).set(auth(clerkToken));
    const seatId = seats.body.data.seats[0].id as string;
    const hold = await request(app)
      .post(`/api/v1/broker/trips/${tripId}/holds`)
      .set(auth(clerkToken))
      .send({ seatIds: [seatId] });
    expect(hold.status).toBe(201);
    const confirm = await request(app)
      .post('/api/v1/broker/bookings/confirm')
      .set(auth(clerkToken))
      .send({
        tripId,
        seatIds: [seatId],
        passengers: [{ fullName: 'Dispatch User', phone: '0913000003' }],
        idempotencyKey: 'pol-disp-1',
      });
    expect(confirm.status).toBe(201);
    const sms = await request(app)
      .post(`/api/v1/broker/bookings/${confirm.body.data.booking.id}/dispatch`)
      .set(auth(clerkToken))
      .send({ channel: 'sms' });
    expect(sms.status).toBe(422);
    expect(sms.body.code).toBe('TICKET_CHANNEL_DISABLED');
  });

  it('AUTO last-seat race: exactly one hold wins', async () => {
    const oneSeat = await request(app)
      .post('/api/v1/catalog/trips')
      .set(auth(adminToken))
      .send({
        companyId,
        origin: 'Khartoum',
        destination: 'Dongola',
        departureAt: tomorrow(),
        basePrice: BASE_PRICE,
        seatLabels: ['Z1'],
      });
    const id = oneSeat.body.data.id as string;

    const [a, b] = await Promise.all([
      request(app)
        .post(`/api/v1/broker/trips/${id}/holds`)
        .set(auth(clerkToken))
        .send({ mode: 'AUTO', seatCount: 1 }),
      request(app)
        .post(`/api/v1/broker/trips/${id}/holds`)
        .set(auth(managerToken))
        .send({ mode: 'AUTO', seatCount: 1 }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    expect([a.body.code, b.body.code].filter(Boolean)).toContain('SEAT_UNAVAILABLE');
    expect(await getPrisma().seatHold.count({ where: { tripSeat: { tripId: id } } })).toBe(1);
    const seats = await getPrisma().tripSeat.findMany({ where: { tripId: id } });
    expect(seats.filter((s) => s.status === 'HELD')).toHaveLength(1);
    expect(seats.filter((s) => s.status === 'FREE')).toHaveLength(0);
  });

  it('admin cancel requires reason, is idempotent, and does not mutate passenger/seat/fare rows', async () => {
    await topUp(80000, 'pol-admin-cancel');
    const seats = await request(app).get(`/api/v1/broker/trips/${tripId}`).set(auth(clerkToken));
    const seatId = seats.body.data.seats[0].id as string;
    await request(app)
      .post(`/api/v1/broker/trips/${tripId}/holds`)
      .set(auth(clerkToken))
      .send({ seatIds: [seatId] });
    const confirm = await request(app)
      .post('/api/v1/broker/bookings/confirm')
      .set(auth(clerkToken))
      .send({
        tripId,
        seatIds: [seatId],
        passengers: [{ fullName: 'Keep Me', phone: '0913000004', idNumber: 'ID-1' }],
        idempotencyKey: 'pol-cancel-1',
      });
    const bookingId = confirm.body.data.booking.id as string;
    const before = await getPrisma().bookingPassenger.findMany({ where: { bookingId } });

    const missing = await request(app)
      .post(`/api/v1/admin/bookings/${bookingId}/cancel`)
      .set(auth(adminToken))
      .send({});
    expect(missing.status).toBe(422);

    const cancel = await request(app)
      .post(`/api/v1/admin/bookings/${bookingId}/cancel`)
      .set(auth(adminToken))
      .send({ reason: 'Customer no-show' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.booking.status).toBe('CANCELLED');
    expect(cancel.body.data.refundedAmountMinor).toBe(BASE_PRICE);

    const replay = await request(app)
      .post(`/api/v1/admin/bookings/${bookingId}/cancel`)
      .set(auth(adminToken))
      .send({ reason: 'Customer no-show' });
    expect(replay.status).toBe(200);
    expect(replay.body.data.replayed).toBe(true);

    const after = await getPrisma().bookingPassenger.findMany({ where: { bookingId } });
    expect(after.map((p) => ({ fullName: p.fullName, phone: p.phone, idNumber: p.idNumber }))).toEqual(
      before.map((p) => ({ fullName: p.fullName, phone: p.phone, idNumber: p.idNumber })),
    );
    expect(await getPrisma().walletLedgerEntry.count({ where: { idempotencyKey: `refund:${bookingId}` } })).toBe(
      1,
    );

    const listed = await request(app)
      .get(`/api/v1/admin/bookings?officeId=${officeId}&companyId=${companyId}`)
      .set(auth(adminToken));
    expect(listed.status).toBe(200);
    expect(listed.body.data.some((b: { id: string }) => b.id === bookingId)).toBe(true);
  });

  it('broker evidence goes to pending review; broker cannot approve; admin approve has no amount and is idempotent', async () => {
    const created = await request(app)
      .post('/api/v1/broker/wallet/top-ups')
      .set(auth(managerToken))
      .send({ amountMinor: 40000, idempotencyKey: 'pol-ev-1' });
    expect(created.status).toBe(201);
    const intentId = created.body.data.id as string;
    await getPrisma().topUpIntent.update({ where: { id: intentId }, data: { status: 'FAILED' } });

    const evidence = await request(app)
      .post(`/api/v1/broker/wallet/top-ups/${intentId}/evidence`)
      .set(auth(managerToken))
      .field('paymentReference', 'BK-ABC-001')
      .attach('receipt', RECEIPT_PDF, { filename: 'receipt.pdf', contentType: 'application/pdf' });
    expect(evidence.status).toBe(200);
    expect(evidence.body.data.status).toBe('PENDING_REVIEW');
    expect(evidence.body.data.confirmationPath).toBe('MANUAL_FALLBACK');

    const brokerApprove = await request(app)
      .post(`/api/v1/admin/wallets/top-ups/${intentId}/approve`)
      .set(auth(managerToken))
      .send({});
    expect(brokerApprove.status).toBe(401);

    const withAmount = await request(app)
      .post(`/api/v1/admin/wallets/top-ups/${intentId}/approve`)
      .set(auth(adminToken))
      .send({ amountMinor: 999 });
    expect(withAmount.status).toBe(422);

    const approve = await request(app)
      .post(`/api/v1/admin/wallets/top-ups/${intentId}/approve`)
      .set(auth(adminToken))
      .send({});
    expect(approve.status).toBe(200);
    expect(approve.body.data.intent.status).toBe('CONFIRMED');
    expect(approve.body.data.balanceMinor).toBe(40000);

    const again = await request(app)
      .post(`/api/v1/admin/wallets/top-ups/${intentId}/approve`)
      .set(auth(adminToken))
      .send({});
    expect(again.status).toBe(200);
    expect(again.body.data.replayed).toBe(true);
    expect(again.body.data.balanceMinor).toBe(40000);

    const second = await request(app)
      .post('/api/v1/broker/wallet/top-ups')
      .set(auth(managerToken))
      .send({ amountMinor: 40000, idempotencyKey: 'pol-ev-2' });
    await getPrisma().topUpIntent.update({ where: { id: second.body.data.id }, data: { status: 'FAILED' } });
    const dup = await request(app)
      .post(`/api/v1/broker/wallet/top-ups/${second.body.data.id}/evidence`)
      .set(auth(managerToken))
      .field('paymentReference', 'bk-abc-001')
      .attach('receipt', RECEIPT_PDF, { filename: 'receipt.pdf', contentType: 'application/pdf' });
    expect(dup.status).toBe(409);
  });

  it('webhook rejects bad signatures, amount mismatch, and event-id replay', async () => {
    const created = await request(app)
      .post('/api/v1/broker/wallet/top-ups')
      .set(auth(managerToken))
      .send({ amountMinor: 30000, idempotencyKey: 'pol-wh-1' });
    const intentId = created.body.data.id as string;
    const secret = env().PAYMENT_WEBHOOK_SECRET;

    const sign = (payload: string) => createHmac('sha256', secret).update(payload).digest('hex');

    const bad = JSON.stringify({
      eventId: 'evt-1',
      intentId,
      amountMinor: 30000,
      currency: 'SDG',
      occurredAt: new Date().toISOString(),
    });
    const unsigned = await request(app)
      .post('/api/v1/payments/webhooks/mock')
      .set('Content-Type', 'application/json')
      .set('x-payment-signature', 'deadbeef')
      .send(bad);
    expect(unsigned.status).toBe(401);
    expect(unsigned.body.code).toBe('WEBHOOK_SIGNATURE_INVALID');

    const mismatchBody = JSON.stringify({
      eventId: 'evt-mismatch',
      intentId,
      amountMinor: 1,
      currency: 'SDG',
      occurredAt: new Date().toISOString(),
    });
    const mismatch = await request(app)
      .post('/api/v1/payments/webhooks/mock')
      .set('Content-Type', 'application/json')
      .set('x-payment-signature', sign(mismatchBody))
      .send(mismatchBody);
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.code).toBe('PAYMENT_MISMATCH');
    const wallet = await request(app).get('/api/v1/broker/wallet').set(auth(managerToken));
    expect(wallet.body.data.balanceMinor).toBe(0);

    const created2 = await request(app)
      .post('/api/v1/broker/wallet/top-ups')
      .set(auth(managerToken))
      .send({ amountMinor: 30000, idempotencyKey: 'pol-wh-2' });
    const intent2 = created2.body.data.id as string;
    const okBody = JSON.stringify({
      eventId: 'evt-ok',
      intentId: intent2,
      amountMinor: 30000,
      currency: 'SDG',
      occurredAt: new Date().toISOString(),
    });
    const ok = await request(app)
      .post('/api/v1/payments/webhooks/mock')
      .set('Content-Type', 'application/json')
      .set('x-payment-signature', sign(okBody))
      .send(okBody);
    expect(ok.status).toBe(200);
    expect(ok.body.data.intent.status).toBe('CONFIRMED');

    const replay = await request(app)
      .post('/api/v1/payments/webhooks/mock')
      .set('Content-Type', 'application/json')
      .set('x-payment-signature', sign(okBody))
      .send(okBody);
    expect(replay.status).toBe(200);
    expect(replay.body.data.replayed).toBe(true);
    const after = await request(app).get('/api/v1/broker/wallet').set(auth(managerToken));
    expect(after.body.data.balanceMinor).toBe(30000);
  });

  it('settlement draft reserves, cancel releases, overlapping draft 409, finalize twice is idempotent', async () => {
    await topUp(80000, 'pol-set-top');
    const seats = await request(app).get(`/api/v1/broker/trips/${tripId}`).set(auth(clerkToken));
    const seatId = seats.body.data.seats[0].id as string;
    await request(app)
      .post(`/api/v1/broker/trips/${tripId}/holds`)
      .set(auth(clerkToken))
      .send({ seatIds: [seatId] });
    expect(
      (
        await request(app)
          .post('/api/v1/broker/bookings/confirm')
          .set(auth(clerkToken))
          .send({
            tripId,
            seatIds: [seatId],
            passengers: [{ fullName: 'Settle User', phone: '0913000005' }],
            idempotencyKey: 'pol-set-book',
          })
      ).status,
    ).toBe(201);

    const period = {
      officeId,
      periodFrom: new Date(Date.now() - 86_400_000).toISOString(),
      periodTo: new Date(Date.now() + 86_400_000).toISOString(),
    };
    const draft = await request(app)
      .post('/api/v1/admin/commissions/settlements')
      .set(auth(adminToken))
      .send(period);
    expect(draft.status).toBe(201);
    expect((await getPrisma().commissionAccrual.findMany())[0]?.status).toBe('RESERVED');

    const overlap = await request(app)
      .post('/api/v1/admin/commissions/settlements')
      .set(auth(adminToken))
      .send(period);
    expect(overlap.status).toBe(409);

    const cancelled = await request(app)
      .post(`/api/v1/admin/commissions/settlements/${draft.body.data.id}/cancel`)
      .set(auth(adminToken));
    expect(cancelled.status).toBe(200);
    expect((await getPrisma().commissionAccrual.findMany())[0]?.status).toBe('UNSETTLED');

    const draft2 = await request(app)
      .post('/api/v1/admin/commissions/settlements')
      .set(auth(adminToken))
      .send(period);
    expect(draft2.status).toBe(201);
    const fin1 = await request(app)
      .post(`/api/v1/admin/commissions/settlements/${draft2.body.data.id}/finalize`)
      .set(auth(adminToken))
      .send({ payoutReference: 'PAY-1' });
    const fin2 = await request(app)
      .post(`/api/v1/admin/commissions/settlements/${draft2.body.data.id}/finalize`)
      .set(auth(adminToken))
      .send({ payoutReference: 'PAY-1' });
    expect(fin1.status).toBe(200);
    expect(fin2.status).toBe(200);
    expect(fin2.body.data.status).toBe('FINALIZED');
    expect((await getPrisma().commissionAccrual.findMany())[0]?.status).toBe('SETTLED');
  });
});
