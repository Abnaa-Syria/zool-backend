import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { bootTestApp, shutdownTestApp, resetDatabase, seedCatalogAndSuperAdmin, loginWithOtp } from './helpers/app';
import { loginCustomer } from './helpers/mobile';
import { seedNetwork, sudanAt, sudanDate } from './helpers/network';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Customer trip search, seat map and holds', () => {
  let app: Express;
  let adminToken: string;
  let token: string;
  let net: Awaited<ReturnType<typeof seedNetwork>>;
  let morning: string;
  let evening: string;
  let vip: string;
  const date = () => sudanDate(sudanAt(2, '08:00'));

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
    morning = await net.schedule({ departure: sudanAt(2, '08:00'), priceMinor: 3_500_000 });
    evening = await net.schedule({ departure: sudanAt(2, '18:30'), priceMinor: 3_000_000 });
    vip = await net.schedule({ departure: sudanAt(2, '10:00'), priceMinor: 5_000_000, vip: true });
    await net.schedule({ departure: sudanAt(3, '08:00'), priceMinor: 3_500_000 }); // other day: never listed
    token = (await loginCustomer(app, '+249912300001')).body.data.accessToken;
  });

  const search = (q: string) =>
    request(app).get(`/api/v1/customer/trips?fromCityId=${net.krt.cityId}&toCityId=${net.pzu.cityId}&date=${date()}${q}`).set(auth(token));

  it('lists only the searched route and Sudan day with card fields, sorted and filtered', async () => {
    const res = await search('&sort=priceMinor');
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(3);
    expect(res.body.data.map((t: { id: string }) => t.id)).toEqual([evening, morning, vip]);
    expect(res.body.data[1]).toMatchObject({
      carrier: { name: 'Sudan Express', legalName: 'Sudan Express Co.', rating: { average: 4.5, count: 10 } },
      durationMinutes: 600,
      origin: { city: { code: 'KRT' }, station: { nameEn: 'Khartoum Terminal' } },
      destination: { city: { code: 'PZU' } },
      isDirect: false,
      stopsCount: 1,
      seatsAvailable: 28,
      amenities: ['wifi', 'ac'],
      priceMinor: 3_500_000,
      currency: 'SDG',
    });

    expect((await search('&departureFrom=12:00')).body.data.map((t: { id: string }) => t.id)).toEqual([evening]);
    expect((await search('&serviceClass=VIP')).body.data.map((t: { id: string }) => t.id)).toEqual([vip]);
    expect((await search('&amenity=wifi,ac')).body.meta.total).toBe(2);
    expect((await search('&passengers=10')).body.meta.total).toBe(3);
    expect((await search('&passengers=11')).status).toBe(422);
    expect((await search('&passengers=10&priceMaxMinor=3000000')).body.data.map((t: { id: string }) => t.id)).toEqual([evening]);

    // Wrong direction is a different route.
    const back = await request(app)
      .get(`/api/v1/customer/trips?fromCityId=${net.pzu.cityId}&toCityId=${net.krt.cityId}&date=${date()}`)
      .set(auth(token));
    expect(back.body.meta.total).toBe(0);
  });

  it('builds the filter sheet from the results and remembers recent searches', async () => {
    const f = await request(app)
      .get(`/api/v1/customer/trips/filters?fromCityId=${net.krt.cityId}&toCityId=${net.pzu.cityId}&date=${date()}`)
      .set(auth(token));
    expect(f.body.data).toMatchObject({
      total: 3,
      priceRange: { minMinor: 3_000_000, maxMinor: 5_000_000 },
      serviceClasses: ['STANDARD', 'VIP'],
    });
    expect(f.body.data.amenities.map((a: { code: string }) => a.code)).toEqual(['ac', 'wifi']);
    expect(f.body.data.departureWindows.find((w: { key: string }) => w.key === 'MORNING').tripsCount).toBe(2);

    await search('&returnDate=' + sudanDate(sudanAt(5, '08:00')) + '&passengers=2');
    const recent = await request(app).get('/api/v1/customer/recent-searches').set(auth(token));
    expect(recent.body.data).toHaveLength(1);
    expect(recent.body.data[0]).toMatchObject({ fromCity: { code: 'KRT' }, toCity: { code: 'PZU' }, passengers: 2 });
    await request(app).delete('/api/v1/customer/recent-searches').set(auth(token));
    expect((await request(app).get('/api/v1/customer/recent-searches').set(auth(token))).body.data).toHaveLength(0);
  });

  it('shows trip detail with the stops timeline and the seat map with women-only seats', async () => {
    const d = await request(app).get(`/api/v1/customer/trips/${morning}`).set(auth(token));
    expect(d.status).toBe(200);
    expect(d.body.data.stops.map((s: { kind: string; city: { code: string } }) => `${s.kind}:${s.city.code}`)).toEqual([
      'ORIGIN:KRT',
      'STOP:SHD',
      'DESTINATION:PZU',
    ]);
    expect(d.body.data).toMatchObject({ vehicleModel: 'Coaster', cashAvailable: true });

    const map = await request(app).get(`/api/v1/customer/trips/${morning}/seats`).set(auth(token));
    expect(map.body.data.layout).toMatchObject({ rows: 7, columns: 4, aisleAfterColumn: 2 });
    expect(map.body.data.seats).toHaveLength(28);
    expect(map.body.data.seats.filter((s: { isWomenOnly: boolean }) => s.isWomenOnly).map((s: { label: string }) => s.label)).toEqual(['11', '12']);
    expect(map.body.data.seats[0]).toMatchObject({ label: '1', row: 1, column: 1, state: 'AVAILABLE', heldByMe: false });
  });

  it('holds seats, replaces the selection, blocks others and releases', async () => {
    const h1 = await request(app).post(`/api/v1/customer/trips/${morning}/holds`).set(auth(token)).send({ seatLabels: ['1', '2'] });
    expect(h1.status).toBe(201);
    expect(h1.body.data.holds.map((h: { seatLabel: string }) => h.seatLabel)).toEqual(['1', '2']);
    expect(h1.body.data.remainingSeconds).toBeGreaterThan(0);

    // New selection on the same trip replaces the old one (seat 1 is free again).
    const h2 = await request(app).post(`/api/v1/customer/trips/${morning}/holds`).set(auth(token)).send({ seatLabels: ['2', '3'] });
    expect(h2.status).toBe(201);
    const map = await request(app).get(`/api/v1/customer/trips/${morning}/seats`).set(auth(token));
    const state = (l: string) => map.body.data.seats.find((s: { label: string }) => s.label === l);
    expect(state('1').state).toBe('AVAILABLE');
    expect(state('3')).toMatchObject({ state: 'HELD', heldByMe: true });

    // Another customer cannot take a held seat and sees it as HELD (not "mine").
    const other = (await loginCustomer(app, '+249912300002')).body.data.accessToken;
    const taken = await request(app).post(`/api/v1/customer/trips/${morning}/holds`).set(auth(other)).send({ seatLabels: ['3'] });
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe('SEAT_UNAVAILABLE');
    expect(taken.body.details.unavailableSeatLabels).toEqual(['3']);
    const otherMap = await request(app).get(`/api/v1/customer/trips/${morning}/seats`).set(auth(other));
    expect(otherMap.body.data.seats.find((s: { label: string }) => s.label === '3')).toMatchObject({ state: 'HELD', heldByMe: false });

    // Only the owner can release.
    const holdId = h2.body.data.holds[0].id;
    expect((await request(app).delete(`/api/v1/customer/holds/${holdId}`).set(auth(other))).status).toBe(404);
    expect((await request(app).delete(`/api/v1/customer/holds/${holdId}`).set(auth(token))).status).toBe(200);

    expect((await request(app).post(`/api/v1/customer/trips/${morning}/holds`).set(auth(token)).send({ seatLabels: ['99'] })).status).toBe(404);
    expect((await request(app).post(`/api/v1/customer/trips/${morning}/holds`).set(auth(token)).send({ seatLabels: ['4', '4'] })).status).toBe(422);
  });

  it('hides suspended carriers and pauses holds in maintenance mode', async () => {
    await request(app).patch('/api/v1/admin/settings').set(auth(adminToken)).send({ values: { 'platform.maintenanceMode': true } });
    const paused = await request(app).post(`/api/v1/customer/trips/${morning}/holds`).set(auth(token)).send({ seatLabels: ['1'] });
    expect(paused.status).toBe(503);
    expect(paused.body.code).toBe('PLATFORM_MAINTENANCE');
    await request(app).patch('/api/v1/admin/settings').set(auth(adminToken)).send({ values: { 'platform.maintenanceMode': false } });

    const s = await request(app).patch(`/api/v1/carriers/${net.companyId}`).set(auth(adminToken)).send({ status: 'SUSPENDED' });
    expect(s.status).toBe(200);
    expect((await search('')).body.meta.total).toBe(0);
    expect((await request(app).get(`/api/v1/customer/trips/${morning}`).set(auth(token))).status).toBe(404);
  });
});
