import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  bootTestApp,
  shutdownTestApp,
  resetDatabase,
  seedCatalogAndSuperAdmin,
  loginWithOtp,
} from './helpers/app';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Admin self-service phone change', () => {
  let app: Express;
  let adminToken: string;

  beforeAll(async () => {
    app = await bootTestApp();
  });

  afterAll(async () => {
    await shutdownTestApp();
  });

  async function limitedAdmin(phone: string, employeeCode: string, permissionKeys: string[]) {
    const role = await request(app)
      .post('/api/v1/roles')
      .set(auth(adminToken))
      .send({
        key: `role_${employeeCode.toLowerCase().replace(/-/g, '_')}`,
        name: employeeCode,
        permissionKeys,
      });
    expect(role.status).toBe(201);
    const created = await request(app)
      .post('/api/v1/admins')
      .set(auth(adminToken))
      .send({
        displayName: employeeCode,
        employeeCode,
        phone,
        roleIds: [role.body.data.id],
      });
    expect(created.status).toBe(201);
    await new Promise((r) => setTimeout(r, 1100));
    const login = await loginWithOtp(app, phone);
    return { token: login.accessToken, id: created.body.data.id as string, phone };
  }

  beforeEach(async () => {
    await resetDatabase();
    await seedCatalogAndSuperAdmin();
    const superLogin = await loginWithOtp(app, '+249900000001');
    adminToken = superLogin.accessToken;
  });

  it('rejects unauthenticated phone-change OTP request', async () => {
    const res = await request(app)
      .post('/api/v1/auth/phone/otp/request')
      .send({ phone: '+249900000610' });
    expect(res.status).toBe(401);
  });

  it('rejects PATCH phone on another admin even with admins.update', async () => {
    const other = await limitedAdmin('+249900000611', 'ZG-EMP-PH1', ['admins.view']);
    const res = await request(app)
      .patch(`/api/v1/admins/${other.id}`)
      .set(auth(adminToken))
      .send({ phone: '+249900000612' });
    expect(res.status).toBe(422);

    const mixed = await request(app)
      .patch(`/api/v1/admins/${other.id}`)
      .set(auth(adminToken))
      .send({ displayName: 'Still Named', phone: '+249900000612' });
    expect(mixed.status).toBe(422);

    const me = await request(app).get(`/api/v1/admins/${other.id}`).set(auth(adminToken));
    expect(me.body.data.identities[0].value).toBe('+249900000611');
  });

  it('updates identity only after OTP on the new number; old phone cannot login', async () => {
    const actor = await limitedAdmin('+249900000613', 'ZG-EMP-PH2', ['admins.view']);
    const nextPhone = '+249900000614';

    const reqRes = await request(app)
      .post('/api/v1/auth/phone/otp/request')
      .set(auth(actor.token))
      .send({ phone: nextPhone });
    expect(reqRes.status).toBe(200);
    expect(reqRes.body.data.challengeId).toBeTruthy();
    expect(reqRes.body.data.devOtp).toMatch(/^\d{6}$/);
    expect(reqRes.body.data.accessToken).toBeUndefined();

    const verify = await request(app)
      .post('/api/v1/auth/phone/otp/verify')
      .set(auth(actor.token))
      .send({
        phone: nextPhone,
        code: reqRes.body.data.devOtp,
        challengeId: reqRes.body.data.challengeId,
      });
    expect(verify.status).toBe(200);
    expect(verify.body.data.accessToken).toBeUndefined();
    expect(verify.body.data.id).toBe(actor.id);
    expect(
      verify.body.data.identities.some(
        (i: { type: string; value: string; isPrimary: boolean }) =>
          i.type === 'PHONE' && i.value === nextPhone && i.isPrimary,
      ),
    ).toBe(true);

    const me = await request(app).get('/api/v1/auth/me').set(auth(actor.token));
    expect(me.status).toBe(200);
    expect(me.body.data.identities[0].value).toBe(nextPhone);

    await new Promise((r) => setTimeout(r, 1100));
    const newLogin = await loginWithOtp(app, nextPhone);
    expect(newLogin.admin.id).toBe(actor.id);

    const oldOtp = await request(app).post('/api/v1/auth/otp/request').send({ phone: actor.phone });
    expect(oldOtp.status).toBe(401);
  });

  it('rejects a new phone already registered to another admin', async () => {
    const actor = await limitedAdmin('+249900000615', 'ZG-EMP-PH3', ['admins.view']);
    const res = await request(app)
      .post('/api/v1/auth/phone/otp/request')
      .set(auth(actor.token))
      .send({ phone: '+249900000001' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFLICT');
  });

  it('rejects the current phone and a wrong OTP without changing identity', async () => {
    const actor = await limitedAdmin('+249900000616', 'ZG-EMP-PH4', ['admins.view']);

    const same = await request(app)
      .post('/api/v1/auth/phone/otp/request')
      .set(auth(actor.token))
      .send({ phone: actor.phone });
    expect(same.status).toBe(422);

    const reqRes = await request(app)
      .post('/api/v1/auth/phone/otp/request')
      .set(auth(actor.token))
      .send({ phone: '+249900000617' });
    expect(reqRes.status).toBe(200);

    const bad = await request(app)
      .post('/api/v1/auth/phone/otp/verify')
      .set(auth(actor.token))
      .send({
        phone: '+249900000617',
        code: '000000',
        challengeId: reqRes.body.data.challengeId,
      });
    expect(bad.status).toBe(401);
    expect(bad.body.code).toBe('OTP_INVALID');

    const me = await request(app).get('/api/v1/auth/me').set(auth(actor.token));
    expect(me.body.data.identities[0].value).toBe(actor.phone);
  });

  it('does not allow another admin to consume the challenge', async () => {
    const owner = await limitedAdmin('+249900000618', 'ZG-EMP-PH5', ['admins.view']);
    const other = await limitedAdmin('+249900000619', 'ZG-EMP-PH6', ['admins.update']);
    const nextPhone = '+249900000620';

    const reqRes = await request(app)
      .post('/api/v1/auth/phone/otp/request')
      .set(auth(owner.token))
      .send({ phone: nextPhone });
    expect(reqRes.status).toBe(200);

    const stolen = await request(app)
      .post('/api/v1/auth/phone/otp/verify')
      .set(auth(other.token))
      .send({
        phone: nextPhone,
        code: reqRes.body.data.devOtp,
        challengeId: reqRes.body.data.challengeId,
      });
    expect(stolen.status).toBe(401);
    expect(stolen.body.code).toBe('OTP_INVALID');

    const ownerMe = await request(app).get('/api/v1/auth/me').set(auth(owner.token));
    expect(ownerMe.body.data.identities[0].value).toBe(owner.phone);
  });
});
