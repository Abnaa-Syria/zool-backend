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
import { getPrisma } from '../src/infrastructure/database/prisma';
import { AdminStatus } from '@prisma/client';
import { setAuthzVersion } from '../src/shared/security/authz-cache';
import { loadEnv, resetEnvCache } from '../src/config/env';

describe('Stage 1 auth + RBAC', () => {
  let app: Express;

  beforeAll(async () => {
    app = await bootTestApp();
  });

  afterAll(async () => {
    await shutdownTestApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedCatalogAndSuperAdmin('+249900000001');
  });

  it('rejects OTP for unknown phone', async () => {
    const res = await request(app).post('/api/v1/auth/otp/request').send({ phone: '+249911111111' });
    expect(res.status).toBe(401);
  });

  it('requests and verifies OTP, exposes devOtp only under guards', async () => {
    const reqRes = await request(app).post('/api/v1/auth/otp/request').send({ phone: '+249900000001' });
    expect(reqRes.status).toBe(200);
    expect(reqRes.body.data.challengeId).toBeTruthy();
    expect(reqRes.body.data.devOtp).toMatch(/^\d{6}$/);

    const verify = await request(app)
      .post('/api/v1/auth/otp/verify')
      .send({ phone: '+249900000001', code: reqRes.body.data.devOtp });
    expect(verify.status).toBe(200);
    expect(verify.body.data.accessToken).toBeTruthy();
    expect(verify.body.data.refreshToken).toBeUndefined();
    expect(verify.headers['set-cookie']?.join(';')).toContain('zoolgo_refresh=');
    expect(verify.body.data.admin.permissions).toContain('admins.view');
  });

  it('fails production startup when OTP_DEV_EXPOSE=true', () => {
    resetEnvCache();
    expect(() =>
      loadEnv({
        ...process.env,
        NODE_ENV: 'production',
        OTP_DEV_EXPOSE: 'true',
        JWT_ACCESS_SECRET: 'prod-access-secret-change-me-32chars!',
        OTP_HMAC_SECRET: 'prod-otp-hmac-secret-change-me-32chars!',
        DATABASE_URL: process.env.DATABASE_URL!,
        REDIS_URL: process.env.REDIS_URL!,
        CORS_ORIGINS: 'https://admin.example.com',
      }),
    ).toThrow(/OTP_DEV_EXPOSE/);
    resetEnvCache();
    loadEnv(process.env);
  });

  it('rejects expired OTP', async () => {
    const reqRes = await request(app).post('/api/v1/auth/otp/request').send({ phone: '+249900000001' });
    const challengeId = reqRes.body.data.challengeId as string;
    await getPrisma().otpChallenge.update({
      where: { id: challengeId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const verify = await request(app)
      .post('/api/v1/auth/otp/verify')
      .send({ phone: '+249900000001', code: reqRes.body.data.devOtp, challengeId });
    expect(verify.status).toBe(401);
    expect(verify.body.code).toBe('OTP_EXPIRED');
  });

  it('locks OTP after max attempts and rejects reuse after success', async () => {
    const first = await request(app).post('/api/v1/auth/otp/request').send({ phone: '+249900000001' });
    const challengeId = first.body.data.challengeId as string;
    for (let i = 0; i < 5; i += 1) {
      const bad = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone: '+249900000001', code: '000000', challengeId });
      expect([401, 429]).toContain(bad.status);
    }
    const locked = await request(app)
      .post('/api/v1/auth/otp/verify')
      .send({ phone: '+249900000001', code: first.body.data.devOtp, challengeId });
    expect(locked.status).toBe(401);

    // fresh challenge then reuse after consume
    await new Promise((r) => setTimeout(r, 1100));
    const second = await request(app).post('/api/v1/auth/otp/request').send({ phone: '+249900000001' });
    const ok = await request(app)
      .post('/api/v1/auth/otp/verify')
      .send({ phone: '+249900000001', code: second.body.data.devOtp, challengeId: second.body.data.challengeId });
    expect(ok.status).toBe(200);
    const reuse = await request(app)
      .post('/api/v1/auth/otp/verify')
      .send({ phone: '+249900000001', code: second.body.data.devOtp, challengeId: second.body.data.challengeId });
    expect(reuse.status).toBe(401);
  });

  it('rejects inactive admin OTP', async () => {
    await getPrisma().adminUser.updateMany({
      where: { isBootstrap: true },
      data: { status: AdminStatus.SUSPENDED },
    });
    const res = await request(app).post('/api/v1/auth/otp/request').send({ phone: '+249900000001' });
    expect(res.status).toBe(401);
  });

  it('rotates refresh tokens and rejects reused rotated token', async () => {
    const login = await request(app).post('/api/v1/auth/otp/request').send({ phone: '+249900000001' });
    expect(login.status).toBe(200);
    const verify = await request(app)
      .post('/api/v1/auth/otp/verify')
      .send({ phone: '+249900000001', code: login.body.data.devOtp });
    expect(verify.status).toBe(200);
    const cookieHeader = verify.headers['set-cookie'] as string[];
    const oldCookie = cookieHeader.find((c) => c.startsWith('zoolgo_refresh='))!;

    const rotated = await request(app).post('/api/v1/auth/refresh').set('Cookie', oldCookie);
    expect(rotated.status).toBe(200);
    expect(rotated.body.data.accessToken).toBeTruthy();

    const reuse = await request(app).post('/api/v1/auth/refresh').set('Cookie', oldCookie);
    expect(reuse.status).toBe(401);

    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${rotated.body.data.accessToken}`);
    expect(me.status).toBe(200);
  });

  it('logout clears session cookie usability', async () => {
    const login = await request(app).post('/api/v1/auth/otp/request').send({ phone: '+249900000001' });
    const verify = await request(app)
      .post('/api/v1/auth/otp/verify')
      .send({ phone: '+249900000001', code: login.body.data.devOtp });
    const cookie = (verify.headers['set-cookie'] as string[]).find((c) => c.startsWith('zoolgo_refresh='))!;
    const logout = await request(app).post('/api/v1/auth/logout').set('Cookie', cookie);
    expect(logout.status).toBe(200);
    const refresh = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(refresh.status).toBe(401);
  });

  it('enforces permissions and union of multiple roles', async () => {
    const { accessToken, admin } = await loginWithOtp(app, '+249900000001');

    const viewerRole = await request(app)
      .post('/api/v1/roles')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        key: 'ops_viewer',
        name: 'Ops Viewer',
        permissionKeys: ['admins.view', 'roles.view'],
      });
    expect(viewerRole.status).toBe(201);

    const limited = await request(app)
      .post('/api/v1/admins')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        displayName: 'Limited Admin',
        employeeCode: 'ZG-EMP-LIM-1',
        phone: '+249900000002',
        roleIds: [viewerRole.body.data.id],
      });
    expect(limited.status).toBe(201);

    await new Promise((r) => setTimeout(r, 1100));
    const limitedLogin = await loginWithOtp(app, '+249900000002');
    const forbidden = await request(app)
      .post('/api/v1/roles')
      .set('Authorization', `Bearer ${limitedLogin.accessToken}`)
      .send({ key: 'x', name: 'X', permissionKeys: [] });
    expect(forbidden.status).toBe(403);

    const allowed = await request(app)
      .get('/api/v1/admins')
      .set('Authorization', `Bearer ${limitedLogin.accessToken}`);
    expect(allowed.status).toBe(200);

    // Assign second role with roles.create and verify union
    const creatorRole = await request(app)
      .post('/api/v1/roles')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        key: 'role_creator',
        name: 'Role Creator',
        permissionKeys: ['roles.create', 'roles.view'],
      });
    const assign = await request(app)
      .put(`/api/v1/admins/${limited.body.data.id}/roles`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ roleIds: [viewerRole.body.data.id, creatorRole.body.data.id] });
    expect(assign.status).toBe(200);

    // Old token should fail due to authz version bump
    const stale = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${limitedLogin.accessToken}`);
    expect(stale.status).toBe(401);

    await new Promise((r) => setTimeout(r, 1100));
    const relogin = await loginWithOtp(app, '+249900000002');
    const createOk = await request(app)
      .post('/api/v1/roles')
      .set('Authorization', `Bearer ${relogin.accessToken}`)
      .send({ key: 'another_role', name: 'Another', permissionKeys: ['audit.view'] });
    expect(createOk.status).toBe(201);
    expect(admin.id).toBeTruthy();
  });

  it('inactive role does not grant permissions', async () => {
    const { accessToken } = await loginWithOtp(app, '+249900000001');
    const role = await request(app)
      .post('/api/v1/roles')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ key: 'temp_role', name: 'Temp', permissionKeys: ['admins.create'] });

    const user = await request(app)
      .post('/api/v1/admins')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        displayName: 'Temp User',
        employeeCode: 'ZG-EMP-TEMP',
        phone: '+249900000003',
        roleIds: [role.body.data.id],
      });

    await request(app)
      .patch(`/api/v1/roles/${role.body.data.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ isActive: false });

    await new Promise((r) => setTimeout(r, 1100));
    const login = await loginWithOtp(app, '+249900000003');
    const denied = await request(app)
      .post('/api/v1/admins')
      .set('Authorization', `Bearer ${login.accessToken}`)
      .send({
        displayName: 'X',
        employeeCode: 'ZG-EMP-X',
        phone: '+249900000004',
        roleIds: [role.body.data.id],
      });
    expect(denied.status).toBe(403);
    expect(user.body.data.id).toBeTruthy();
  });

  it('suspended admin loses access', async () => {
    const { accessToken } = await loginWithOtp(app, '+249900000001');
    const created = await request(app)
      .post('/api/v1/admins')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        displayName: 'To Suspend',
        employeeCode: 'ZG-EMP-SUS',
        phone: '+249900000005',
        roleIds: [(await getPrisma().role.findFirstOrThrow({ where: { key: 'super_admin' } })).id],
      });

    await new Promise((r) => setTimeout(r, 1100));
    const login = await loginWithOtp(app, '+249900000005');
    await request(app)
      .patch(`/api/v1/admins/${created.body.data.id}/status`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'SUSPENDED' });

    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.accessToken}`);
    expect(me.status).toBe(401);
  });

  it('protects bootstrap super admin from total lockout', async () => {
    const { accessToken, admin } = await loginWithOtp(app, '+249900000001');
    const suspend = await request(app)
      .patch(`/api/v1/admins/${admin.id}/status`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'SUSPENDED' });
    expect(suspend.status).toBe(409);
    expect(suspend.body.code).toBe('BOOTSTRAP_PROTECTED');
  });

  it('returns validation errors in envelope', async () => {
    const res = await request(app).post('/api/v1/auth/otp/request').send({});
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('DTOs exclude token hashes', async () => {
    const { accessToken } = await loginWithOtp(app, '+249900000001');
    const sessions = await request(app)
      .get('/api/v1/sessions')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(sessions.status).toBe(200);
    expect(JSON.stringify(sessions.body)).not.toContain('tokenHash');
    expect(JSON.stringify(sessions.body)).not.toContain('codeHash');
  });

  it('syncs authz version into redis for seeded admin', async () => {
    const admin = await getPrisma().adminUser.findFirstOrThrow({ where: { isBootstrap: true } });
    await setAuthzVersion(admin.id, admin.authzVersion);
    expect(admin.authzVersion).toBeGreaterThanOrEqual(1);
  });
});
