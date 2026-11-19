import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import {
  bootTestApp,
  shutdownTestApp,
  resetDatabase,
  seedCatalogAndSuperAdmin,
  loginWithOtp,
} from './helpers/app';
import { getPrisma } from '../src/infrastructure/database/prisma';
import { errorHandler, notFoundHandler } from '../src/shared/middleware/error-handler';
import { asyncHandler } from '../src/shared/middleware/async-handler';
import { requestIdMiddleware } from '../src/shared/middleware/request-id';
import { resetEnvCache, loadEnv } from '../src/config/env';

describe('Unified HTTP envelopes', () => {
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

  it('successful endpoint uses the standard success envelope with requestId', async () => {
    const res = await request(app).get('/api/v1/health').set('x-request-id', 'req-health-1');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      statusCode: 200,
      message: expect.any(String),
      data: expect.objectContaining({ status: 'ok' }),
      meta: expect.objectContaining({ requestId: 'req-health-1' }),
    });
    expect(res.headers['x-request-id']).toBe('req-health-1');
  });

  it('created resource returns 201 envelope', async () => {
    const { accessToken } = await loginWithOtp(app, '+249900000001');
    const res = await request(app)
      .post('/api/v1/roles')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('x-request-id', 'req-create-1')
      .send({ key: 'envelope_role', name: 'Envelope Role', permissionKeys: ['roles.view'] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      success: true,
      statusCode: 201,
      message: expect.any(String),
      data: expect.objectContaining({ key: 'envelope_role' }),
      meta: expect.objectContaining({ requestId: 'req-create-1' }),
    });
  });

  it('missing authentication returns standard 401 envelope', async () => {
    const res = await request(app).get('/api/v1/roles').set('x-request-id', 'req-auth-1');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      success: false,
      statusCode: 401,
      code: 'AUTHENTICATION_REQUIRED',
      message: expect.any(String),
      requestId: 'req-auth-1',
    });
    expect(res.body.error).toBeUndefined();
    expect(res.body.stack).toBeUndefined();
  });

  it('missing permission returns standard 403 envelope', async () => {
    const { accessToken } = await loginWithOtp(app, '+249900000001');
    const viewer = await request(app)
      .post('/api/v1/roles')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ key: 'viewer_only', name: 'Viewer', permissionKeys: ['admins.view'] });
    const limited = await request(app)
      .post('/api/v1/admins')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        displayName: 'Viewer Admin',
        employeeCode: 'ZG-EMP-VIEW',
        phone: '+249900000010',
        roleIds: [viewer.body.data.id],
      });
    expect(limited.status).toBe(201);
    await new Promise((r) => setTimeout(r, 1100));
    const login = await loginWithOtp(app, '+249900000010');
    const res = await request(app)
      .post('/api/v1/roles')
      .set('Authorization', `Bearer ${login.accessToken}`)
      .send({ key: 'nope', name: 'Nope', permissionKeys: [] });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      success: false,
      statusCode: 403,
      code: 'PERMISSION_DENIED',
      requestId: expect.any(String),
    });
  });

  it('missing entity returns standard 404 envelope', async () => {
    const { accessToken } = await loginWithOtp(app, '+249900000001');
    const res = await request(app)
      .get('/api/v1/roles/00000000-0000-4000-8000-000000000099')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      success: false,
      statusCode: 404,
      code: expect.stringMatching(/NOT_FOUND/),
    });
  });

  it('unknown route returns ROUTE_NOT_FOUND envelope', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      success: false,
      statusCode: 404,
      code: 'ROUTE_NOT_FOUND',
      requestId: expect.any(String),
    });
  });

  it('duplicate unique resource returns standard 409 envelope', async () => {
    const { accessToken } = await loginWithOtp(app, '+249900000001');
    const role = await getPrisma().role.findFirstOrThrow({ where: { key: 'super_admin' } });
    const first = await request(app)
      .post('/api/v1/admins')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        displayName: 'Dup',
        employeeCode: 'ZG-EMP-DUP',
        phone: '+249900000011',
        roleIds: [role.id],
      });
    expect(first.status).toBe(201);
    const dup = await request(app)
      .post('/api/v1/admins')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        displayName: 'Dup2',
        employeeCode: 'ZG-EMP-DUP',
        phone: '+249900000012',
        roleIds: [role.id],
      });
    expect(dup.status).toBe(409);
    expect(dup.body).toMatchObject({
      success: false,
      statusCode: 409,
      code: 'CONFLICT',
    });
  });

  it('Zod validation returns standard 422 envelope', async () => {
    const res = await request(app)
      .post('/api/v1/auth/otp/request')
      .set('x-request-id', 'req-val-1')
      .send({});
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      success: false,
      statusCode: 422,
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      requestId: 'req-val-1',
      details: expect.any(Array),
    });
    expect(res.body.details[0]).toEqual(
      expect.objectContaining({ path: expect.any(String), message: expect.any(String) }),
    );
  });

  it('malformed JSON returns standard 400 envelope', async () => {
    const res = await request(app)
      .post('/api/v1/auth/otp/request')
      .set('Content-Type', 'application/json')
      .set('x-request-id', 'req-json-1')
      .send('{"phone":');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      statusCode: 400,
      code: 'MALFORMED_JSON',
      requestId: 'req-json-1',
    });
  });

  it('unknown error returns safe 500 without stack (production)', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevOtpExpose = process.env.OTP_DEV_EXPOSE;
    process.env.NODE_ENV = 'production';
    process.env.OTP_DEV_EXPOSE = 'false';
    resetEnvCache();
    loadEnv(process.env);

    const probe = express();
    probe.use(express.json());
    probe.use(requestIdMiddleware);
    probe.get(
      '/boom',
      asyncHandler(async () => {
        throw new Error('secret boom details');
      }),
    );
    probe.use(notFoundHandler);
    probe.use(errorHandler);

    const res = await request(probe).get('/boom').set('x-request-id', 'req-500-1');
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({
      success: false,
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
      requestId: 'req-500-1',
    });
    expect(JSON.stringify(res.body)).not.toContain('secret boom');
    expect(res.body.stack).toBeUndefined();

    process.env.NODE_ENV = prevNodeEnv;
    process.env.OTP_DEV_EXPOSE = prevOtpExpose;
    resetEnvCache();
    loadEnv(process.env);
  });

  it('rate limit errors use standard 429 envelope', async () => {
    const { RateLimitError } = await import('../src/shared/errors/app-error');
    const probe = express();
    probe.use(requestIdMiddleware);
    probe.get('/limited', (_req, _res, next) => {
      next(new RateLimitError({ message: 'Too many OTP requests' }));
    });
    probe.use(errorHandler);

    const res = await request(probe).get('/limited').set('x-request-id', 'req-429-1');
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({
      success: false,
      statusCode: 429,
      code: 'RATE_LIMITED',
      message: 'Too many OTP requests',
      requestId: 'req-429-1',
    });
  });
});
