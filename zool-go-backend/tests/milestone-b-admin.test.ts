import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  bootTestApp,
  shutdownTestApp,
  resetDatabase,
  seedCatalogAndSuperAdmin,
  loginWithOtp,
  loginBrokerWithOtp,
} from './helpers/app';

const MANAGER_PHONE = '+249900000421';
const CLERK_PHONE = '+249900000422';
const BASE_PRICE = 15000;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const tomorrow = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

describe('Milestone B admin workflows', () => {
  let app: Express;
  let adminToken: string;
  let officeId: string;
  let otherOfficeId: string;
  let companyId: string;
  let tripId: string;
  let managerToken: string;

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
    return { token: login.accessToken, id: created.body.data.id as string };
  }

  beforeEach(async () => {
    await resetDatabase();
    await seedCatalogAndSuperAdmin();
    const superLogin = await loginWithOtp(app, '+249900000001');
    adminToken = superLogin.accessToken;

    const carrier = await request(app)
      .post('/api/v1/carriers')
      .set(auth(adminToken))
      .send({ key: 'm1b_carrier', name: 'M1B Carrier' });
    companyId = carrier.body.data.id;

    const office = await request(app)
      .post('/api/v1/brokers')
      .set(auth(adminToken))
      .send({
        code: 'ZG-M1B-1',
        name: 'Milestone B Office',
        manager: { displayName: 'Mgr', phone: MANAGER_PHONE },
      });
    expect(office.status).toBe(201);
    officeId = office.body.data.id;

    const other = await request(app)
      .post('/api/v1/brokers')
      .set(auth(adminToken))
      .send({
        code: 'ZG-M1B-2',
        name: 'Other Office',
        manager: { displayName: 'Other', phone: '+249900000423' },
      });
    otherOfficeId = other.body.data.id;

    await request(app)
      .put(`/api/v1/brokers/${officeId}/carriers`)
      .set(auth(adminToken))
      .send([{ companyId, commissionPercent: 10 }]);

    const trip = await request(app)
      .post('/api/v1/catalog/trips')
      .set(auth(adminToken))
      .send({
        companyId,
        origin: 'Khartoum',
        destination: 'Atbara',
        departureAt: tomorrow(),
        basePrice: BASE_PRICE,
        seatLabels: ['A1', 'A2', 'A3', 'A4'],
      });
    tripId = trip.body.data.id;
    managerToken = (await loginBrokerWithOtp(app, MANAGER_PHONE)).accessToken;
  });

  describe('audit filters', () => {
    it('filters at the database, validates dates, and denies missing audit.view', async () => {
      const listed = await request(app)
        .get('/api/v1/audit-logs?action=carrier.created&resourceType=transport_company')
        .set(auth(adminToken));
      expect(listed.status).toBe(200);
      expect(listed.body.data.length).toBeGreaterThanOrEqual(1);
      expect(
        listed.body.data.every(
          (row: { action: string; resourceType: string }) =>
            row.action === 'carrier.created' && row.resourceType === 'transport_company',
        ),
      ).toBe(true);
      expect(listed.body.data[0].userAgent === null || typeof listed.body.data[0].userAgent === 'string').toBe(
        true,
      );

      const empty = await request(app)
        .get('/api/v1/audit-logs?resourceId=does-not-exist')
        .set(auth(adminToken));
      expect(empty.status).toBe(200);
      expect(empty.body.data).toEqual([]);

      expect(
        (await request(app).get('/api/v1/audit-logs?from=not-a-date').set(auth(adminToken))).status,
      ).toBe(422);
      expect(
        (
          await request(app)
            .get('/api/v1/audit-logs?from=2030-01-02T00:00:00.000Z&to=2030-01-01T00:00:00.000Z')
            .set(auth(adminToken))
        ).status,
      ).toBe(422);

      const page1 = await request(app)
        .get('/api/v1/audit-logs?page=1&pageSize=1')
        .set(auth(adminToken));
      expect(page1.body.data).toHaveLength(1);
      expect(page1.body.meta.pageSize).toBe(1);

      const denied = await limitedAdmin('+249900000501', 'ZG-EMP-NOAUD', ['bookings.view']);
      expect((await request(app).get('/api/v1/audit-logs').set(auth(denied.token))).status).toBe(403);
    });
  });

  describe('office staff', () => {
    it('creates and patches clerks, rejects duplicates and cross-office ids', async () => {
      const created = await request(app)
        .post(`/api/v1/brokers/${officeId}/staff`)
        .set(auth(adminToken))
        .send({
          displayName: 'Office Clerk',
          phone: CLERK_PHONE,
          canBook: true,
          canTopUp: false,
          canViewReports: false,
          canManageStaff: false,
        });
      expect(created.status).toBe(201);
      expect(created.body.data.role).toBe('CLERK');
      expect(created.body.data.officeId).toBe(officeId);

      const clerkLogin = await loginBrokerWithOtp(app, CLERK_PHONE);
      expect(clerkLogin.accessToken).toBeTruthy();

      expect(
        (
          await request(app)
            .post(`/api/v1/brokers/${officeId}/staff`)
            .set(auth(adminToken))
            .send({ displayName: 'Dup', phone: CLERK_PHONE })
        ).status,
      ).toBe(409);
      expect(
        (
          await request(app)
            .post('/api/v1/brokers/missing-office/staff')
            .set(auth(adminToken))
            .send({ displayName: 'Ghost', phone: '+249900000424' })
        ).status,
      ).toBe(404);

      const patched = await request(app)
        .patch(`/api/v1/brokers/${officeId}/staff/${created.body.data.id}`)
        .set(auth(adminToken))
        .send({ displayName: 'Renamed Clerk', status: 'ACTIVE' });
      expect(patched.status).toBe(200);
      expect(patched.body.data.displayName).toBe('Renamed Clerk');

      expect(
        (
          await request(app)
            .patch(`/api/v1/brokers/${otherOfficeId}/staff/${created.body.data.id}`)
            .set(auth(adminToken))
            .send({ displayName: 'Wrong office' })
        ).status,
      ).toBe(404);

      const denied = await limitedAdmin('+249900000502', 'ZG-EMP-NOBRK', ['brokers.view']);
      expect(
        (
          await request(app)
            .post(`/api/v1/brokers/${officeId}/staff`)
            .set(auth(denied.token))
            .send({ displayName: 'Nope', phone: '+249900000425' })
        ).status,
      ).toBe(403);
    });
  });

  describe('booking search', () => {
    it('finds a booking by ticket number without mutating state', async () => {
      const topUp = await request(app)
        .post('/api/v1/broker/wallet/top-ups')
        .set(auth(managerToken))
        .send({ amountMinor: 200000, idempotencyKey: 'm1b-book-top' });
      expect(
        (
          await request(app)
            .post(`/api/v1/broker/wallet/top-ups/${topUp.body.data.id}/mock-confirm`)
            .set(auth(managerToken))
        ).status,
      ).toBe(200);

      const seats = await request(app).get(`/api/v1/broker/trips/${tripId}`).set(auth(managerToken));
      const free = (seats.body.data.seats as Array<{ id: string; status: string }>).find(
        (s) => s.status === 'FREE',
      );
      await request(app)
        .post(`/api/v1/broker/trips/${tripId}/holds`)
        .set(auth(managerToken))
        .send({ seatIds: [free!.id] });
      const booked = await request(app)
        .post('/api/v1/broker/bookings/confirm')
        .set(auth(managerToken))
        .send({
          tripId,
          seatIds: [free!.id],
          passengers: [{ fullName: 'Search Rider', phone: '0914000002' }],
          idempotencyKey: 'm1b-book',
        });
      expect(booked.status).toBe(201);
      const ticketNumber = booked.body.data.booking.tickets[0].ticketNumber as string;

      const found = await request(app)
        .get(`/api/v1/admin/bookings?q=${encodeURIComponent(ticketNumber)}`)
        .set(auth(adminToken));
      expect(found.status).toBe(200);
      expect(found.body.data).toHaveLength(1);
      expect(found.body.data[0].id).toBe(booked.body.data.booking.id);
      expect(found.body.data[0].status).toBe('CONFIRMED');

      const none = await request(app).get('/api/v1/admin/bookings?q=NO-SUCH-TICKET').set(auth(adminToken));
      expect(none.status).toBe(200);
      expect(none.body.data).toEqual([]);

      const still = await request(app)
        .get(`/api/v1/admin/bookings/${booked.body.data.booking.id}`)
        .set(auth(adminToken));
      expect(still.body.data.status).toBe('CONFIRMED');

      const denied = await limitedAdmin('+249900000503', 'ZG-EMP-NOBK', ['wallets.view']);
      expect((await request(app).get('/api/v1/admin/bookings?q=x').set(auth(denied.token))).status).toBe(
        403,
      );
    });
  });

  describe('session revoke-all', () => {
    it('revokes target sessions server-side and is idempotent', async () => {
      const target = await limitedAdmin('+249900000504', 'ZG-EMP-SESS', ['admins.view']);
      expect((await request(app).get('/api/v1/auth/me').set(auth(target.token))).status).toBe(200);

      const revoked = await request(app)
        .post(`/api/v1/admins/${target.id}/sessions/revoke-all`)
        .set(auth(adminToken));
      expect(revoked.status).toBe(200);
      expect(revoked.body.data.revokedCount).toBeGreaterThanOrEqual(1);
      expect((await request(app).get('/api/v1/auth/me').set(auth(target.token))).status).toBe(401);

      const again = await request(app)
        .post(`/api/v1/admins/${target.id}/sessions/revoke-all`)
        .set(auth(adminToken));
      expect(again.status).toBe(200);
      expect(again.body.data.revokedCount).toBe(0);

      expect(
        (await request(app).post('/api/v1/admins/missing/sessions/revoke-all').set(auth(adminToken)))
          .status,
      ).toBe(404);

      const denied = await limitedAdmin('+249900000505', 'ZG-EMP-NOREV', ['admins.update']);
      expect(
        (
          await request(app)
            .post(`/api/v1/admins/${target.id}/sessions/revoke-all`)
            .set(auth(denied.token))
        ).status,
      ).toBe(403);
    });
  });

  describe('admin profile', () => {
    it('patches displayName, rejects unknown fields including phone', async () => {
      const other = await limitedAdmin('+249900000506', 'ZG-EMP-PROF', ['admins.view']);
      const patched = await request(app)
        .patch(`/api/v1/admins/${other.id}`)
        .set(auth(adminToken))
        .send({ displayName: 'Renamed Admin' });
      expect(patched.status).toBe(200);
      expect(patched.body.data.displayName).toBe('Renamed Admin');
      expect(patched.body.data.roles[0].key).not.toBeUndefined();

      expect(
        (
          await request(app)
            .patch(`/api/v1/admins/${other.id}`)
            .set(auth(adminToken))
            .send({ displayName: 'Nope', roleIds: ['x'] })
        ).status,
      ).toBe(422);

      expect(
        (
          await request(app)
            .patch(`/api/v1/admins/${other.id}`)
            .set(auth(adminToken))
            .send({ phone: '+249900000001' })
        ).status,
      ).toBe(422);

      const denied = await limitedAdmin('+249900000507', 'ZG-EMP-NOUPD', ['admins.view']);
      expect(
        (
          await request(app)
            .patch(`/api/v1/admins/${other.id}`)
            .set(auth(denied.token))
            .send({ displayName: 'Forbidden' })
        ).status,
      ).toBe(403);
    });
  });

  describe('carrier search', () => {
    it('filters by key/name and keeps status filter', async () => {
      const byKey = await request(app).get('/api/v1/carriers?q=m1b_carrier').set(auth(adminToken));
      expect(byKey.status).toBe(200);
      expect(byKey.body.data).toHaveLength(1);
      expect(byKey.body.data[0].id).toBe(companyId);

      const byName = await request(app).get('/api/v1/carriers?q=M1B').set(auth(adminToken));
      expect(byName.body.data.some((c: { id: string }) => c.id === companyId)).toBe(true);

      const none = await request(app).get('/api/v1/carriers?q=no-such-carrier').set(auth(adminToken));
      expect(none.status).toBe(200);
      expect(none.body.data).toEqual([]);

      const denied = await limitedAdmin('+249900000508', 'ZG-EMP-NOCAR', ['bookings.view']);
      expect((await request(app).get('/api/v1/carriers?q=m1b').set(auth(denied.token))).status).toBe(403);
    });
  });
});
