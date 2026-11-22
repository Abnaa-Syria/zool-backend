import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { bootTestApp, shutdownTestApp, resetDatabase, seedCatalogAndSuperAdmin, loginWithOtp } from './helpers/app';
import { getPrisma } from '../src/infrastructure/database/prisma';
import { buildNumberedLayout } from '../src/shared/utils/seat-layout';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const DAY = 86_400_000;

describe('Admin trips list (enriched rows + filters)', () => {
  let app: Express;
  let adminToken: string;

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
  });

  it('returns trip number, status, route, vehicle and driver in one request and filters by them', async () => {
    const prisma = getPrisma();
    const company = await prisma.transportCompany.create({ data: { key: 'nile_bus', name: 'Nile Bus' } });
    const mk = async (code: string, name: string) => {
      const city = await prisma.city.create({ data: { code, nameAr: name, nameEn: name } });
      return (await prisma.station.create({ data: { cityId: city.id, nameAr: name, nameEn: name } })).id;
    };
    const krt = await mk('KRT', 'Khartoum');
    const pzu = await mk('PZU', 'Port Sudan');
    const vehicle = await prisma.vehicle.create({
      data: { companyId: company.id, plateNumber: 'KRT 7', model: 'Coaster', capacity: 28, seatLayout: buildNumberedLayout({ rows: 7 }) },
    });
    const driver = await prisma.driver.create({ data: { companyId: company.id, driverCode: 'ZGD-7', displayName: 'Driver Seven' } });
    const route = (
      await request(app)
        .post('/api/v1/admin/routes')
        .set(auth(adminToken))
        .send({ companyId: company.id, code: 'KRT-PZU', originStationId: krt, destinationStationId: pzu, durationMinutes: 600 })
    ).body.data;
    const d1 = new Date(Date.now() + 3 * DAY);
    const scheduled = await request(app)
      .post('/api/v1/admin/trips/schedule')
      .set(auth(adminToken))
      .send({ routeId: route.id, vehicleId: vehicle.id, driverId: driver.id, departures: [d1.toISOString(), new Date(d1.getTime() + 2 * DAY).toISOString()], basePrice: 100_000 });
    expect(scheduled.status).toBe(201);
    const [t1] = scheduled.body.data;

    const list = await request(app).get('/api/v1/catalog/trips').set(auth(adminToken));
    expect(list.status).toBe(200);
    expect(list.body.data[0]).toMatchObject({
      tripNumber: t1.tripNumber,
      status: 'SCHEDULED',
      route: { id: route.id, code: 'KRT-PZU' },
      vehicle: { id: vehicle.id, plateNumber: 'KRT 7' },
      driver: { id: driver.id, displayName: 'Driver Seven' },
    });
    expect(list.body.data[0].arrivalAt).toBe(new Date(d1.getTime() + 600 * 60_000).toISOString());

    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Khartoum' }).format(d1);
    const ranged = await request(app).get(`/api/v1/catalog/trips?dateFrom=${day}&dateTo=${day}`).set(auth(adminToken));
    expect(ranged.body.data.map((t: { id: string }) => t.id)).toEqual([t1.id]);

    await request(app).post(`/api/v1/admin/trips/${t1.id}/cancel`).set(auth(adminToken)).send({ reason: 'test' });
    const cancelled = await request(app).get('/api/v1/catalog/trips?status=CANCELLED').set(auth(adminToken));
    expect(cancelled.body.data.map((t: { id: string }) => t.id)).toEqual([t1.id]);
    expect((await request(app).get(`/api/v1/catalog/trips?driverId=${driver.id}&q=KRT-PZU`).set(auth(adminToken))).body.meta.total).toBe(2);

    const detail = await request(app).get(`/api/v1/admin/trips/${t1.id}`).set(auth(adminToken));
    expect(detail.body.data.vehicle.aisleAfterColumn).toBe(2);
  });
});
