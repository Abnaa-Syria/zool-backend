import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getPrisma } from '../src/infrastructure/database/prisma';
import { bootTestApp, shutdownTestApp, resetDatabase, seedCatalogAndSuperAdmin, loginWithOtp } from './helpers/app';
import { loginCustomer, loginDriver } from './helpers/mobile';
import { seedNetwork } from './helpers/network';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Driver app: trip lifecycle, QR boarding, cash, GPS and live tracking', () => {
  let app: Express;
  let adminToken: string;
  let driver: string;
  let customer: string;
  let customerId: string;
  let trip: string;
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
    // Departs in 2 hours so boarding is open.
    trip = await net.schedule({ departure: new Date(Date.now() + 2 * 3600_000), priceMinor: 3_500_000, withDriver: true });
    await getPrisma().station.updateMany({ where: { city: { code: 'PZU' } }, data: { latitude: 19.6158, longitude: 37.2164 } });
    driver = (await loginDriver(app, net.driverPhone)).body.data.accessToken;
    const c = await loginCustomer(app, '+249912700001');
    customer = c.body.data.accessToken;
    customerId = c.body.data.customer.id;
  });

  async function book(seats: string[], paymentMethod: 'CASH_ON_BOARD' | 'ONLINE', key: string) {
    const h = await request(app).post(`/api/v1/customer/trips/${trip}/holds`).set(auth(customer)).send({ seatLabels: seats });
    const res = await request(app)
      .post('/api/v1/customer/bookings')
      .set(auth(customer))
      .set('Idempotency-Key', key)
      .send({ holdIds: h.body.data.holds.map((x: { id: string }) => x.id), passengers: seats.map((s) => ({ fullName: `Pax ${s}`, gender: 'MALE' })), paymentMethod });
    expect(res.status).toBe(201);
    if (paymentMethod === 'ONLINE') await request(app).post(`/api/v1/customer/payments/${res.body.data.payment.intentId}/mock-confirm`).set(auth(customer));
    return (await request(app).get(`/api/v1/customer/bookings/${res.body.data.bookings[0].id}`).set(auth(customer))).body.data;
  }

  it('runs a full trip: boarding, scans, cash collection, no-shows, GPS, completion', async () => {
    const cash = await book(['1', '2'], 'CASH_ON_BOARD', 'drv-cash-0001');
    const paid = await book(['3'], 'ONLINE', 'drv-paid-0001');
    const noShow = await book(['4'], 'CASH_ON_BOARD', 'drv-noshow-01');

    const dash = await request(app).get('/api/v1/driver/dashboard').set(auth(driver));
    expect(dash.status).toBe(200);
    expect(dash.body.data.nextTrip.id).toBe(trip);
    expect((await request(app).get('/api/v1/driver/trips?tab=UPCOMING').set(auth(driver))).body.data.map((t: { id: string }) => t.id)).toEqual([trip]);

    // Boarding not started yet: scanning works, boarding does not.
    const early = await request(app).post(`/api/v1/driver/trips/${trip}/boardings`).set(auth(driver)).send({ ticketNumber: paid.tickets[0].ticketNumber });
    expect(early.body.code).toBe('TRIP_STATE_INVALID');
    expect((await request(app).post(`/api/v1/driver/trips/${trip}/status`).set(auth(driver)).send({ status: 'COMPLETED' })).body.code).toBe('TRIP_STATE_INVALID');
    const boarding = await request(app).post(`/api/v1/driver/trips/${trip}/status`).set(auth(driver)).send({ status: 'BOARDING' });
    expect(boarding.body.data).toMatchObject({ status: 'BOARDING', allowedTransitions: ['IN_PROGRESS'], counts: { booked: 4, boarded: 0 } });

    const manifest = await request(app).get(`/api/v1/driver/trips/${trip}/manifest`).set(auth(driver));
    expect(manifest.body.data.counts).toMatchObject({ booked: 4, pending: 4 });
    expect(manifest.body.data.passengers.map((p: { seatLabel: string; cashToCollectMinor: number }) => `${p.seatLabel}:${p.cashToCollectMinor}`)).toEqual([
      '1:3500000',
      '2:3500000',
      '3:0',
      '4:3500000',
    ]);

    // Scans: valid, forged, wrong trip.
    const scan = await request(app).post(`/api/v1/driver/trips/${trip}/scan`).set(auth(driver)).send({ code: cash.tickets[0].qrPayload });
    expect(scan.body.data).toMatchObject({ result: 'VALID', ticket: { seatLabel: '1', cashToCollectMinor: 3_500_000 } });
    expect((await request(app).post(`/api/v1/driver/trips/${trip}/scan`).set(auth(driver)).send({ code: cash.tickets[0].qrPayload.slice(0, -2) + 'zz' })).body.data.result).toBe('INVALID');

    // Cash must be collected in full.
    const short = await request(app).post(`/api/v1/driver/trips/${trip}/boardings`).set(auth(driver)).send({ ticketNumber: cash.tickets[0].ticketNumber, cashCollectedMinor: 100 });
    expect(short.body.code).toBe('CASH_AMOUNT_MISMATCH');
    for (const t of cash.tickets) {
      const b = await request(app).post(`/api/v1/driver/trips/${trip}/boardings`).set(auth(driver)).send({ ticketNumber: t.ticketNumber, cashCollectedMinor: 3_500_000 });
      expect(b.status).toBe(201);
    }
    const again = await request(app).post(`/api/v1/driver/trips/${trip}/boardings`).set(auth(driver)).send({ ticketNumber: cash.tickets[0].ticketNumber, cashCollectedMinor: 3_500_000 });
    expect(again.body.data.replayed).toBe(true);
    expect((await request(app).post(`/api/v1/driver/trips/${trip}/scan`).set(auth(driver)).send({ code: cash.tickets[0].qrPayload })).body.data.result).toBe('ALREADY_BOARDED');
    expect((await request(app).get(`/api/v1/customer/bookings/${cash.id}`).set(auth(customer))).body.data.paymentStatus).toBe('PAID_CASH');

    const manual = await request(app).post(`/api/v1/driver/trips/${trip}/boardings`).set(auth(driver)).send({ ticketNumber: paid.tickets[0].ticketNumber, method: 'MANUAL' });
    expect(manual.body.data).toMatchObject({ boardingStatus: 'BOARDED', boardingMethod: 'MANUAL' });

    const cashSummary = await request(app).get(`/api/v1/driver/trips/${trip}/cash`).set(auth(driver));
    expect(cashSummary.body.data).toMatchObject({ expectedMinor: 10_500_000, collectedMinor: 7_000_000, outstandingMinor: 3_500_000 });

    // Depart: seat 4 becomes a no-show and counts against the customer's cash eligibility.
    await request(app).post(`/api/v1/driver/trips/${trip}/status`).set(auth(driver)).send({ status: 'IN_PROGRESS' });
    const after = await request(app).get(`/api/v1/customer/bookings/${noShow.id}`).set(auth(customer));
    expect(after.body.data.tickets[0].boardingStatus).toBe('NO_SHOW');
    expect((await getPrisma().customer.findUnique({ where: { id: customerId } }))!.cashNoShowCount).toBe(1);

    // GPS + live tracking.
    const gps = await request(app)
      .post(`/api/v1/driver/trips/${trip}/positions`)
      .set(auth(driver))
      .send({ positions: [{ lat: 16.0, lng: 33.5, speedKmh: 90, heading: 45, recordedAt: new Date().toISOString() }] });
    expect(gps.status).toBe(202);
    expect(gps.body.data).toEqual({ accepted: 1, rejected: 0 });
    const live = await request(app).get(`/api/v1/customer/bookings/${cash.id}/live`).set(auth(customer));
    expect(live.status).toBe(200);
    expect(live.body.data).toMatchObject({ status: 'IN_PROGRESS', position: { lat: 16, lng: 33.5, speedKmh: 90 }, nextStop: { city: { code: 'SHD' } } });
    expect(live.body.data.remainingKm).toBeGreaterThan(300);
    const stopId = live.body.data.timeline[1].stopId as string;
    // The driver app marks stops from the trip detail, so STOP entries expose their id + actual times.
    const before = await request(app).get(`/api/v1/driver/trips/${trip}`).set(auth(driver));
    const stopEntry = before.body.data.stops.find((s: { kind: string }) => s.kind === 'STOP');
    expect(stopEntry).toMatchObject({ id: stopId, arrivedAt: null, departedAt: null });
    expect(before.body.data.seatsTotal).toBeGreaterThan(0);
    await request(app).post(`/api/v1/driver/trips/${trip}/stops/${stopId}`).set(auth(driver)).send({ event: 'ARRIVED' });
    const afterStop = await request(app).get(`/api/v1/driver/trips/${trip}`).set(auth(driver));
    expect(afterStop.body.data.stops.find((s: { id?: string }) => s.id === stopId).arrivedAt).toEqual(expect.any(String));
    const live2 = await request(app).get(`/api/v1/customer/bookings/${cash.id}/live`).set(auth(customer));
    expect(live2.body.data.nextStop.city.code).toBe('PZU');

    const admin = await request(app).get('/api/v1/admin/tracking/live').set(auth(adminToken));
    expect(admin.body.data.map((t: { tripId: string }) => t.tripId)).toEqual([trip]);
    const detail = await request(app).get(`/api/v1/admin/tracking/trips/${trip}`).set(auth(adminToken));
    expect(detail.body.data.trail).toHaveLength(1);

    const done = await request(app).post(`/api/v1/driver/trips/${trip}/status`).set(auth(driver)).send({ status: 'COMPLETED' });
    expect(done.body.data.status).toBe('COMPLETED');
    expect((await request(app).get('/api/v1/customer/bookings?tab=PAST').set(auth(customer))).body.data.length).toBe(3);
    const rate = await getPrisma().notification.findMany({ where: { recipientId: customerId, type: 'RATE_TRIP' } });
    expect(rate).toHaveLength(1);
  });

  it('keeps drivers to their own trips', async () => {
    const other = await request(app)
      .post('/api/v1/admin/drivers')
      .set(auth(adminToken))
      .send({ companyId: net.companyId, displayName: 'Other Driver', phone: '+249900000202' });
    expect(other.status).toBe(201);
    const t = (await loginDriver(app, '+249900000202')).body.data.accessToken;
    expect((await request(app).get(`/api/v1/driver/trips/${trip}`).set(auth(t))).status).toBe(404);
    expect((await request(app).post(`/api/v1/driver/trips/${trip}/status`).set(auth(t)).send({ status: 'BOARDING' })).status).toBe(404);
    expect((await request(app).get('/api/v1/driver/trips?tab=UPCOMING').set(auth(t))).body.data).toHaveLength(0);
  });
});
