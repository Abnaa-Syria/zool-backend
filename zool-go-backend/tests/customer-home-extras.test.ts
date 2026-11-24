import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { bootTestApp, shutdownTestApp, resetDatabase, seedCatalogAndSuperAdmin, loginWithOtp } from './helpers/app';
import { loginCustomer } from './helpers/mobile';
import { seedNetwork, sudanAt, sudanDate } from './helpers/network';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Customer home extras: promo banners (D-PROMO-01), suggested trips, favourites', () => {
  let app: Express;
  let adminToken: string;
  let token: string;
  let net: Awaited<ReturnType<typeof seedNetwork>>;
  let soon: string;
  let later: string;

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
    soon = await net.schedule({ departure: sudanAt(1, '07:00'), priceMinor: 3_500_000 });
    later = await net.schedule({ departure: sudanAt(3, '07:00'), priceMinor: 3_000_000 });
    token = (await loginCustomer(app, '+249912700001')).body.data.accessToken;
  });

  it('lists only active coupons marked «show in app» as promo banners; admin can edit the banner', async () => {
    const day = 86_400_000;
    const create = (code: string, extra: Record<string, unknown>) =>
      request(app)
        .post('/api/v1/admin/coupons')
        .set(auth(adminToken))
        .send({ code, discountType: 'PERCENT', value: 2000, validFrom: new Date(Date.now() - day).toISOString(), validTo: new Date(Date.now() + 10 * day).toISOString(), ...extra });

    const shown = await create('ZOOL20', { showInApp: true, promoTitleAr: 'خصم 20% على أول رحلة', promoSubtitleAr: 'استخدم الكود', promoSortOrder: 5 });
    expect(shown.status).toBe(201);
    expect(shown.body.data).toMatchObject({ showInApp: true, promoTitleAr: 'خصم 20% على أول رحلة', promoSortOrder: 5 });
    await create('HIDDEN10', {});
    const future = await request(app)
      .post('/api/v1/admin/coupons')
      .set(auth(adminToken))
      .send({ code: 'FUTURE', discountType: 'FIXED', value: 50_000, validFrom: new Date(Date.now() + 5 * day).toISOString(), validTo: new Date(Date.now() + 9 * day).toISOString(), showInApp: true });
    expect(future.status).toBe(201);

    const promos = await request(app).get('/api/v1/public/promotions');
    expect(promos.status).toBe(200);
    expect(promos.body.data.map((p: { code: string }) => p.code)).toEqual(['ZOOL20']);
    expect(promos.body.data[0]).toMatchObject({ titleAr: 'خصم 20% على أول رحلة', subtitleAr: 'استخدم الكود', discountType: 'PERCENT', value: 2000 });

    // Admin hides it again from the dashboard.
    const hide = await request(app).patch(`/api/v1/admin/coupons/${shown.body.data.id}`).set(auth(adminToken)).send({ showInApp: false });
    expect(hide.status).toBe(200);
    expect((await request(app).get('/api/v1/public/promotions')).body.data).toEqual([]);
  });

  it('suggests upcoming trips (searched routes first) and saves / removes favourites', async () => {
    await request(app)
      .get('/api/v1/customer/trips')
      .query({ fromCityId: net.krt.cityId, toCityId: net.pzu.cityId, date: sudanDate(new Date(Date.now() + 86_400_000)) })
      .set(auth(token));

    const suggested = await request(app).get('/api/v1/customer/trips/suggested').set(auth(token));
    expect(suggested.status).toBe(200);
    const ids = suggested.body.data.map((t: { id: string }) => t.id);
    expect(ids).toEqual(expect.arrayContaining([soon, later]));
    expect(ids.indexOf(soon)).toBeLessThan(ids.indexOf(later));
    expect(suggested.body.data[0]).toMatchObject({ isFavorite: false, priceMinor: expect.any(Number), carrier: expect.any(Object) });

    expect((await request(app).post(`/api/v1/customer/favorites/${later}`).set(auth(token))).status).toBe(201);
    expect((await request(app).post(`/api/v1/customer/favorites/${later}`).set(auth(token))).status).toBe(201); // idempotent
    const fav = await request(app).get('/api/v1/customer/favorites').set(auth(token));
    expect(fav.body.data).toHaveLength(1);
    expect(fav.body.data[0]).toMatchObject({ id: later, isFavorite: true, bookable: true });
    const again = await request(app).get('/api/v1/customer/trips/suggested').set(auth(token));
    expect(again.body.data.find((t: { id: string }) => t.id === later).isFavorite).toBe(true);

    expect((await request(app).delete(`/api/v1/customer/favorites/${later}`).set(auth(token))).body.data.isFavorite).toBe(false);
    expect((await request(app).get('/api/v1/customer/favorites').set(auth(token))).body.data).toEqual([]);
    expect((await request(app).post('/api/v1/customer/favorites/does-not-exist').set(auth(token))).status).toBe(404);
    expect((await request(app).get('/api/v1/customer/favorites')).status).toBe(401);
  });
});
