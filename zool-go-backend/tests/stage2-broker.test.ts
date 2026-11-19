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

const MANAGER_PHONE = '+249900000101';
const CLERK_PHONE = '+249900000102';
const BASE_PRICE = 25001; // odd on purpose: exercises floor(total * percent / 100)

interface Fixture {
  adminToken: string;
  officeId: string;
  companyId: string;
  otherCompanyId: string;
  tripId: string;
  otherTripId: string;
  managerToken: string;
  clerkToken: string;
}

describe('Stage 2 broker vertical', () => {
  let app: Express;
  let fx: Fixture;

  beforeAll(async () => {
    app = await bootTestApp();
  });

  afterAll(async () => {
    await shutdownTestApp();
  });

  const tomorrow = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function setupFixture(): Promise<Fixture> {
    const admin = await loginWithOtp(app, '+249900000001');
    const adminToken = admin.accessToken;

    const carrier = await request(app)
      .post('/api/v1/carriers')
      .set(auth(adminToken))
      .send({ key: 'sudan_express', name: 'Sudan Express' });
    expect(carrier.status).toBe(201);
    const other = await request(app)
      .post('/api/v1/carriers')
      .set(auth(adminToken))
      .send({ key: 'other_carrier', name: 'Other Carrier' });
    expect(other.status).toBe(201);

    const office = await request(app)
      .post('/api/v1/brokers')
      .set(auth(adminToken))
      .send({
        code: 'ZG-BRK-1',
        name: 'Demo Office',
        settlementPeriod: 'MONTHLY',
        manager: { displayName: 'Manager', phone: MANAGER_PHONE },
      });
    expect(office.status).toBe(201);
    expect(office.body.data.wallet.balanceMinor).toBe(0);
    const officeId = office.body.data.id as string;

    const assign = await request(app)
      .put(`/api/v1/brokers/${officeId}/carriers`)
      .set(auth(adminToken))
      .send([{ companyId: carrier.body.data.id, commissionPercent: 10 }]);
    expect(assign.status).toBe(200);

    const tripBody = (companyId: string) => ({
      companyId,
      origin: 'Khartoum',
      destination: 'Port Sudan',
      departureAt: tomorrow(),
      basePrice: BASE_PRICE,
      seatLabels: ['A1', 'A2', 'A3', 'A4', 'A5'],
    });
    const trip = await request(app)
      .post('/api/v1/catalog/trips')
      .set(auth(adminToken))
      .send(tripBody(carrier.body.data.id));
    expect(trip.status).toBe(201);
    const otherTrip = await request(app)
      .post('/api/v1/catalog/trips')
      .set(auth(adminToken))
      .send(tripBody(other.body.data.id));
    expect(otherTrip.status).toBe(201);

    const manager = await loginBrokerWithOtp(app, MANAGER_PHONE);

    const clerkCreate = await request(app)
      .post('/api/v1/broker/staff')
      .set(auth(manager.accessToken))
      .send({ displayName: 'Clerk', phone: CLERK_PHONE, canBook: true });
    expect(clerkCreate.status).toBe(201);
    const clerk = await loginBrokerWithOtp(app, CLERK_PHONE);

    return {
      adminToken,
      officeId,
      companyId: carrier.body.data.id,
      otherCompanyId: other.body.data.id,
      tripId: trip.body.data.id,
      otherTripId: otherTrip.body.data.id,
      managerToken: manager.accessToken,
      clerkToken: clerk.accessToken,
    };
  }

  async function topUp(token: string, amount: number, key: string) {
    const created = await request(app)
      .post('/api/v1/broker/wallet/top-ups')
      .set(auth(token))
      .send({ amountMinor: amount, idempotencyKey: key });
    expect(created.status).toBe(201);
    const confirmed = await request(app)
      .post(`/api/v1/broker/wallet/top-ups/${created.body.data.id}/mock-confirm`)
      .set(auth(token))
      .send();
    expect(confirmed.status).toBe(200);
    return confirmed.body.data as { balanceMinor: number };
  }

  async function seatsOf(token: string, tripId: string) {
    const res = await request(app).get(`/api/v1/broker/trips/${tripId}`).set(auth(token));
    expect(res.status).toBe(200);
    return res.body.data.seats as Array<{ id: string; label: string; status: string }>;
  }

  async function hold(token: string, tripId: string, seatIds: string[]) {
    return request(app)
      .post(`/api/v1/broker/trips/${tripId}/holds`)
      .set(auth(token))
      .send({ seatIds });
  }

  const passengers = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ fullName: `Passenger ${i + 1}`, phone: '0911111111' }));

  async function bookSeats(token: string, count: number, key: string) {
    const seats = await seatsOf(token, fx.tripId);
    const free = seats.filter((s) => s.status === 'FREE').slice(0, count);
    const seatIds = free.map((s) => s.id);
    const held = await hold(token, fx.tripId, seatIds);
    expect(held.status).toBe(201);
    const confirm = await request(app)
      .post('/api/v1/broker/bookings/confirm')
      .set(auth(token))
      .send({ tripId: fx.tripId, seatIds, passengers: passengers(count), idempotencyKey: key });
    return { confirm, seatIds };
  }

  beforeEach(async () => {
    await resetDatabase();
    await seedCatalogAndSuperAdmin('+249900000001');
    fx = await setupFixture();
  });

  it('broker login: OTP flow, separate cookie, /me, refresh, logout, principal isolation', async () => {
    await new Promise((r) => setTimeout(r, 1100)); // OTP resend cooldown
    const manager = await loginBrokerWithOtp(app, MANAGER_PHONE);
    expect(manager.employee.role).toBe('MANAGER');
    expect(manager.employee.permissions).toEqual(
      expect.arrayContaining(['broker.book', 'broker.wallet.topup', 'broker.reports.view', 'broker.staff.manage']),
    );
    const cookie = manager.cookies.find((c) => c.startsWith('zoolgo_broker_refresh='));
    expect(cookie).toBeTruthy();
    expect(cookie).toContain('Path=/api/v1/broker/auth');
    expect(manager.cookies.some((c) => c.startsWith('zoolgo_refresh='))).toBe(false);

    const me = await request(app).get('/api/v1/broker/auth/me').set(auth(manager.accessToken));
    expect(me.status).toBe(200);
    expect(me.body.data.office.code).toBe('ZG-BRK-1');

    // admin token must not authenticate broker routes and vice versa
    const adminOnBroker = await request(app)
      .get('/api/v1/broker/auth/me')
      .set(auth(fx.adminToken));
    expect(adminOnBroker.status).toBe(401);
    const brokerOnAdmin = await request(app).get('/api/v1/auth/me').set(auth(manager.accessToken));
    expect(brokerOnAdmin.status).toBe(401);
    const brokerOnAdminRoute = await request(app)
      .get('/api/v1/brokers')
      .set(auth(manager.accessToken));
    expect(brokerOnAdminRoute.status).toBe(401);

    const refreshed = await request(app)
      .post('/api/v1/broker/auth/refresh')
      .set('Cookie', cookie!.split(';')[0]!);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.accessToken).toBeTruthy();

    const reuse = await request(app)
      .post('/api/v1/broker/auth/refresh')
      .set('Cookie', cookie!.split(';')[0]!);
    expect(reuse.status).toBe(401);

    const unknown = await request(app)
      .post('/api/v1/broker/auth/otp/request')
      .send({ phone: '+249977777777' });
    expect(unknown.status).toBe(401);
  });

  it('broker logout invalidates the refresh session', async () => {
    await new Promise((r) => setTimeout(r, 1100)); // OTP resend cooldown
    const manager = await loginBrokerWithOtp(app, MANAGER_PHONE);
    const cookie = manager.cookies.find((c) => c.startsWith('zoolgo_broker_refresh='))!.split(';')[0]!;
    const out = await request(app).post('/api/v1/broker/auth/logout').set('Cookie', cookie);
    expect(out.status).toBe(200);
    const refresh = await request(app).post('/api/v1/broker/auth/refresh').set('Cookie', cookie);
    expect(refresh.status).toBe(401);
  });

  it('top-up: enforces minimum, mock-confirm credits wallet once, ledger + idempotency', async () => {
    const low = await request(app)
      .post('/api/v1/broker/wallet/top-ups')
      .set(auth(fx.managerToken))
      .send({ amountMinor: 500, idempotencyKey: 'topup-low-1' });
    expect(low.status).toBe(422);
    expect(low.body.code).toBe('TOP_UP_BELOW_MINIMUM');

    const created = await request(app)
      .post('/api/v1/broker/wallet/top-ups')
      .set(auth(fx.managerToken))
      .send({ amountMinor: 200000, idempotencyKey: 'topup-ok-1' });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('PENDING');

    const replayCreate = await request(app)
      .post('/api/v1/broker/wallet/top-ups')
      .set(auth(fx.managerToken))
      .send({ amountMinor: 200000, idempotencyKey: 'topup-ok-1' });
    expect(replayCreate.status).toBe(200);
    expect(replayCreate.body.data.id).toBe(created.body.data.id);

    const confirm = await request(app)
      .post(`/api/v1/broker/wallet/top-ups/${created.body.data.id}/mock-confirm`)
      .set(auth(fx.managerToken))
      .send();
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.balanceMinor).toBe(200000);

    const again = await request(app)
      .post(`/api/v1/broker/wallet/top-ups/${created.body.data.id}/mock-confirm`)
      .set(auth(fx.managerToken))
      .send();
    expect(again.status).toBe(200);

    const wallet = await request(app).get('/api/v1/broker/wallet').set(auth(fx.managerToken));
    expect(wallet.body.data.balanceMinor).toBe(200000);

    const ledger = await request(app)
      .get('/api/v1/broker/wallet/ledger?page=1&pageSize=10')
      .set(auth(fx.managerToken));
    expect(ledger.status).toBe(200);
    expect(ledger.body.data).toHaveLength(1);
    expect(ledger.body.data[0]).toMatchObject({
      type: 'CREDIT_TOPUP',
      direction: 'CREDIT',
      amountMinor: 200000,
      balanceAfterMinor: 200000,
    });

    const adminView = await request(app)
      .get(`/api/v1/admin/wallets/${fx.officeId}`)
      .set(auth(fx.adminToken));
    expect(adminView.status).toBe(200);
    expect(adminView.body.data.wallet.balanceMinor).toBe(200000);
  });

  it('mock-confirm is disabled in production mode', async () => {
    const created = await request(app)
      .post('/api/v1/broker/wallet/top-ups')
      .set(auth(fx.managerToken))
      .send({ amountMinor: 20000, idempotencyKey: 'topup-prod-1' });
    expect(created.status).toBe(201);

    const previous = process.env.NODE_ENV;
    const { resetEnvCache, loadEnv } = await import('../src/config/env');
    process.env.NODE_ENV = 'production';
    process.env.OTP_DEV_EXPOSE = 'false';
    resetEnvCache();
    loadEnv(process.env);
    try {
      const res = await request(app)
        .post(`/api/v1/broker/wallet/top-ups/${created.body.data.id}/mock-confirm`)
        .set(auth(fx.managerToken))
        .send();
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('MOCK_PAYMENT_DISABLED');
    } finally {
      process.env.NODE_ENV = previous;
      process.env.OTP_DEV_EXPOSE = 'true';
      resetEnvCache();
      loadEnv(process.env);
    }
  });

  it('clerk without topup permission cannot top-up or manage staff or view commissions', async () => {
    const topup = await request(app)
      .post('/api/v1/broker/wallet/top-ups')
      .set(auth(fx.clerkToken))
      .send({ amountMinor: 50000, idempotencyKey: 'clerk-topup-1' });
    expect(topup.status).toBe(403);
    expect(topup.body.code).toBe('PERMISSION_DENIED');

    const staff = await request(app).get('/api/v1/broker/staff').set(auth(fx.clerkToken));
    expect(staff.status).toBe(403);

    const commissions = await request(app)
      .get('/api/v1/broker/commissions')
      .set(auth(fx.clerkToken));
    expect(commissions.status).toBe(403);

    const managerCommissions = await request(app)
      .get('/api/v1/broker/commissions')
      .set(auth(fx.managerToken));
    expect(managerCommissions.status).toBe(200);
  });

  it('staff management: manager updates clerk permissions and stale token is rejected', async () => {
    const staff = await request(app).get('/api/v1/broker/staff').set(auth(fx.managerToken));
    expect(staff.status).toBe(200);
    expect(staff.body.data).toHaveLength(2);
    const clerk = staff.body.data.find((s: { role: string }) => s.role === 'CLERK');

    const patch = await request(app)
      .patch(`/api/v1/broker/staff/${clerk.id}`)
      .set(auth(fx.managerToken))
      .send({ canTopUp: true });
    expect(patch.status).toBe(200);
    expect(patch.body.data.flags.canTopUp).toBe(true);

    const stale = await request(app).get('/api/v1/broker/wallet').set(auth(fx.clerkToken));
    expect(stale.status).toBe(401);

    const selfSuspend = await request(app)
      .patch(`/api/v1/broker/staff/${staff.body.data.find((s: { role: string }) => s.role === 'MANAGER').id}`)
      .set(auth(fx.managerToken))
      .send({ status: 'SUSPENDED' });
    expect(selfSuspend.status).toBe(422);
  });

  it('search returns assigned carriers only, with commissionPercent and basePrice', async () => {
    const carriers = await request(app).get('/api/v1/broker/carriers').set(auth(fx.clerkToken));
    expect(carriers.status).toBe(200);
    expect(carriers.body.data).toHaveLength(1);
    expect(carriers.body.data[0]).toMatchObject({ key: 'sudan_express', commissionPercent: 10 });

    const search = await request(app)
      .get('/api/v1/broker/trips?origin=Khartoum&destination=Port')
      .set(auth(fx.clerkToken));
    expect(search.status).toBe(200);
    expect(search.body.data).toHaveLength(1);
    expect(search.body.data[0]).toMatchObject({
      id: fx.tripId,
      commissionPercent: 10,
      basePrice: BASE_PRICE,
      seatsFree: 5,
    });
    expect(search.body.data.map((t: { id: string }) => t.id)).not.toContain(fx.otherTripId);

    const date = tomorrow().slice(0, 10);
    const byDate = await request(app)
      .get(`/api/v1/broker/trips?date=${date}`)
      .set(auth(fx.clerkToken));
    expect(byDate.status).toBe(200);
    expect(byDate.body.data).toHaveLength(1);

    const detail = await request(app).get(`/api/v1/broker/trips/${fx.tripId}`).set(auth(fx.clerkToken));
    expect(detail.status).toBe(200);
    expect(detail.body.data.seats).toHaveLength(5);

    const hidden = await request(app)
      .get(`/api/v1/broker/trips/${fx.otherTripId}`)
      .set(auth(fx.clerkToken));
    expect(hidden.status).toBe(404);

    const adminTrips = await request(app).get('/api/v1/catalog/trips').set(auth(fx.adminToken));
    expect(adminTrips.status).toBe(200);
    expect(adminTrips.body.data).toHaveLength(2);
  });

  it('holds: conflict for other employee, release, and expiry frees seats', async () => {
    const seats = await seatsOf(fx.clerkToken, fx.tripId);
    const a1 = seats.find((s) => s.label === 'A1')!;

    const first = await hold(fx.clerkToken, fx.tripId, [a1.id]);
    expect(first.status).toBe(201);
    const conflict = await hold(fx.managerToken, fx.tripId, [a1.id]);
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('SEAT_UNAVAILABLE');

    const del = await request(app)
      .delete(`/api/v1/broker/holds/${first.body.data.holds[0].id}`)
      .set(auth(fx.clerkToken));
    expect(del.status).toBe(200);

    const again = await hold(fx.managerToken, fx.tripId, [a1.id]);
    expect(again.status).toBe(201);

    // expire it
    await getPrisma().seatHold.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const afterExpiry = await hold(fx.clerkToken, fx.tripId, [a1.id]);
    expect(afterExpiry.status).toBe(201);
  });

  it('quote + confirm booking: debits wallet, commission floor, seats sold, idempotent', async () => {
    await topUp(fx.managerToken, 200000, 'topup-book-1');

    const seats = await seatsOf(fx.clerkToken, fx.tripId);
    const seatIds = seats.slice(0, 2).map((s) => s.id);

    const quote = await request(app)
      .post('/api/v1/broker/bookings/quote')
      .set(auth(fx.clerkToken))
      .send({ tripId: fx.tripId, seatIds, passengers: passengers(2) });
    expect(quote.status).toBe(200);
    expect(quote.body.data).toMatchObject({
      totalAmountMinor: BASE_PRICE * 2,
      expectedCommissionMinor: Math.floor((BASE_PRICE * 2 * 10) / 100),
      walletBalanceMinor: 200000,
      balanceAfterMinor: 200000 - BASE_PRICE * 2,
      sufficientBalance: true,
    });

    // confirm without a hold is rejected
    const noHold = await request(app)
      .post('/api/v1/broker/bookings/confirm')
      .set(auth(fx.clerkToken))
      .send({ tripId: fx.tripId, seatIds, passengers: passengers(2), idempotencyKey: 'bk-nohold-1' });
    expect(noHold.status).toBe(409);
    expect(noHold.body.code).toBe('HOLD_REQUIRED');

    expect((await hold(fx.clerkToken, fx.tripId, seatIds)).status).toBe(201);

    // another employee cannot confirm someone else's hold
    const stolen = await request(app)
      .post('/api/v1/broker/bookings/confirm')
      .set(auth(fx.managerToken))
      .send({ tripId: fx.tripId, seatIds, passengers: passengers(2), idempotencyKey: 'bk-stolen-1' });
    expect(stolen.status).toBe(409);

    const confirm = await request(app)
      .post('/api/v1/broker/bookings/confirm')
      .set(auth(fx.clerkToken))
      .send({ tripId: fx.tripId, seatIds, passengers: passengers(2), idempotencyKey: 'bk-ok-1' });
    expect(confirm.status).toBe(201);
    const booking = confirm.body.data.booking;
    expect(booking.status).toBe('CONFIRMED');
    expect(booking.totalAmountMinor).toBe(BASE_PRICE * 2);
    expect(booking.commissionAmountMinor).toBe(5000);
    expect(booking.commissionStatus).toBe('UNSETTLED');
    expect(booking.tickets).toHaveLength(2);
    expect(confirm.body.data.balanceAfterMinor).toBe(200000 - BASE_PRICE * 2);

    const replay = await request(app)
      .post('/api/v1/broker/bookings/confirm')
      .set(auth(fx.clerkToken))
      .send({ tripId: fx.tripId, seatIds, passengers: passengers(2), idempotencyKey: 'bk-ok-1' });
    expect(replay.status).toBe(200);
    expect(replay.body.data.booking.id).toBe(booking.id);

    const wallet = await request(app).get('/api/v1/broker/wallet').set(auth(fx.managerToken));
    expect(wallet.body.data.balanceMinor).toBe(200000 - BASE_PRICE * 2);

    const after = await seatsOf(fx.clerkToken, fx.tripId);
    expect(after.filter((s) => s.status === 'SOLD')).toHaveLength(2);
    expect(await getPrisma().seatHold.count()).toBe(0);

    // clerk sees own bookings; manager sees office-wide
    const clerkList = await request(app).get('/api/v1/broker/bookings').set(auth(fx.clerkToken));
    expect(clerkList.body.data).toHaveLength(1);
    const managerList = await request(app)
      .get('/api/v1/broker/bookings?status=CONFIRMED')
      .set(auth(fx.managerToken));
    expect(managerList.body.data).toHaveLength(1);
    const detail = await request(app)
      .get(`/api/v1/broker/bookings/${booking.id}`)
      .set(auth(fx.managerToken));
    expect(detail.status).toBe(200);

    const blocked = await request(app)
      .post(`/api/v1/broker/bookings/${booking.id}/dispatch`)
      .set(auth(fx.clerkToken))
      .send({ channel: 'whatsapp' });
    expect(blocked.status).toBe(422);
    expect(blocked.body.code).toBe('TICKET_CHANNEL_DISABLED');

    const dispatch = await request(app)
      .post(`/api/v1/broker/bookings/${booking.id}/dispatch`)
      .set(auth(fx.clerkToken))
      .send({ channel: 'download' });
    expect(dispatch.status).toBe(200);
    expect(dispatch.body.data.status).toBe('READY');
    expect(dispatch.body.data.document.passengers).toHaveLength(2);
    expect(dispatch.body.data.pdfContentType).toBe('application/pdf');
    expect(dispatch.body.data.pdfBase64).toMatch(/^JVBERi/);
    const pdfBytes = Buffer.from(dispatch.body.data.pdfBase64, 'base64');
    expect(pdfBytes.subarray(0, 4).toString('utf8')).toBe('%PDF');
    expect(await getPrisma().ticketDispatchAttempt.count()).toBe(1);

    const audits = await getPrisma().auditLog.findMany({
      where: { action: { in: ['booking.confirmed', 'booking.dispatched'] } },
    });
    expect(audits.map((a) => a.action).sort()).toEqual(['booking.confirmed', 'booking.dispatched']);

    const commissions = await request(app)
      .get('/api/v1/broker/commissions')
      .set(auth(fx.managerToken));
    expect(commissions.body.data.totalUnsettledMinor).toBe(5000);
  });

  it('insufficient balance rejects confirm atomically', async () => {
    await topUp(fx.managerToken, 10000, 'topup-small-1'); // below one seat price

    const seats = await seatsOf(fx.clerkToken, fx.tripId);
    const seatIds = [seats[0]!.id];
    expect((await hold(fx.clerkToken, fx.tripId, seatIds)).status).toBe(201);

    const confirm = await request(app)
      .post('/api/v1/broker/bookings/confirm')
      .set(auth(fx.clerkToken))
      .send({ tripId: fx.tripId, seatIds, passengers: passengers(1), idempotencyKey: 'bk-poor-1' });
    expect(confirm.status).toBe(409);
    expect(confirm.body.code).toBe('INSUFFICIENT_BALANCE');

    expect(await getPrisma().booking.count()).toBe(0);
    expect(await getPrisma().commissionAccrual.count()).toBe(0);
    const wallet = await request(app).get('/api/v1/broker/wallet').set(auth(fx.managerToken));
    expect(wallet.body.data.balanceMinor).toBe(10000);
    // hold survives the failed attempt
    expect(await getPrisma().seatHold.count()).toBe(1);

    const quote = await request(app)
      .post('/api/v1/broker/bookings/quote')
      .set(auth(fx.clerkToken))
      .send({ tripId: fx.tripId, seatIds, passengers: passengers(1) });
    expect(quote.body.data.sufficientBalance).toBe(false);
  });

  it('exposure ceiling blocks bookings beyond the office daily cap', async () => {
    await topUp(fx.managerToken, 500000, 'topup-cap-1');
    await getPrisma().brokerOffice.update({
      where: { id: fx.officeId },
      data: { exposureCeilingOverride: 2 },
    });

    const ok = await bookSeats(fx.clerkToken, 2, 'bk-cap-1');
    expect(ok.confirm.status).toBe(201);

    const over = await bookSeats(fx.clerkToken, 1, 'bk-cap-2');
    expect(over.confirm.status).toBe(409);
    expect(over.confirm.body.code).toBe('EXPOSURE_CEILING_EXCEEDED');
  });

  it('cancel refunds the wallet in full, claws back commission and frees seats', async () => {
    await topUp(fx.managerToken, 200000, 'topup-cancel-1');
    const { confirm } = await bookSeats(fx.clerkToken, 2, 'bk-cancel-1');
    expect(confirm.status).toBe(201);
    const bookingId = confirm.body.data.booking.id as string;

    const cancel = await request(app)
      .post(`/api/v1/broker/bookings/${bookingId}/cancel`)
      .set(auth(fx.clerkToken))
      .send();
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.booking.status).toBe('CANCELLED');
    expect(cancel.body.data.refundedAmountMinor).toBe(BASE_PRICE * 2);
    expect(cancel.body.data.commissionClawedBackMinor).toBe(5000);
    expect(cancel.body.data.balanceAfterMinor).toBe(200000);
    expect(cancel.body.data.booking.commissionStatus).toBe('CLAWED_BACK');

    const wallet = await request(app).get('/api/v1/broker/wallet').set(auth(fx.managerToken));
    expect(wallet.body.data.balanceMinor).toBe(200000);

    const seats = await seatsOf(fx.clerkToken, fx.tripId);
    expect(seats.every((s) => s.status === 'FREE')).toBe(true);

    const tickets = await getPrisma().ticket.findMany();
    expect(tickets.every((t) => t.status === 'CANCELLED')).toBe(true);

    const commissions = await request(app)
      .get('/api/v1/broker/commissions')
      .set(auth(fx.managerToken));
    expect(commissions.body.data.totalUnsettledMinor).toBe(0);

    const second = await request(app)
      .post(`/api/v1/broker/bookings/${bookingId}/cancel`)
      .set(auth(fx.clerkToken))
      .send();
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('BOOKING_NOT_CANCELLABLE');

    // seats are reusable; refund ledger row exists exactly once
    const ledger = await getPrisma().walletLedgerEntry.findMany({
      where: { type: 'CREDIT_REFUND' },
    });
    expect(ledger).toHaveLength(1);
  });

  it('admin commission settlement reserves, forbids overlap, and finalizes without touching the wallet', async () => {
    await topUp(fx.managerToken, 300000, 'topup-payout-1');
    const first = await bookSeats(fx.clerkToken, 1, 'bk-payout-1');
    expect(first.confirm.status).toBe(201);
    const second = await bookSeats(fx.clerkToken, 2, 'bk-payout-2');
    expect(second.confirm.status).toBe(201);

    const walletBefore = await request(app).get('/api/v1/broker/wallet').set(auth(fx.managerToken));

    const list = await request(app)
      .get(`/api/v1/admin/commissions?officeId=${fx.officeId}&status=UNSETTLED`)
      .set(auth(fx.adminToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.meta.summary.unsettledTotalMinor).toBe(7500);

    const period = {
      officeId: fx.officeId,
      periodFrom: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      periodTo: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };

    const draft = await request(app)
      .post('/api/v1/admin/commissions/settlements')
      .set(auth(fx.adminToken))
      .send({ ...period, note: 'monthly' });
    expect(draft.status).toBe(201);
    expect(draft.body.data.status).toBe('DRAFT');
    expect(draft.body.data.totalAmountMinor).toBe(7500);

    const overlap = await request(app)
      .post('/api/v1/admin/commissions/settlements')
      .set(auth(fx.adminToken))
      .send(period);
    expect(overlap.status).toBe(409);
    expect(overlap.body.code).toBe('SETTLEMENT_OVERLAP');

    const reserved = await getPrisma().commissionAccrual.findMany();
    expect(reserved.every((a) => a.status === 'RESERVED')).toBe(true);

    const finalized = await request(app)
      .post(`/api/v1/admin/commissions/settlements/${draft.body.data.id}/finalize`)
      .set(auth(fx.adminToken))
      .send({ payoutReference: 'BANK-1' });
    expect(finalized.status).toBe(200);
    expect(finalized.body.data.status).toBe('FINALIZED');

    const replay = await request(app)
      .post(`/api/v1/admin/commissions/settlements/${draft.body.data.id}/finalize`)
      .set(auth(fx.adminToken))
      .send();
    expect(replay.status).toBe(200);
    expect(replay.body.data.status).toBe('FINALIZED');

    const walletAfter = await request(app).get('/api/v1/broker/wallet').set(auth(fx.managerToken));
    expect(walletAfter.body.data.balanceMinor).toBe(walletBefore.body.data.balanceMinor);
    expect(
      await getPrisma().walletLedgerEntry.count({ where: { type: 'DEBIT_COMMISSION_PAYOUT' } }),
    ).toBe(0);

    const accruals = await getPrisma().commissionAccrual.findMany();
    expect(accruals.every((a) => a.status === 'SETTLED')).toBe(true);

    const office = await request(app)
      .get(`/api/v1/brokers/${fx.officeId}`)
      .set(auth(fx.adminToken));
    expect(office.body.data.lastSettledAt).toBeTruthy();

    const brokerView = await request(app)
      .get('/api/v1/broker/commissions')
      .set(auth(fx.managerToken));
    expect(brokerView.body.data.totalUnsettledMinor).toBe(0);
    expect(brokerView.body.data.lastSettledAt).toBeTruthy();
  });

  it('admin office management: list, carriers replace, suspend blocks broker access', async () => {
    const list = await request(app).get('/api/v1/brokers').set(auth(fx.adminToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.meta.total).toBe(1);

    const detail = await request(app).get(`/api/v1/brokers/${fx.officeId}`).set(auth(fx.adminToken));
    expect(detail.body.data.carrierAssignments).toHaveLength(1);
    expect(detail.body.data.employees).toHaveLength(2);

    const replaced = await request(app)
      .put(`/api/v1/brokers/${fx.officeId}/carriers`)
      .set(auth(fx.adminToken))
      .send({
        assignments: [
          { companyId: fx.companyId, commissionPercent: 12.5 },
          { companyId: fx.otherCompanyId, commissionPercent: 5 },
        ],
      });
    expect(replaced.status).toBe(200);
    expect(replaced.body.data.carrierAssignments).toHaveLength(2);

    const dup = await request(app)
      .put(`/api/v1/brokers/${fx.officeId}/carriers`)
      .set(auth(fx.adminToken))
      .send([
        { companyId: fx.companyId, commissionPercent: 1 },
        { companyId: fx.companyId, commissionPercent: 2 },
      ]);
    expect(dup.status).toBe(422);

    const suspend = await request(app)
      .patch(`/api/v1/brokers/${fx.officeId}/status`)
      .set(auth(fx.adminToken))
      .send({ status: 'SUSPENDED' });
    expect(suspend.status).toBe(200);

    const blocked = await request(app).get('/api/v1/broker/wallet').set(auth(fx.managerToken));
    expect(blocked.status).toBe(401);

    const dupCode = await request(app)
      .post('/api/v1/brokers')
      .set(auth(fx.adminToken))
      .send({ code: 'ZG-BRK-1', name: 'Dup' });
    expect(dupCode.status).toBe(409);
  });
});
