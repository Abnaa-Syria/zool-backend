import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { bootTestApp, shutdownTestApp, resetDatabase, seedCatalogAndSuperAdmin, loginWithOtp } from './helpers/app';
import { getPrisma } from '../src/infrastructure/database/prisma';
import { computeCouponDiscount } from '../src/modules/coupons';
import { getPrincipalAuthzVersion } from '../src/shared/security/principal-authz-cache';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const DAY = 86_400_000;

describe('Admin customers, coupons and content', () => {
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

  it('lists, suspends and resets customers (suspension revokes sessions)', async () => {
    const customer = await getPrisma().customer.create({
      data: {
        displayName: 'مروة عثمان',
        cashNoShowCount: 2,
        identities: { create: { type: 'PHONE', valueNormalized: '+249911000001', isPrimary: true } },
        refreshSessions: { create: { tokenHash: 'c'.repeat(64), familyId: 'f', expiresAt: new Date(Date.now() + DAY) } },
      },
    });
    const list = await request(app).get('/api/v1/admin/customers?q=911000001').set(auth(adminToken));
    expect(list.body.data).toEqual([expect.objectContaining({ id: customer.id, phone: '+249911000001', cashNoShowCount: 2 })]);

    const suspend = await request(app).patch(`/api/v1/admin/customers/${customer.id}`).set(auth(adminToken)).send({ status: 'SUSPENDED', resetCashNoShows: true });
    expect(suspend.status).toBe(200);
    expect(suspend.body.data).toMatchObject({ status: 'SUSPENDED', cashNoShowCount: 0, bookings: { confirmed: 0, cancelled: 0 } });
    const session = await getPrisma().customerRefreshSession.findFirstOrThrow({ where: { customerId: customer.id } });
    expect(session.revokeReason).toBe('customer_suspended');
    expect(await getPrincipalAuthzVersion('customer', customer.id)).toBe(2);
  });

  it('creates coupons with validation and caps updates by redemptions', async () => {
    const base = { discountType: 'PERCENT', value: 2500, validFrom: new Date().toISOString(), validTo: new Date(Date.now() + 30 * DAY).toISOString() };
    const created = await request(app).post('/api/v1/admin/coupons').set(auth(adminToken)).send({ code: 'eid25', maxDiscountAmountMinor: 500_000, ...base });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ code: 'EID25', value: 2500, perCustomerLimit: 1, redeemedCount: 0 });

    expect((await request(app).post('/api/v1/admin/coupons').set(auth(adminToken)).send({ code: 'EID25', ...base })).status).toBe(409);
    expect((await request(app).post('/api/v1/admin/coupons').set(auth(adminToken)).send({ ...base, code: 'BAD1', value: 20_000 })).status).toBe(422);
    expect(
      (await request(app).post('/api/v1/admin/coupons').set(auth(adminToken)).send({ ...base, code: 'BAD2', validTo: base.validFrom })).status,
    ).toBe(422);

    await getPrisma().coupon.update({ where: { id: created.body.data.id }, data: { redeemedCount: 5 } });
    const tooLow = await request(app).patch(`/api/v1/admin/coupons/${created.body.data.id}`).set(auth(adminToken)).send({ maxRedemptions: 3 });
    expect(tooLow.status).toBe(422);
    const off = await request(app).patch(`/api/v1/admin/coupons/${created.body.data.id}`).set(auth(adminToken)).send({ isActive: false });
    expect(off.body.data.isActive).toBe(false);
  });

  it('computes coupon discounts with integer math, caps and subtotal bound', () => {
    expect(computeCouponDiscount({ discountType: 'PERCENT', value: 2500, maxDiscountAmount: null }, 3_500_001)).toBe(875_000);
    expect(computeCouponDiscount({ discountType: 'PERCENT', value: 2500, maxDiscountAmount: 500_000 }, 3_500_000)).toBe(500_000);
    expect(computeCouponDiscount({ discountType: 'FIXED', value: 9_000_000, maxDiscountAmount: null }, 3_500_000)).toBe(3_500_000);
  });

  it('publishes content pages and serves them publicly without login', async () => {
    expect((await request(app).get('/api/v1/public/content/privacy')).status).toBe(404);
    const put = await request(app)
      .put('/api/v1/admin/content/privacy')
      .set(auth(adminToken))
      .send({ titleAr: 'سياسة الخصوصية', titleEn: 'Privacy', sections: [{ titleAr: 'مقدمة', titleEn: 'Intro', bodyAr: 'نص', bodyEn: 'Text' }] });
    expect(put.status).toBe(200);
    const pub = await request(app).get('/api/v1/public/content/privacy');
    expect(pub.status).toBe(200);
    expect(pub.body.data).toMatchObject({ slug: 'privacy', titleAr: 'سياسة الخصوصية', sections: [{ bodyEn: 'Text' }] });
    expect((await request(app).put('/api/v1/admin/content/privacy').set(auth(adminToken)).send({ titleAr: 'x', titleEn: 'y', sections: [] })).status).toBe(422);
  });
});
