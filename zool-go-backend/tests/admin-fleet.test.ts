import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { bootTestApp, shutdownTestApp, resetDatabase, seedCatalogAndSuperAdmin, loginWithOtp } from './helpers/app';
import { getPrisma } from '../src/infrastructure/database/prisma';
import { getPrincipalAuthzVersion } from '../src/shared/security/principal-authz-cache';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Admin fleet: vehicles and drivers', () => {
  let app: Express;
  let adminToken: string;
  let companyId: string;

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
    const company = await getPrisma().transportCompany.create({ data: { key: 'nile_bus', name: 'Nile Bus' } });
    companyId = company.id;
    await getPrisma().amenity.createMany({
      data: [
        { code: 'wifi', nameAr: 'واي فاي', nameEn: 'Wi-Fi', icon: 'wifi' },
        { code: 'luggage', nameAr: 'أمتعة', nameEn: 'Luggage', icon: 'luggage' },
      ],
    });
  });

  it('creates a vehicle from the numbered shortcut with women-only seats and amenities', async () => {
    const res = await request(app)
      .post('/api/v1/admin/vehicles')
      .set(auth(adminToken))
      .send({
        companyId,
        plateNumber: 'KRT 1234',
        model: 'Toyota Coaster',
        serviceClass: 'VIP',
        layout: { numbered: { rows: 7, womenOnlyLabels: ['11', '12'] } },
        amenities: [{ code: 'wifi' }, { code: 'luggage', value: '30' }],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.capacity).toBe(28);
    expect(res.body.data.seatLayout.aisleAfterColumn).toBe(2);
    expect(res.body.data.seatLayout.seats.filter((s: { isWomenOnly: boolean }) => s.isWomenOnly)).toHaveLength(2);
    expect(res.body.data.amenities).toEqual([
      expect.objectContaining({ code: 'luggage', value: '30' }),
      expect.objectContaining({ code: 'wifi', value: null }),
    ]);

    const dupPlate = await request(app)
      .post('/api/v1/admin/vehicles')
      .set(auth(adminToken))
      .send({ companyId, plateNumber: 'KRT 1234', model: 'Other', layout: { numbered: { rows: 2 } } });
    expect(dupPlate.status).toBe(409);

    const badWomenSeat = await request(app)
      .post('/api/v1/admin/vehicles')
      .set(auth(adminToken))
      .send({ companyId, plateNumber: 'KRT 9', model: 'X', layout: { numbered: { rows: 2, womenOnlyLabels: ['99'] } } });
    expect(badWomenSeat.status).toBe(422);

    const badAmenity = await request(app)
      .post('/api/v1/admin/vehicles')
      .set(auth(adminToken))
      .send({ companyId, plateNumber: 'KRT 10', model: 'X', layout: { numbered: { rows: 2 } }, amenities: [{ code: 'jacuzzi' }] });
    expect(badAmenity.status).toBe(422);

    const patched = await request(app)
      .patch(`/api/v1/admin/vehicles/${res.body.data.id}`)
      .set(auth(adminToken))
      .send({ layout: { numbered: { rows: 10 } }, amenities: [], status: 'MAINTENANCE' });
    expect(patched.status).toBe(200);
    expect(patched.body.data).toMatchObject({ capacity: 40, status: 'MAINTENANCE', amenities: [] });
  });

  it('rejects an invalid explicit layout (duplicate labels)', async () => {
    const res = await request(app)
      .post('/api/v1/admin/vehicles')
      .set(auth(adminToken))
      .send({
        companyId,
        plateNumber: 'KRT 55',
        model: 'Mini',
        layout: {
          seatLayout: {
            rows: 1,
            columns: 2,
            aisleAfterColumn: 1,
            driverSide: 'LEFT',
            seats: [
              { label: 'A', row: 1, column: 1 },
              { label: 'A', row: 1, column: 2 },
            ],
          },
        },
      });
    expect(res.status).toBe(422);
  });

  it('creates drivers and revokes their sessions on phone change or suspension', async () => {
    const created = await request(app)
      .post('/api/v1/admin/drivers')
      .set(auth(adminToken))
      .send({ companyId, displayName: 'أحمد محمد', phone: '0912345678', licenseExpiry: '2027-12-31' });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ phone: '+249912345678', status: 'ACTIVE', licenseExpiry: '2027-12-31' });
    expect(created.body.data.driverCode).toMatch(/^ZGD-\d+$/);
    const driverId = created.body.data.id as string;
    expect(await getPrincipalAuthzVersion('driver', driverId)).toBe(1);

    const dupPhone = await request(app)
      .post('/api/v1/admin/drivers')
      .set(auth(adminToken))
      .send({ companyId, displayName: 'Other', phone: '+249912345678' });
    expect(dupPhone.status).toBe(409);

    // Simulate an active driver session, then change the phone.
    await getPrisma().driverRefreshSession.create({
      data: { driverId, tokenHash: 'a'.repeat(64), familyId: 'fam-1', expiresAt: new Date(Date.now() + 86_400_000) },
    });
    const phoneChange = await request(app)
      .patch(`/api/v1/admin/drivers/${driverId}`)
      .set(auth(adminToken))
      .send({ phone: '+249912345679' });
    expect(phoneChange.status).toBe(200);
    expect(phoneChange.body.data.phone).toBe('+249912345679');
    const session = await getPrisma().driverRefreshSession.findFirstOrThrow({ where: { driverId } });
    expect(session.revokedAt).not.toBeNull();
    expect(session.revokeReason).toBe('phone_changed');
    expect(await getPrincipalAuthzVersion('driver', driverId)).toBe(2);

    const suspend = await request(app)
      .patch(`/api/v1/admin/drivers/${driverId}`)
      .set(auth(adminToken))
      .send({ status: 'SUSPENDED' });
    expect(suspend.body.data.status).toBe('SUSPENDED');
    expect(await getPrincipalAuthzVersion('driver', driverId)).toBe(3);

    const rename = await request(app)
      .patch(`/api/v1/admin/drivers/${driverId}`)
      .set(auth(adminToken))
      .send({ displayName: 'أحمد محمد سليمان' });
    expect(rename.status).toBe(200);
    expect(await getPrincipalAuthzVersion('driver', driverId)).toBe(3);

    const list = await request(app).get('/api/v1/admin/drivers?q=912345679').set(auth(adminToken));
    expect(list.body.data).toHaveLength(1);
  });
});
