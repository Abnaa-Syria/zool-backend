import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getPrisma } from '../src/infrastructure/database/prisma';
import { bootTestApp, shutdownTestApp, resetDatabase, seedCatalogAndSuperAdmin, loginWithOtp } from './helpers/app';
import { loginCustomer } from './helpers/mobile';
import { seedNetwork, sudanAt } from './helpers/network';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Admin CRUD completion: detail reads and safe deletes', () => {
  let app: Express;
  let token: string;
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
    token = (await loginWithOtp(app, '+249900000001')).accessToken;
    net = await seedNetwork(app, token);
  });

  it('reads and deletes unused reference data; refuses records in use with the alternative', async () => {
    const city = await request(app).post('/api/v1/admin/cities').set(auth(token)).send({ code: 'KSL', nameAr: 'كسلا', nameEn: 'Kassala' });
    expect((await request(app).get(`/api/v1/admin/cities/${city.body.data.id}`).set(auth(token))).body.data.code).toBe('KSL');
    expect((await request(app).delete(`/api/v1/admin/cities/${city.body.data.id}`).set(auth(token))).body.data.deleted).toBe(true);
    expect((await request(app).get(`/api/v1/admin/cities/${city.body.data.id}`).set(auth(token))).status).toBe(404);

    // KRT has stations used by routes: refused with usage counts.
    const inUse = await request(app).delete(`/api/v1/admin/cities/${net.krt.cityId}`).set(auth(token));
    expect(inUse.status).toBe(409);
    expect(inUse.body).toMatchObject({ code: 'ENTITY_IN_USE', details: { entity: 'city', usage: { stations: 1 } } });
    const st = await request(app).delete(`/api/v1/admin/stations/${net.krt.stationId}`).set(auth(token));
    expect(st.body.details.usage.routes).toBeGreaterThan(0);

    // An unused vehicle and driver can go; a vehicle with trips cannot.
    await net.schedule({ departure: sudanAt(3, '08:00'), priceMinor: 1_000_000 });
    expect((await request(app).delete(`/api/v1/admin/vehicles/${net.bus2Id}`).set(auth(token))).status).toBe(200);
    const busy = await request(app).delete(`/api/v1/admin/vehicles/${net.busId}`).set(auth(token));
    expect(busy.body).toMatchObject({ code: 'ENTITY_IN_USE', details: { alternative: 'Retire the vehicle (status=RETIRED)' } });
    expect((await request(app).delete(`/api/v1/admin/drivers/${net.driverId}`).set(auth(token))).status).toBe(200);

    // Coupon: unused → deleted.
    const coupon = await request(app)
      .post('/api/v1/admin/coupons')
      .set(auth(token))
      .send({ code: 'DEL10', discountType: 'PERCENT', value: 1000, validFrom: new Date().toISOString(), validTo: new Date(Date.now() + 86_400_000).toISOString() });
    expect(coupon.status).toBe(201);
    expect((await request(app).get(`/api/v1/admin/coupons/${coupon.body.data.id}`).set(auth(token))).body.data.code).toBe('DEL10');
    expect((await request(app).delete(`/api/v1/admin/coupons/${coupon.body.data.id}`).set(auth(token))).status).toBe(200);

    // A carrier with routes/trips is refused; an empty one is deleted with its portal staff.
    expect((await request(app).delete(`/api/v1/carriers/${net.companyId}`).set(auth(token))).status).toBe(409);
    const empty = await request(app).post('/api/v1/carriers').set(auth(token)).send({ key: 'empty_co', name: 'Empty Co', manager: { displayName: 'Boss', phone: '+249900000751' } });
    expect((await request(app).delete(`/api/v1/carriers/${empty.body.data.id}`).set(auth(token))).status).toBe(200);
    expect(await getPrisma().carrierEmployee.count({ where: { companyId: empty.body.data.id } })).toBe(0);
  });

  it('deletes an empty broker office and anonymises a customer', async () => {
    const office = await request(app)
      .post('/api/v1/brokers')
      .set(auth(token))
      .send({ code: 'ZG-DEL-1', name: 'Temp', settlementPeriod: 'MONTHLY', manager: { displayName: 'Manager', phone: '+249900000761' } });
    expect(office.status).toBe(201);
    expect((await request(app).delete(`/api/v1/brokers/${office.body.data.id}`).set(auth(token))).status).toBe(200);

    const c = await loginCustomer(app, '+249912990001');
    const del = await request(app).delete(`/api/v1/admin/customers/${c.body.data.customer.id}`).set(auth(token));
    expect(del.status).toBe(200);
    expect((await request(app).get(`/api/v1/admin/customers/${c.body.data.customer.id}`).set(auth(token))).body.data).toMatchObject({ status: 'DELETED', phone: null });
  });
});
