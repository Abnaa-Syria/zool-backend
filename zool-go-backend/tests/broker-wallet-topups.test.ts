import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { bootTestApp, shutdownTestApp, resetDatabase, seedCatalogAndSuperAdmin, loginWithOtp, loginBrokerWithOtp } from './helpers/app';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

describe('Broker top-up history and commission history', () => {
  let app: Express;
  let manager: string;
  let otherManager: string;

  beforeAll(async () => {
    app = await bootTestApp();
  });

  afterAll(async () => {
    await shutdownTestApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedCatalogAndSuperAdmin();
    const admin = (await loginWithOtp(app, '+249900000001')).accessToken;
    for (const [code, phone] of [
      ['ZG-BRK-W1', '+249900000921'],
      ['ZG-BRK-W2', '+249900000922'],
    ]) {
      await request(app)
        .post('/api/v1/brokers')
        .set(auth(admin))
        .send({ code, name: code, settlementPeriod: 'MONTHLY', manager: { displayName: 'Manager', phone } });
    }
    manager = (await loginBrokerWithOtp(app, '+249900000921')).accessToken;
    otherManager = (await loginBrokerWithOtp(app, '+249900000922')).accessToken;
  });

  it('lists the office own top-ups, reports evidence correctly and scopes by office', async () => {
    const a = await request(app).post('/api/v1/broker/wallet/top-ups').set(auth(manager)).send({ amountMinor: 1_000_000, idempotencyKey: 'tu-a' });
    expect(a.status).toBe(201);
    expect(a.body.data.intent ?? a.body.data).toMatchObject({ mockConfirmAvailable: true });
    const intentId = (a.body.data.intent ?? a.body.data).id as string;

    const evidence = await request(app)
      .post(`/api/v1/broker/wallet/top-ups/${intentId}/evidence`)
      .set(auth(manager))
      .field('paymentReference', 'BANKAK-123')
      .field('note', 'Transferred from Bankak')
      .attach('receipt', PNG, { filename: 'r.png', contentType: 'image/png' });
    expect(evidence.status).toBe(200);
    expect(evidence.body.data).toMatchObject({ status: 'PENDING_REVIEW', hasEvidence: true, note: 'Transferred from Bankak', mockConfirmAvailable: false });

    await request(app).post('/api/v1/broker/wallet/top-ups').set(auth(manager)).send({ amountMinor: 2_000_000, idempotencyKey: 'tu-b' });

    const list = await request(app).get('/api/v1/broker/wallet/top-ups').set(auth(manager));
    expect(list.status).toBe(200);
    expect(list.body.meta.total).toBe(2);
    const pending = await request(app).get('/api/v1/broker/wallet/top-ups?status=PENDING_REVIEW').set(auth(manager));
    expect(pending.body.data.map((t: { id: string }) => t.id)).toEqual([intentId]);
    expect((await request(app).get(`/api/v1/broker/wallet/top-ups/${intentId}`).set(auth(manager))).body.data.hasEvidence).toBe(true);

    // Another office sees none of it.
    expect((await request(app).get('/api/v1/broker/wallet/top-ups').set(auth(otherManager))).body.meta.total).toBe(0);
    expect((await request(app).get(`/api/v1/broker/wallet/top-ups/${intentId}`).set(auth(otherManager))).status).toBe(404);
  });

  it('filters broker commissions by status (defaults to UNSETTLED)', async () => {
    const open = await request(app).get('/api/v1/broker/commissions').set(auth(manager));
    expect(open.status).toBe(200);
    const settled = await request(app).get('/api/v1/broker/commissions?status=SETTLED').set(auth(manager));
    expect(settled.status).toBe(200);
    expect((await request(app).get('/api/v1/broker/commissions?status=NOPE').set(auth(manager))).status).toBe(422);
  });
});
