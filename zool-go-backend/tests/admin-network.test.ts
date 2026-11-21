import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { bootTestApp, shutdownTestApp, resetDatabase, seedCatalogAndSuperAdmin, loginWithOtp } from './helpers/app';
import { getPrisma } from '../src/infrastructure/database/prisma';
import { buildNumberedLayout } from '../src/shared/utils/seat-layout';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const DAY = 24 * 60 * 60 * 1000;

describe('Admin network: routes and structured trip scheduling', () => {
  let app: Express;
  let adminToken: string;
  let companyId: string;
  let st: Record<'krt' | 'shd' | 'atb' | 'pzu', string>;
  let vehicleId: string;
  let vehicle2Id: string;
  let driverId: string;

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
    const prisma = getPrisma();
    companyId = (await prisma.transportCompany.create({ data: { key: 'sudan_express', name: 'Sudan Express' } })).id;
    const mk = async (code: string, ar: string, en: string) => {
      const city = await prisma.city.create({ data: { code, nameAr: ar, nameEn: en } });
      return (await prisma.station.create({ data: { cityId: city.id, nameAr: `موقف ${ar}`, nameEn: `${en} Terminal` } })).id;
    };
    st = {
      krt: await mk('KRT', 'الخرطوم', 'Khartoum'),
      shd: await mk('SHD', 'شندي', 'Shendi'),
      atb: await mk('ATB', 'عطبرة', 'Atbara'),
      pzu: await mk('PZU', 'بورتسودان', 'Port Sudan'),
    };
    const layout = buildNumberedLayout({ rows: 7, womenOnlyLabels: ['11', '12'] });
    vehicleId = (
      await prisma.vehicle.create({ data: { companyId, plateNumber: 'KRT 1', model: 'Coaster', capacity: 28, seatLayout: layout } })
    ).id;
    const small = buildNumberedLayout({ rows: 3 });
    vehicle2Id = (
      await prisma.vehicle.create({ data: { companyId, plateNumber: 'KRT 2', model: 'Hiace', capacity: 12, seatLayout: small } })
    ).id;
    driverId = (await prisma.driver.create({ data: { companyId, driverCode: 'ZGD-1', displayName: 'Driver One' } })).id;
  });

  async function createRoute() {
    const res = await request(app)
      .post('/api/v1/admin/routes')
      .set(auth(adminToken))
      .send({
        companyId,
        code: 'krt-pzu',
        originStationId: st.krt,
        destinationStationId: st.pzu,
        durationMinutes: 720,
        stops: [
          { stationId: st.shd, offsetMinutes: 180, dwellMinutes: 15 },
          { stationId: st.atb, offsetMinutes: 300, dwellMinutes: 30 },
        ],
      });
    expect(res.status).toBe(201);
    return res.body.data;
  }

  it('validates route stops', async () => {
    const decreasing = await request(app)
      .post('/api/v1/admin/routes')
      .set(auth(adminToken))
      .send({
        companyId,
        originStationId: st.krt,
        destinationStationId: st.pzu,
        durationMinutes: 720,
        stops: [
          { stationId: st.atb, offsetMinutes: 300 },
          { stationId: st.shd, offsetMinutes: 180 },
        ],
      });
    expect(decreasing.status).toBe(422);
    const afterArrival = await request(app)
      .post('/api/v1/admin/routes')
      .set(auth(adminToken))
      .send({ companyId, originStationId: st.krt, destinationStationId: st.pzu, durationMinutes: 120, stops: [{ stationId: st.shd, offsetMinutes: 180 }] });
    expect(afterArrival.status).toBe(422);
    const route = await createRoute();
    expect(route.code).toBe('KRT-PZU');
    expect(route.stops.map((s: { station: { nameEn: string } }) => s.station.nameEn)).toEqual(['Shendi Terminal', 'Atbara Terminal']);
  });

  it('schedules trips with seats from the layout, stop times and trip numbers', async () => {
    const route = await createRoute();
    const d1 = new Date(Date.now() + 2 * DAY);
    const d2 = new Date(d1.getTime() + DAY);
    const res = await request(app)
      .post('/api/v1/admin/trips/schedule')
      .set(auth(adminToken))
      .send({ routeId: route.id, vehicleId, driverId, departures: [d2.toISOString(), d1.toISOString()], basePrice: 3_500_000 });
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveLength(2);
    const [t1] = res.body.data;
    expect(t1.departureAt).toBe(d1.toISOString());
    expect(t1.arrivalAt).toBe(new Date(d1.getTime() + 720 * 60_000).toISOString());
    expect(t1.tripNumber).toMatch(/^KRT-PZU-\d{8}-\d{4}$/);
    expect(t1.seatCounts).toEqual({ total: 28, free: 28, held: 0, sold: 0 });
    expect(t1.seats.filter((s: { isWomenOnly: boolean }) => s.isWomenOnly).map((s: { seatLabel: string }) => s.seatLabel)).toEqual(['11', '12']);
    expect(t1.stops[1].scheduledArrivalAt).toBe(new Date(d1.getTime() + 300 * 60_000).toISOString());
    expect(t1).toMatchObject({ origin: 'الخرطوم', destination: 'بورتسودان', status: 'SCHEDULED', driver: { id: driverId } });

    // Overlap for the same vehicle and for the same driver is rejected.
    const busy = await request(app)
      .post('/api/v1/admin/trips/schedule')
      .set(auth(adminToken))
      .send({ routeId: route.id, vehicleId, departures: [new Date(d1.getTime() + 60 * 60_000).toISOString()], basePrice: 1 });
    expect(busy.status).toBe(409);
    expect(busy.body.code).toBe('VEHICLE_BUSY');
    const driverBusy = await request(app)
      .post('/api/v1/admin/trips/schedule')
      .set(auth(adminToken))
      .send({ routeId: route.id, vehicleId: vehicle2Id, driverId, departures: [new Date(d1.getTime() + 60 * 60_000).toISOString()], basePrice: 1 });
    expect(driverBusy.body.code).toBe('DRIVER_BUSY');

    const past = await request(app)
      .post('/api/v1/admin/trips/schedule')
      .set(auth(adminToken))
      .send({ routeId: route.id, vehicleId: vehicle2Id, departures: [new Date(Date.now() - DAY).toISOString()], basePrice: 1 });
    expect(past.status).toBe(422);
  });

  it('swaps the vehicle only while no seat is taken, rebuilding the seat map', async () => {
    const route = await createRoute();
    const d1 = new Date(Date.now() + 3 * DAY);
    const res = await request(app)
      .post('/api/v1/admin/trips/schedule')
      .set(auth(adminToken))
      .send({ routeId: route.id, vehicleId, departures: [d1.toISOString()], basePrice: 100_000 });
    const tripId = res.body.data[0].id as string;

    const swapped = await request(app).patch(`/api/v1/admin/trips/${tripId}/assignment`).set(auth(adminToken)).send({ vehicleId: vehicle2Id, driverId });
    expect(swapped.status).toBe(200);
    expect(swapped.body.data.seatCounts.total).toBe(12);
    expect(swapped.body.data.driver.id).toBe(driverId);

    await getPrisma().tripSeat.updateMany({ where: { tripId, seatLabel: '1' }, data: { status: 'SOLD' } });
    const blocked = await request(app).patch(`/api/v1/admin/trips/${tripId}/assignment`).set(auth(adminToken)).send({ vehicleId });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('TRIP_SEATS_TAKEN');

    const unassign = await request(app).patch(`/api/v1/admin/trips/${tripId}/assignment`).set(auth(adminToken)).send({ driverId: null });
    expect(unassign.body.data.driver).toBeNull();
  });

  it('rejects a vehicle or driver from another carrier', async () => {
    const route = await createRoute();
    const other = await getPrisma().transportCompany.create({ data: { key: 'other', name: 'Other' } });
    const foreignDriver = await getPrisma().driver.create({ data: { companyId: other.id, driverCode: 'ZGD-9', displayName: 'X' } });
    const res = await request(app)
      .post('/api/v1/admin/trips/schedule')
      .set(auth(adminToken))
      .send({ routeId: route.id, vehicleId, driverId: foreignDriver.id, departures: [new Date(Date.now() + DAY).toISOString()], basePrice: 1 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ASSIGNMENT_MISMATCH');
  });
});
