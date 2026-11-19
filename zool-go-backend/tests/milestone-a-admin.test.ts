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
import { env } from '../src/config/env';
import { getPrisma } from '../src/infrastructure/database/prisma';

const MANAGER_PHONE = '+249900000401';
const BASE_PRICE = 15000;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const tomorrow = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

describe('Milestone A admin core', () => {
  let app: Express;
  let adminToken: string;
  let officeId: string;
  let companyId: string;
  let tripId: string;
  let managerToken: string;

  beforeAll(async () => {
    app = await bootTestApp();
  });

  afterAll(async () => {
    await shutdownTestApp();
  });

  async function topUp(amountMinor: number, key: string) {
    const created = await request(app)
      .post('/api/v1/broker/wallet/top-ups')
      .set(auth(managerToken))
      .send({ amountMinor, idempotencyKey: key });
    expect(created.status).toBe(201);
    const confirmed = await request(app)
      .post(`/api/v1/broker/wallet/top-ups/${created.body.data.id}/mock-confirm`)
      .set(auth(managerToken));
    expect(confirmed.status).toBe(200);
  }

  async function confirmBooking(idempotencyKey: string, fullName = 'Ada Lovelace') {
    const seats = await request(app).get(`/api/v1/broker/trips/${tripId}`).set(auth(managerToken));
    const free = (seats.body.data.seats as Array<{ id: string; status: string }>).find(
      (s) => s.status === 'FREE',
    );
    expect(free).toBeTruthy();
    expect(
      (
        await request(app)
          .post(`/api/v1/broker/trips/${tripId}/holds`)
          .set(auth(managerToken))
          .send({ seatIds: [free!.id] })
      ).status,
    ).toBe(201);
    const booked = await request(app)
      .post('/api/v1/broker/bookings/confirm')
      .set(auth(managerToken))
      .send({
        tripId,
        seatIds: [free!.id],
        passengers: [{ fullName, phone: '0914000001' }],
        idempotencyKey,
      });
    expect(booked.status).toBe(201);
    return booked.body.data.booking as {
      id: string;
      tickets: Array<{ ticketNumber: string }>;
      totalAmountMinor: number;
      commissionAmountMinor: number;
      status: string;
    };
  }

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
    return (await loginWithOtp(app, phone)).accessToken;
  }

  beforeEach(async () => {
    await resetDatabase();
    await seedCatalogAndSuperAdmin();
    adminToken = (await loginWithOtp(app, '+249900000001')).accessToken;

    const carrier = await request(app)
      .post('/api/v1/carriers')
      .set(auth(adminToken))
      .send({ key: 'm1a_carrier', name: 'M1A Carrier' });
    companyId = carrier.body.data.id;

    const office = await request(app)
      .post('/api/v1/brokers')
      .set(auth(adminToken))
      .send({
        code: 'ZG-M1A-1',
        name: 'Milestone Office',
        manager: { displayName: 'Mgr', phone: MANAGER_PHONE },
      });
    expect(office.status).toBe(201);
    officeId = office.body.data.id;

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

  describe('wallet list', () => {
    it('returns paginated SDG wallets and 403 without wallets.view', async () => {
      const listed = await request(app).get('/api/v1/admin/wallets').set(auth(adminToken));
      expect(listed.status).toBe(200);
      expect(listed.body.data.length).toBeGreaterThanOrEqual(1);
      const row = listed.body.data.find((w: { officeId: string }) => w.officeId === officeId);
      expect(row).toMatchObject({
        officeCode: 'ZG-M1A-1',
        officeName: 'Milestone Office',
        officeStatus: 'ACTIVE',
        currency: 'SDG',
        lowBalance: true,
      });
      expect(Number.isInteger(row.balanceMinor)).toBe(true);
      expect(Number.isInteger(row.lowBalanceThresholdMinor)).toBe(true);

      const denied = await limitedAdmin('+249900000411', 'ZG-EMP-NOWAL', ['bookings.view']);
      expect((await request(app).get('/api/v1/admin/wallets').set(auth(denied))).status).toBe(403);
    });

    it('filters by search, office status, low-balance default and override, and sorts', async () => {
      const second = await request(app)
        .post('/api/v1/brokers')
        .set(auth(adminToken))
        .send({
          code: 'ZG-M1A-2',
          name: 'Rich Office',
          manager: { displayName: 'Mgr2', phone: '+249900000402' },
        });
      const third = await request(app)
        .post('/api/v1/brokers')
        .set(auth(adminToken))
        .send({
          code: 'ZG-M1A-3',
          name: 'Override Office',
          manager: { displayName: 'Mgr3', phone: '+249900000403' },
        });
      expect(second.status).toBe(201);
      expect(third.status).toBe(201);

      const defaultThreshold = env().LOW_BALANCE_WARNING_THRESHOLD;
      await getPrisma().wallet.update({
        where: { brokerOfficeId: officeId },
        data: { balance: defaultThreshold - 1 },
      });
      await getPrisma().wallet.update({
        where: { brokerOfficeId: second.body.data.id },
        data: { balance: defaultThreshold + 5000 },
      });
      await getPrisma().brokerOffice.update({
        where: { id: third.body.data.id },
        data: { lowBalanceThresholdMinorOverride: 80_000 },
      });
      await getPrisma().wallet.update({
        where: { brokerOfficeId: third.body.data.id },
        data: { balance: 50_000 },
      });

      const byCode = await request(app)
        .get('/api/v1/admin/wallets?q=ZG-M1A-2')
        .set(auth(adminToken));
      expect(byCode.body.data).toHaveLength(1);
      expect(byCode.body.data[0].officeCode).toBe('ZG-M1A-2');

      const byName = await request(app)
        .get('/api/v1/admin/wallets?q=Override')
        .set(auth(adminToken));
      expect(byName.body.data).toHaveLength(1);

      const empty = await request(app)
        .get('/api/v1/admin/wallets?q=NO-SUCH-OFFICE')
        .set(auth(adminToken));
      expect(empty.status).toBe(200);
      expect(empty.body.data).toEqual([]);
      expect(empty.body.meta.total).toBe(0);

      await request(app)
        .patch(`/api/v1/brokers/${second.body.data.id}/status`)
        .set(auth(adminToken))
        .send({ status: 'SUSPENDED' });
      const suspended = await request(app)
        .get('/api/v1/admin/wallets?officeStatus=SUSPENDED')
        .set(auth(adminToken));
      expect(suspended.body.data.every((w: { officeStatus: string }) => w.officeStatus === 'SUSPENDED')).toBe(
        true,
      );
      expect(suspended.body.data.some((w: { officeCode: string }) => w.officeCode === 'ZG-M1A-2')).toBe(true);

      const low = await request(app)
        .get('/api/v1/admin/wallets?lowBalance=true')
        .set(auth(adminToken));
      const codes = low.body.data.map((w: { officeCode: string }) => w.officeCode).sort();
      expect(codes).toEqual(['ZG-M1A-1', 'ZG-M1A-3']);
      const overrideRow = low.body.data.find((w: { officeCode: string }) => w.officeCode === 'ZG-M1A-3');
      expect(overrideRow.lowBalanceThresholdMinor).toBe(80_000);
      expect(overrideRow.lowBalance).toBe(true);

      const sorted = await request(app)
        .get('/api/v1/admin/wallets?sort=balanceMinor&order=asc')
        .set(auth(adminToken));
      const balances = sorted.body.data.map((w: { balanceMinor: number }) => w.balanceMinor);
      expect(balances).toEqual([...balances].sort((a, b) => a - b));

      const all = await request(app).get('/api/v1/admin/wallets?pageSize=100').set(auth(adminToken));
      const listedSum = all.body.data.reduce((s: number, w: { balanceMinor: number }) => s + w.balanceMinor, 0);
      const dbSum = (
        await getPrisma().wallet.aggregate({ _sum: { balance: true } })
      )._sum.balance;
      expect(listedSum).toBe(dbSum);
    });
  });

  describe('admin ticket PDF', () => {
    it('downloads PDF, rejects broker token, unknown/mismatched tickets, and cancelled bookings', async () => {
      await topUp(200000, 'm1a-pdf-top');
      const booking = await confirmBooking('m1a-pdf-book');
      const ticketNumber = booking.tickets[0]!.ticketNumber;

      const pdf = await request(app)
        .get(`/api/v1/admin/bookings/${booking.id}/tickets/${ticketNumber}/pdf`)
        .set(auth(adminToken));
      expect(pdf.status).toBe(200);
      expect(pdf.headers['content-type']).toContain('application/pdf');
      expect(pdf.body.toString('utf8', 0, 5)).toBe('%PDF-');

      const walletBefore = await request(app)
        .get(`/api/v1/admin/wallets/${officeId}`)
        .set(auth(adminToken));
      const again = await request(app)
        .get(`/api/v1/admin/bookings/${booking.id}/tickets/${ticketNumber}/pdf`)
        .set(auth(adminToken));
      expect(again.status).toBe(200);
      const walletAfter = await request(app)
        .get(`/api/v1/admin/wallets/${officeId}`)
        .set(auth(adminToken));
      expect(walletAfter.body.data.wallet.balanceMinor).toBe(walletBefore.body.data.wallet.balanceMinor);
      const still = await request(app)
        .get(`/api/v1/admin/bookings/${booking.id}`)
        .set(auth(adminToken));
      expect(still.body.data.status).toBe('CONFIRMED');
      expect(still.body.data.commissionAmountMinor).toBe(booking.commissionAmountMinor);

      expect(
        (
          await request(app)
            .get(`/api/v1/admin/bookings/${booking.id}/tickets/${ticketNumber}/pdf`)
            .set(auth(managerToken))
        ).status,
      ).toBe(401);

      const denied = await limitedAdmin('+249900000412', 'ZG-EMP-NOPDF', ['wallets.view']);
      expect(
        (
          await request(app)
            .get(`/api/v1/admin/bookings/${booking.id}/tickets/${ticketNumber}/pdf`)
            .set(auth(denied))
        ).status,
      ).toBe(403);

      expect(
        (
          await request(app)
            .get(`/api/v1/admin/bookings/does-not-exist/tickets/${ticketNumber}/pdf`)
            .set(auth(adminToken))
        ).status,
      ).toBe(404);
      expect(
        (
          await request(app)
            .get(`/api/v1/admin/bookings/${booking.id}/tickets/NOT-A-TICKET/pdf`)
            .set(auth(adminToken))
        ).status,
      ).toBe(404);

      const cancelled = await request(app)
        .post(`/api/v1/admin/bookings/${booking.id}/cancel`)
        .set(auth(adminToken))
        .send({ reason: 'Admin QA cancel' });
      expect(cancelled.status).toBe(200);
      expect(
        (
          await request(app)
            .get(`/api/v1/admin/bookings/${booking.id}/tickets/${ticketNumber}/pdf`)
            .set(auth(adminToken))
        ).status,
      ).toBe(409);
    });
  });

  describe('settlement accruals', () => {
    it('returns summary plus paginated linked accruals whose sum equals totalAmountMinor', async () => {
      await topUp(400000, 'm1a-set-top');
      const first = await confirmBooking('m1a-set-1', 'First Passenger');
      const second = await confirmBooking('m1a-set-2', 'Second Rider');

      const from = new Date(Date.now() - 60_000).toISOString();
      const to = new Date(Date.now() + 60_000).toISOString();
      const draft = await request(app)
        .post('/api/v1/admin/commissions/settlements')
        .set(auth(adminToken))
        .send({ officeId, periodFrom: from, periodTo: to, note: 'M1A draft' });
      expect(draft.status).toBe(201);
      const settlementId = draft.body.data.id as string;
      expect(draft.body.data.currency).toBe('SDG');
      expect(draft.body.data.accruals).toBeUndefined();

      const detail = await request(app)
        .get(`/api/v1/admin/commissions/settlements/${settlementId}`)
        .set(auth(adminToken));
      expect(detail.status).toBe(200);
      expect(detail.body.data.status).toBe('DRAFT');
      expect(detail.body.data.accrualCount).toBe(2);

      const lines = await request(app)
        .get(`/api/v1/admin/commissions/settlements/${settlementId}/accruals`)
        .set(auth(adminToken));
      expect(lines.status).toBe(200);
      expect(lines.body.data).toHaveLength(2);
      expect(lines.body.data.every((a: { currency: string }) => a.currency === 'SDG')).toBe(true);
      const bookingIds = lines.body.data.map((a: { bookingId: string }) => a.bookingId).sort();
      expect(bookingIds).toEqual([first.id, second.id].sort());
      const sum = lines.body.data.reduce((s: number, a: { amountMinor: number }) => s + a.amountMinor, 0);
      expect(sum).toBe(detail.body.data.totalAmountMinor);

      const again = await request(app)
        .get(`/api/v1/admin/commissions/settlements/${settlementId}`)
        .set(auth(adminToken));
      expect(again.body.data.status).toBe('DRAFT');
      expect(again.body.data.totalAmountMinor).toBe(detail.body.data.totalAmountMinor);

      expect(
        (
          await request(app)
            .get('/api/v1/admin/commissions/settlements/missing/accruals')
            .set(auth(adminToken))
        ).status,
      ).toBe(404);

      const denied = await limitedAdmin('+249900000413', 'ZG-EMP-NOCOM', ['wallets.view']);
      expect(
        (
          await request(app)
            .get(`/api/v1/admin/commissions/settlements/${settlementId}/accruals`)
            .set(auth(denied))
        ).status,
      ).toBe(403);
    });
  });

  describe('carriers', () => {
    it('gets, patches name/status idempotently, audits changes, and does not touch bookings', async () => {
      await topUp(200000, 'm1a-car-top');
      const booking = await confirmBooking('m1a-car-book');

      const got = await request(app).get(`/api/v1/carriers/${companyId}`).set(auth(adminToken));
      expect(got.status).toBe(200);
      expect(got.body.data).toMatchObject({
        id: companyId,
        key: 'm1a_carrier',
        name: 'M1A Carrier',
        status: 'ACTIVE',
        assignmentCount: 1,
      });
      expect(got.body.data.updatedAt).toBeUndefined();
      expect(got.body.data.fleetCount).toBeUndefined();

      expect((await request(app).get('/api/v1/carriers/missing').set(auth(adminToken))).status).toBe(404);

      const renamed = await request(app)
        .patch(`/api/v1/carriers/${companyId}`)
        .set(auth(adminToken))
        .send({ name: 'M1A Carrier Renamed' });
      expect(renamed.status).toBe(200);
      expect(renamed.body.data.name).toBe('M1A Carrier Renamed');

      const noop = await request(app)
        .patch(`/api/v1/carriers/${companyId}`)
        .set(auth(adminToken))
        .send({ name: 'M1A Carrier Renamed' });
      expect(noop.status).toBe(200);

      const suspended = await request(app)
        .patch(`/api/v1/carriers/${companyId}`)
        .set(auth(adminToken))
        .send({ status: 'SUSPENDED' });
      expect(suspended.body.data.status).toBe('SUSPENDED');
      const activated = await request(app)
        .patch(`/api/v1/carriers/${companyId}`)
        .set(auth(adminToken))
        .send({ status: 'SUSPENDED' });
      expect(activated.status).toBe(200);

      expect(
        (await request(app).patch(`/api/v1/carriers/${companyId}`).set(auth(adminToken)).send({})).status,
      ).toBe(422);
      expect(
        (
          await request(app)
            .patch(`/api/v1/carriers/${companyId}`)
            .set(auth(adminToken))
            .send({ name: 'x', fleetCount: 9 })
        ).status,
      ).toBe(422);

      const denied = await limitedAdmin('+249900000414', 'ZG-EMP-NOCAR', ['carriers.view']);
      expect(
        (
          await request(app)
            .patch(`/api/v1/carriers/${companyId}`)
            .set(auth(denied))
            .send({ name: 'Nope' })
        ).status,
      ).toBe(403);
      expect((await request(app).get(`/api/v1/carriers/${companyId}`).set(auth(denied))).status).toBe(200);

      const viewDenied = await limitedAdmin('+249900000415', 'ZG-EMP-NOCV', ['bookings.view']);
      expect((await request(app).get(`/api/v1/carriers/${companyId}`).set(auth(viewDenied))).status).toBe(
        403,
      );

      const live = await request(app).get(`/api/v1/admin/bookings/${booking.id}`).set(auth(adminToken));
      expect(live.body.data.status).toBe('CONFIRMED');
      const trip = await request(app).get(`/api/v1/catalog/trips/${tripId}`).set(auth(adminToken));
      expect(trip.status).toBe(200);

      const audits = await request(app).get('/api/v1/audit-logs?pageSize=100').set(auth(adminToken));
      const actions = (audits.body.data as Array<{ action: string; resourceId: string | null }>)
        .filter((a) => a.resourceId === companyId)
        .map((a) => a.action);
      expect(actions).toContain('carrier.updated');
      expect(actions).toContain('carrier.status_changed');
      expect(actions.filter((a) => a === 'carrier.updated').length).toBe(1);
    });
  });

  describe('admin trip detail and catalog.view', () => {
    it('lets admin inspect any trip without leaking hold ownership', async () => {
      const other = await request(app)
        .post('/api/v1/carriers')
        .set(auth(adminToken))
        .send({ key: 'm1a_other', name: 'Unassigned Carrier' });
      const otherTrip = await request(app)
        .post('/api/v1/catalog/trips')
        .set(auth(adminToken))
        .send({
          companyId: other.body.data.id,
          origin: 'Port Sudan',
          destination: 'Kassala',
          departureAt: tomorrow(),
          basePrice: 9000,
          seatLabels: ['B1', 'B2'],
        });
      expect(otherTrip.status).toBe(201);

      const adminOther = await request(app)
        .get(`/api/v1/catalog/trips/${otherTrip.body.data.id}`)
        .set(auth(adminToken));
      expect(adminOther.status).toBe(200);
      expect(adminOther.body.data.company.key).toBe('m1a_other');
      expect(adminOther.body.data.seats).toHaveLength(2);
      expect(adminOther.body.data.availability.total).toBe(2);
      expect(adminOther.body.data.seats[0].holdId).toBeUndefined();
      expect(adminOther.body.data.seats[0].heldByMe).toBeUndefined();

      expect(
        (await request(app).get(`/api/v1/broker/trips/${otherTrip.body.data.id}`).set(auth(managerToken)))
          .status,
      ).toBe(404);

      expect((await request(app).get('/api/v1/catalog/trips/missing').set(auth(adminToken))).status).toBe(
        404,
      );

      const viewer = await limitedAdmin('+249900000416', 'ZG-EMP-CVIEW', ['catalog.view']);
      expect((await request(app).get(`/api/v1/catalog/trips/${tripId}`).set(auth(viewer))).status).toBe(
        200,
      );
      expect((await request(app).get('/api/v1/catalog/trips').set(auth(viewer))).status).toBe(200);
      expect(
        (
          await request(app)
            .post('/api/v1/catalog/trips')
            .set(auth(viewer))
            .send({
              companyId,
              origin: 'A',
              destination: 'B',
              departureAt: tomorrow(),
              basePrice: 1000,
              seatLabels: ['Z1'],
            })
        ).status,
      ).toBe(403);

      const managerOnly = await limitedAdmin('+249900000417', 'ZG-EMP-CMAN', ['catalog.manage']);
      expect((await request(app).get(`/api/v1/catalog/trips/${tripId}`).set(auth(managerOnly))).status).toBe(
        403,
      );
      expect(
        (
          await request(app)
            .post('/api/v1/catalog/trips')
            .set(auth(managerOnly))
            .send({
              companyId,
              origin: 'Dongola',
              destination: 'Karima',
              departureAt: tomorrow(),
              basePrice: 1000,
              seatLabels: ['Z1'],
            })
        ).status,
      ).toBe(201);
    });
  });
});
