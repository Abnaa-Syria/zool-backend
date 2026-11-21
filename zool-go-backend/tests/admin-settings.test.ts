import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { bootTestApp, shutdownTestApp, resetDatabase, seedCatalogAndSuperAdmin, loginWithOtp, loginBrokerWithOtp } from './helpers/app';
import { getPrisma } from '../src/infrastructure/database/prisma';
import { runtimeSettings } from '../src/shared/settings/runtime-settings';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Runtime settings (D-SET-02)', () => {
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
    await runtimeSettings.reload();
    await seedCatalogAndSuperAdmin();
    adminToken = (await loginWithOtp(app, '+249900000001')).accessToken;
  });

  it('lists defaults from .env, validates and audits updates', async () => {
    const list = await request(app).get('/api/v1/admin/settings').set(auth(adminToken));
    expect(list.status).toBe(200);
    const ttl = list.body.data.find((s: { key: string }) => s.key === 'booking.seatHoldTtlSeconds');
    expect(ttl).toMatchObject({ type: 'integer', isDefault: true, min: 60, max: 3600 });

    for (const bad of [
      { 'booking.seatHoldTtlSeconds': 5 },
      { 'booking.seatHoldTtlSeconds': '600' },
      { 'cash.enabled': 'yes' },
      { 'settlement.defaultPeriod': 'DAILY' },
      { 'unknown.key': 1 },
    ]) {
      const res = await request(app).patch('/api/v1/admin/settings').set(auth(adminToken)).send({ values: bad });
      expect(res.status, JSON.stringify(bad)).toBe(422);
    }

    const ok = await request(app)
      .patch('/api/v1/admin/settings')
      .set(auth(adminToken))
      .send({ values: { 'booking.seatHoldTtlSeconds': 600, 'cash.enabled': false } });
    expect(ok.status).toBe(200);
    const updated = ok.body.data.find((s: { key: string }) => s.key === 'booking.seatHoldTtlSeconds');
    expect(updated).toMatchObject({ value: 600, isDefault: false, updatedBy: { displayName: expect.any(String) } });
    expect(runtimeSettings.number('booking.seatHoldTtlSeconds')).toBe(600);
    expect(runtimeSettings.boolean('cash.enabled')).toBe(false);

    const audit = await getPrisma().auditLog.findFirstOrThrow({ where: { action: 'settings.updated' } });
    expect(audit.metadataJson).toContain('"after":600');
  });

  it('an admin change takes effect in business rules (minimum broker top-up)', async () => {
    const office = await request(app)
      .post('/api/v1/brokers')
      .set(auth(adminToken))
      .send({ code: 'ZG-BRK-S', name: 'Office', settlementPeriod: 'MONTHLY', manager: { displayName: 'Manager', phone: '+249900000611' } });
    expect(office.status).toBe(201);
    const manager = (await loginBrokerWithOtp(app, '+249900000611')).accessToken;

    const before = await request(app).post('/api/v1/broker/wallet/top-ups').set(auth(manager)).send({ amountMinor: 1_000_000, idempotencyKey: 'tu-a' });
    expect(before.status).toBe(201);

    await request(app).patch('/api/v1/admin/settings').set(auth(adminToken)).send({ values: { 'wallet.minTopUpMinor': 5_000_000 } });
    const after = await request(app).post('/api/v1/broker/wallet/top-ups').set(auth(manager)).send({ amountMinor: 1_000_000, idempotencyKey: 'tu-b' });
    expect(after.body.code).toBe('TOP_UP_BELOW_MINIMUM');
  });

  it('requires settings.manage to change values', async () => {
    const role = await request(app).post('/api/v1/roles').set(auth(adminToken)).send({ key: 'settings_viewer', name: 'Viewer', permissionKeys: ['settings.view'] });
    await request(app)
      .post('/api/v1/admins')
      .set(auth(adminToken))
      .send({ displayName: 'Viewer', employeeCode: 'ZG-EMP-SET', phone: '+249900000612', roleIds: [role.body.data.id] });
    await new Promise((r) => setTimeout(r, 1100));
    const viewer = (await loginWithOtp(app, '+249900000612')).accessToken;
    const viewRes = await request(app).get('/api/v1/admin/settings').set(auth(viewer));
    expect(viewRes.status).toBe(200);
    expect((await request(app).patch('/api/v1/admin/settings').set(auth(viewer)).send({ values: { 'cash.enabled': false } })).status).toBe(403);
  });
});
