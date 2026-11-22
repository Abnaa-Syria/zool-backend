import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getPrisma } from '../src/infrastructure/database/prisma';
import { buildNumberedLayout } from '../src/shared/utils/seat-layout';
import { bootTestApp, shutdownTestApp, resetDatabase, seedCatalogAndSuperAdmin, loginWithOtp, loginBrokerWithOtp } from './helpers/app';
import { loginCustomer, waitOtpCooldown } from './helpers/mobile';
import { seedNetwork, sudanAt, sudanDate } from './helpers/network';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function loginCarrier(app: Express, phone: string) {
  let otp = await request(app).post('/api/v1/carrier/auth/otp/request').send({ phone });
  if (otp.body.code === 'OTP_COOLDOWN') {
    await waitOtpCooldown();
    otp = await request(app).post('/api/v1/carrier/auth/otp/request').send({ phone });
  }
  expect(otp.status).toBe(200);
  const verify = await request(app).post('/api/v1/carrier/auth/otp/verify').send({ phone, code: otp.body.data.devOtp, challengeId: otp.body.data.challengeId });
  expect(verify.status).toBe(200);
  return verify;
}

describe('Carrier portal (D-CARRIER-PORTAL-01) and carrier settlements (D-REV-02)', () => {
  let app: Express;
  let adminToken: string;
  let net: Awaited<ReturnType<typeof seedNetwork>>;

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
  });

  it('admin creates a carrier with its manager; the manager logs in (web cookie) and manages staff', async () => {
    const created = await request(app)
      .post('/api/v1/carriers')
      .set(auth(adminToken))
      .send({ key: 'nile_bus', name: 'Nile Bus', manager: { displayName: 'Nile Manager', phone: '+249900000701' } });
    expect(created.status).toBe(201);
    expect(created.body.data.manager).toMatchObject({ role: 'MANAGER', permissions: ['carrier.fleet', 'carrier.schedule', 'carrier.finance', 'carrier.staff'] });

    const login = await loginCarrier(app, '+249900000701');
    expect(login.body.data.refreshToken).toBeUndefined();
    const cookie = (login.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('zoolgo_carrier_refresh='))!;
    expect(cookie).toContain('HttpOnly');
    const refreshed = await request(app).post('/api/v1/carrier/auth/refresh').set('Cookie', cookie.split(';')[0]!).send({});
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.employee.company.name).toBe('Nile Bus');
    const token = refreshed.body.data.accessToken as string;

    const clerk = await request(app)
      .post('/api/v1/carrier/staff')
      .set(auth(token))
      .send({ displayName: 'Ops Clerk', phone: '+249900000702', flags: { canManageSchedule: true } });
    expect(clerk.status).toBe(201);
    expect(clerk.body.data.permissions).toEqual(['carrier.schedule']);

    const clerkToken = (await loginCarrier(app, '+249900000702')).body.data.accessToken;
    expect((await request(app).get('/api/v1/carrier/settlements').set(auth(clerkToken))).status).toBe(403);
    expect((await request(app).get('/api/v1/carrier/dashboard').set(auth(clerkToken))).status).toBe(200);

    // Permission change logs the clerk out at once; the last manager cannot be demoted.
    await request(app).patch(`/api/v1/carrier/staff/${clerk.body.data.id}`).set(auth(token)).send({ flags: { canViewFinance: true } });
    expect((await request(app).get('/api/v1/carrier/dashboard').set(auth(clerkToken))).body.code).toBe('AUTH_AUTHZ_STALE');
    const managerId = created.body.data.manager.id;
    expect((await request(app).patch(`/api/v1/carriers/${created.body.data.id}/staff/${managerId}`).set(auth(adminToken)).send({ role: 'STAFF' })).status).toBe(409);
  });

  it('a carrier operates only its own fleet, routes and trips', async () => {
    await request(app)
      .post(`/api/v1/carriers/${net.companyId}/staff`)
      .set(auth(adminToken))
      .send({ displayName: 'Express Manager', phone: '+249900000711', role: 'MANAGER' });
    const token = (await loginCarrier(app, '+249900000711')).body.data.accessToken;

    const bus = await request(app)
      .post('/api/v1/carrier/vehicles')
      .set(auth(token))
      .send({ plateNumber: 'KRT 77', model: 'Coaster', layout: { numbered: { rows: 5 } } });
    expect(bus.status).toBe(201);
    expect(bus.body.data.company.id).toBe(net.companyId);
    expect((await request(app).get('/api/v1/carrier/vehicles').set(auth(token))).body.meta.total).toBe(3);

    // Another carrier's data is invisible.
    const other = await getPrisma().transportCompany.create({ data: { key: 'other_co', name: 'Other Co' } });
    const otherBus = await getPrisma().vehicle.create({ data: { companyId: other.id, plateNumber: 'OTH 1', model: 'X', capacity: 4, seatLayout: buildNumberedLayout({ rows: 1 }) } });
    expect((await request(app).get(`/api/v1/carrier/vehicles/${otherBus.id}`).set(auth(token))).status).toBe(404);
    expect((await request(app).patch(`/api/v1/carrier/vehicles/${otherBus.id}`).set(auth(token)).send({ model: 'Hacked' })).status).toBe(404);
    expect((await request(app).get(`/api/v1/carrier/vehicles?companyId=${other.id}`).set(auth(token))).body.meta.total).toBe(3);

    const routes = await request(app).get('/api/v1/carrier/routes').set(auth(token));
    const route = routes.body.data.find((r: { code: string }) => r.code === 'KRT-PZU');
    const sched = await request(app)
      .post('/api/v1/carrier/trips/schedule')
      .set(auth(token))
      .send({ routeId: route.id, vehicleId: bus.body.data.id, departures: [sudanAt(5, '09:00').toISOString()], basePrice: 3_000_000 });
    expect(sched.status).toBe(201);
    const tripId = sched.body.data[0].id as string;
    const priced = await request(app).patch(`/api/v1/carrier/trips/${tripId}/price`).set(auth(token)).send({ basePriceMinor: 3_300_000 });
    expect(priced.body.data.basePrice ?? priced.body.data.basePriceMinor).toBe(3_300_000);
    expect((await request(app).post('/api/v1/carrier/trips/schedule').set(auth(token)).send({ routeId: route.id, vehicleId: otherBus.id, departures: [sudanAt(6, '09:00').toISOString()], basePrice: 1 })).status).toBe(404);

    // The admin sees the carrier employee as the actor of the change.
    const audit = await getPrisma().auditLog.findFirst({ where: { action: 'trips.scheduled' }, orderBy: { createdAt: 'desc' } });
    expect(audit).toMatchObject({ actorType: 'CARRIER_EMPLOYEE', actorAdminId: null });

    const cancel = await request(app).post(`/api/v1/carrier/trips/${tripId}/cancel`).set(auth(token)).send({ reason: 'Bus maintenance' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.trip.status).toBe('CANCELLED');
  });

  it('settlement: online, broker and cash sales with fee and carrier-borne commission', async () => {
    await request(app).patch(`/api/v1/carriers/${net.companyId}`).set(auth(adminToken)).send({ platformFeeType: 'PERCENT', platformFeeValue: 500, brokerCommissionBearer: 'CARRIER' });
    const tripId = await net.schedule({ departure: new Date(Date.now() + 2 * 3600_000), priceMinor: 1_000_000 });

    // Customer: one online seat + one cash seat.
    const ctoken = (await loginCustomer(app, '+249912900101')).body.data.accessToken;
    const buy = async (seat: string, method: 'ONLINE' | 'CASH_ON_BOARD', key: string) => {
      const h = await request(app).post(`/api/v1/customer/trips/${tripId}/holds`).set(auth(ctoken)).send({ seatLabels: [seat] });
      const r = await request(app).post('/api/v1/customer/bookings').set(auth(ctoken)).set('Idempotency-Key', key).send({ holdIds: [h.body.data.holds[0].id], passengers: [{ fullName: 'Ali Omer', gender: 'MALE' }], paymentMethod: method });
      if (method === 'ONLINE') await request(app).post(`/api/v1/customer/payments/${r.body.data.payment.intentId}/mock-confirm`).set(auth(ctoken));
      return r.body.data.bookings[0];
    };
    await getPrisma().systemSetting.upsert({ where: { key: 'cash.cutoffMinutesBeforeDeparture' }, create: { key: 'cash.cutoffMinutesBeforeDeparture', value: 0 }, update: { value: 0 } });
    await request(app).patch('/api/v1/admin/settings').set(auth(adminToken)).send({ values: { 'cash.cutoffMinutesBeforeDeparture': 0 } });
    await buy('1', 'ONLINE', 'settle-online-1');
    const cash = await buy('2', 'CASH_ON_BOARD', 'settle-cash-01');

    // Broker: one seat at 10% commission.
    const office = await request(app).post('/api/v1/brokers').set(auth(adminToken)).send({ code: 'ZG-BRK-S1', name: 'Office', settlementPeriod: 'MONTHLY', manager: { displayName: 'Manager', phone: '+249900000981' } });
    await request(app).put(`/api/v1/brokers/${office.body.data.id}/carriers`).set(auth(adminToken)).send([{ companyId: net.companyId, commissionPercent: 10 }]);
    const mgr = (await loginBrokerWithOtp(app, '+249900000981')).accessToken;
    const tu = await request(app).post('/api/v1/broker/wallet/top-ups').set(auth(mgr)).send({ amountMinor: 5_000_000, idempotencyKey: 'tu-settle' });
    await request(app).post(`/api/v1/broker/wallet/top-ups/${tu.body.data.id}/mock-confirm`).set(auth(mgr)).send();
    const seat3 = (await request(app).get(`/api/v1/broker/trips/${tripId}`).set(auth(mgr))).body.data.seats.find((s: { label: string }) => s.label === '3').id;
    await request(app).post(`/api/v1/broker/trips/${tripId}/holds`).set(auth(mgr)).send({ seatIds: [seat3] });
    expect((await request(app).post('/api/v1/broker/bookings/confirm').set(auth(mgr)).send({ tripId, seatIds: [seat3], passengers: [{ fullName: 'Pax', phone: '0911111111' }], idempotencyKey: 'settle-brk-1' })).status).toBe(201);

    // Driver collects the cash fare.
    await getPrisma().trip.update({ where: { id: tripId }, data: { driverId: net.driverId } });
    await waitOtpCooldown();
    const dOtp = await request(app).post('/api/v1/driver/auth/otp/request').send({ phone: net.driverPhone });
    const dTok = (await request(app).post('/api/v1/driver/auth/otp/verify').set('X-Client-Platform', 'android').send({ phone: net.driverPhone, code: dOtp.body.data.devOtp, challengeId: dOtp.body.data.challengeId })).body.data.accessToken;
    await request(app).post(`/api/v1/driver/trips/${tripId}/status`).set(auth(dTok)).send({ status: 'BOARDING' });
    await request(app).post(`/api/v1/driver/trips/${tripId}/boardings`).set(auth(dTok)).send({ ticketNumber: cash.tickets[0].ticketNumber, cashCollectedMinor: 1_000_000 });

    const today = sudanDate(new Date());
    const preview = await request(app).get(`/api/v1/admin/carrier-settlements/preview?companyId=${net.companyId}&from=${today}&to=${today}`).set(auth(adminToken));
    expect(preview.body.data).toMatchObject({
      ticketsCount: 3,
      onlineSalesAmount: 1_000_000,
      brokerSalesAmount: 1_000_000,
      cashSalesAmount: 1_000_000,
      platformFeeAmount: 150_000,
      brokerCommissionAmount: 100_000,
      // 1,000,000 online + 1,000,000 broker − 150,000 fee − 100,000 commission (carrier bears it)
      netPayableAmount: 1_750_000,
    });

    // A settled period must have ended; then draft → finalize → paid; overlaps are refused.
    await getPrisma().trip.update({ where: { id: tripId }, data: { departureAt: sudanAt(-2, '10:00'), arrivalAt: sudanAt(-2, '20:00') } });
    const day = sudanDate(sudanAt(-2, '10:00'));
    const draft = await request(app).post('/api/v1/admin/carrier-settlements').set(auth(adminToken)).send({ companyId: net.companyId, fromDate: day, toDate: day });
    expect(draft.status).toBe(201);
    expect(draft.body.data).toMatchObject({ status: 'DRAFT', netPayableMinor: 1_750_000, direction: 'PLATFORM_PAYS_CARRIER' });
    expect(draft.body.data.lines).toHaveLength(1);
    expect((await request(app).post('/api/v1/admin/carrier-settlements').set(auth(adminToken)).send({ companyId: net.companyId, fromDate: day, toDate: day })).body.code).toBe('SETTLEMENT_OVERLAP');
    const fin = await request(app).post(`/api/v1/admin/carrier-settlements/${draft.body.data.id}/finalize`).set(auth(adminToken));
    expect(fin.body.data.status).toBe('FINALIZED');
    const paid = await request(app).post(`/api/v1/admin/carrier-settlements/${draft.body.data.id}/mark-paid`).set(auth(adminToken)).send({ reference: 'BANK-TRX-1' });
    expect(paid.body.data).toMatchObject({ status: 'PAID', paymentReference: 'BANK-TRX-1' });

    // The carrier's finance user sees its own statement.
    await request(app).post(`/api/v1/carriers/${net.companyId}/staff`).set(auth(adminToken)).send({ displayName: 'Finance', phone: '+249900000721', flags: { canViewFinance: true } });
    const fToken = (await loginCarrier(app, '+249900000721')).body.data.accessToken;
    const mine = await request(app).get('/api/v1/carrier/settlements').set(auth(fToken));
    expect(mine.body.data.map((s: { id: string }) => s.id)).toEqual([draft.body.data.id]);
    const cashByDriver = await request(app).get(`/api/v1/carrier/reports/cash-by-driver?from=${today}&to=${today}`).set(auth(fToken));
    expect(cashByDriver.body.meta.totalMinor).toBe(1_000_000);
  });
});
