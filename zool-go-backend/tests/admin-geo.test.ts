import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { bootTestApp, shutdownTestApp, resetDatabase, seedCatalogAndSuperAdmin, loginWithOtp } from './helpers/app';
import { getPrisma } from '../src/infrastructure/database/prisma';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Admin reference data: cities, stations, amenities', () => {
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

  it('creates, lists and updates cities and stations with audit-safe validation', async () => {
    const city = await request(app)
      .post('/api/v1/admin/cities')
      .set(auth(adminToken))
      .send({ code: 'pzu', nameAr: 'بورتسودان', nameEn: 'Port Sudan', isPopular: true });
    expect(city.status).toBe(201);
    expect(city.body.data).toMatchObject({ code: 'PZU', isPopular: true, isActive: true, stationCount: 0 });

    const dup = await request(app)
      .post('/api/v1/admin/cities')
      .set(auth(adminToken))
      .send({ code: 'PZU', nameAr: 'مكرر', nameEn: 'Duplicate' });
    expect(dup.status).toBe(409);

    const halfCoords = await request(app)
      .post('/api/v1/admin/stations')
      .set(auth(adminToken))
      .send({ cityId: city.body.data.id, nameAr: 'الموقف', nameEn: 'Terminal', latitude: 19.6 });
    expect(halfCoords.status).toBe(422);

    const station = await request(app)
      .post('/api/v1/admin/stations')
      .set(auth(adminToken))
      .send({ cityId: city.body.data.id, nameAr: 'الموقف السفري', nameEn: 'Bus Terminal', latitude: 19.6158, longitude: 37.2164 });
    expect(station.status).toBe(201);
    expect(station.body.data).toMatchObject({ latitude: 19.6158, longitude: 37.2164, city: { code: 'PZU' } });

    const unknownCity = await request(app)
      .post('/api/v1/admin/stations')
      .set(auth(adminToken))
      .send({ cityId: 'missing', nameAr: 'س', nameEn: 'Nowhere' });
    expect([404, 422]).toContain(unknownCity.status);

    const list = await request(app).get('/api/v1/admin/cities?q=Port').set(auth(adminToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].stationCount).toBe(1);
    expect(list.body.meta).toMatchObject({ page: 1, total: 1 });

    const deactivate = await request(app)
      .patch(`/api/v1/admin/stations/${station.body.data.id}`)
      .set(auth(adminToken))
      .send({ isActive: false });
    expect(deactivate.status).toBe(200);
    expect(deactivate.body.data.isActive).toBe(false);

    const active = await request(app).get('/api/v1/admin/stations?isActive=true').set(auth(adminToken));
    expect(active.body.data).toHaveLength(0);

    const unknownField = await request(app)
      .patch(`/api/v1/admin/cities/${city.body.data.id}`)
      .set(auth(adminToken))
      .send({ code: 'NEW' });
    expect(unknownField.status).toBe(422);

    const audit = await getPrisma().auditLog.findMany({ where: { action: { in: ['city.created', 'station.created', 'station.updated'] } } });
    expect(audit).toHaveLength(3);
  });

  it('manages the amenity catalog', async () => {
    const created = await request(app)
      .post('/api/v1/admin/amenities')
      .set(auth(adminToken))
      .send({ code: 'wifi', nameAr: 'واي فاي', nameEn: 'Wi-Fi', icon: 'wifi' });
    expect(created.status).toBe(201);
    const updated = await request(app)
      .patch(`/api/v1/admin/amenities/${created.body.data.id}`)
      .set(auth(adminToken))
      .send({ icon: 'wifi_tethering' });
    expect(updated.body.data.icon).toBe('wifi_tethering');
    const list = await request(app).get('/api/v1/admin/amenities').set(auth(adminToken));
    expect(list.body.data.map((a: { code: string }) => a.code)).toEqual(['wifi']);
  });

  it('enforces geo.view / geo.manage', async () => {
    const role = await request(app)
      .post('/api/v1/roles')
      .set(auth(adminToken))
      .send({ key: 'geo_viewer', name: 'Geo viewer', permissionKeys: ['geo.view'] });
    const created = await request(app)
      .post('/api/v1/admins')
      .set(auth(adminToken))
      .send({ displayName: 'Viewer', employeeCode: 'ZG-EMP-GEO', phone: '+249900000701', roleIds: [role.body.data.id] });
    expect(created.status).toBe(201);
    await new Promise((r) => setTimeout(r, 1100));
    const viewer = (await loginWithOtp(app, '+249900000701')).accessToken;

    expect((await request(app).get('/api/v1/admin/cities').set(auth(viewer))).status).toBe(200);
    const denied = await request(app)
      .post('/api/v1/admin/cities')
      .set(auth(viewer))
      .send({ code: 'KSL', nameAr: 'كسلا', nameEn: 'Kassala' });
    expect(denied.status).toBe(403);
  });
});
