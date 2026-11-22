import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getPrisma } from '../src/infrastructure/database/prisma';
import { setPaymentProvider, MockPaymentProvider } from '../src/modules/payments';
import { getPushProvider, LogPushProvider } from '../src/modules/notifications';
import { sendDepartureReminders } from '../src/modules/customer-app';
import { bootTestApp, shutdownTestApp, resetDatabase, seedCatalogAndSuperAdmin, loginWithOtp, loginBrokerWithOtp } from './helpers/app';
import { loginCustomer, loginDriver } from './helpers/mobile';
import { seedNetwork, sudanAt } from './helpers/network';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Notification feeds, devices, push, reminders and the admin refunds queue', () => {
  let app: Express;
  let adminToken: string;
  let token: string;
  let customerId: string;
  let net: Awaited<ReturnType<typeof seedNetwork>>;
  let trip: string;

  beforeAll(async () => {
    app = await bootTestApp();
  });
  afterAll(async () => {
    setPaymentProvider(null);
    await shutdownTestApp();
  });
  beforeEach(async () => {
    setPaymentProvider(null);
    await resetDatabase();
    await seedCatalogAndSuperAdmin();
    adminToken = (await loginWithOtp(app, '+249900000001')).accessToken;
    net = await seedNetwork(app, adminToken);
    trip = await net.schedule({ departure: sudanAt(2, '07:00'), priceMinor: 3_500_000 });
    const login = await loginCustomer(app, '+249912800001');
    token = login.body.data.accessToken;
    customerId = login.body.data.customer.id;
  });

  async function book(key: string, paymentMethod: 'CASH_ON_BOARD' | 'ONLINE' = 'CASH_ON_BOARD', seat = '1') {
    const h = await request(app).post(`/api/v1/customer/trips/${trip}/holds`).set(auth(token)).send({ seatLabels: [seat] });
    const res = await request(app)
      .post('/api/v1/customer/bookings')
      .set(auth(token))
      .set('Idempotency-Key', key)
      .send({ holdIds: [h.body.data.holds[0].id], passengers: [{ fullName: 'Ali Omer', gender: 'MALE' }], paymentMethod });
    expect(res.status).toBe(201);
    return res.body.data;
  }

  it('feeds notifications per principal, marks read, registers devices and pushes', async () => {
    const dev = await request(app).post('/api/v1/customer/devices').set(auth(token)).send({ platform: 'ANDROID', pushToken: 'fcm-token-customer-0001' });
    expect(dev.status).toBe(201);
    const push = getPushProvider() as LogPushProvider;
    const before = push.sent.length;

    await book('notif-key-001');
    await new Promise((r) => setTimeout(r, 50));
    expect(push.sent.slice(before).map((m) => m.token)).toEqual(['fcm-token-customer-0001']);

    const feed = await request(app).get('/api/v1/customer/notifications').set(auth(token));
    expect(feed.body.data[0]).toMatchObject({ type: 'TICKET_ISSUED', isRead: false });
    expect(feed.body.meta.unread).toBe(1);
    expect((await request(app).get('/api/v1/customer/notifications/unread-count').set(auth(token))).body.data.unread).toBe(1);
    const read = await request(app).post(`/api/v1/customer/notifications/${feed.body.data[0].id}/read`).set(auth(token));
    expect(read.body.data.unread).toBe(0);

    // Another principal cannot read or mark it.
    const driver = (await loginDriver(app, net.driverPhone)).body.data.accessToken;
    expect((await request(app).get('/api/v1/driver/notifications').set(auth(driver))).body.data).toHaveLength(0);
    expect((await request(app).post(`/api/v1/driver/notifications/${feed.body.data[0].id}/read`).set(auth(driver))).status).toBe(404);
    expect((await request(app).post('/api/v1/customer/notifications/read-all').set(auth(token))).status).toBe(200);

    // A token re-registered by another principal moves to them.
    await request(app).post('/api/v1/driver/devices').set(auth(driver)).send({ platform: 'ANDROID', pushToken: 'fcm-token-customer-0001' });
    expect(await getPrisma().deviceToken.findMany({ where: { principalType: 'CUSTOMER' } })).toHaveLength(0);
    expect((await request(app).delete('/api/v1/driver/devices/fcm-token-customer-0001').set(auth(driver))).status).toBe(200);

    // Broker feed exists too.
    await request(app)
      .post('/api/v1/brokers')
      .set(auth(adminToken))
      .send({ code: 'ZG-BRK-N1', name: 'Office', settlementPeriod: 'MONTHLY', manager: { displayName: 'Manager', phone: '+249900000961' } });
    const broker = (await loginBrokerWithOtp(app, '+249900000961')).accessToken;
    expect((await request(app).get('/api/v1/broker/notifications').set(auth(broker))).status).toBe(200);
  });

  it('sends one departure reminder per booking', async () => {
    const soon = await net.schedule({ departure: new Date(Date.now() + 60 * 60_000), priceMinor: 3_500_000 });
    trip = soon;
    await request(app).patch('/api/v1/admin/settings').set(auth(adminToken)).send({ values: { 'cash.cutoffMinutesBeforeDeparture': 0 } });
    await book('remind-key-01');
    expect(await sendDepartureReminders()).toBe(1);
    expect(await sendDepartureReminders()).toBe(0);
    const types = (await getPrisma().notification.findMany({ where: { recipientId: customerId } })).map((n) => n.type);
    expect(types).toContain('DEPARTURE_REMINDER');
  });

  it('queues failed provider refunds for the admin to retry or mark as paid', async () => {
    const created = await book('refund-key-01', 'ONLINE', '2');
    await request(app).post(`/api/v1/customer/payments/${created.payment.intentId}/mock-confirm`).set(auth(token));

    // The provider is down: the refund stays PENDING.
    class DownProvider extends MockPaymentProvider {
      override async refundCharge(): Promise<never> {
        throw new Error('provider down');
      }
    }
    setPaymentProvider(new DownProvider());
    const cancel = await request(app).post(`/api/v1/customer/bookings/${created.bookings[0].id}/cancel`).set(auth(token)).send({});
    expect(cancel.body.data.refund.status).toBe('PENDING');

    const queue = await request(app).get('/api/v1/admin/refunds?status=PENDING').set(auth(adminToken));
    expect(queue.body.meta).toMatchObject({ total: 1, pendingCount: 1, pendingAmountMinor: 3_500_000 });
    const refundId = queue.body.data[0].id as string;
    expect(queue.body.data[0]).toMatchObject({ reason: 'CUSTOMER_CANCEL', customer: { phone: '+249912800001' } });

    setPaymentProvider(null);
    const retried = await request(app).post(`/api/v1/admin/refunds/${refundId}/retry`).set(auth(adminToken));
    expect(retried.body.data.status).toBe('SUCCEEDED');
    expect((await request(app).post(`/api/v1/admin/refunds/${refundId}/mark-paid`).set(auth(adminToken)).send({ reference: 'BANK-1' })).status).toBe(409);
  });

  it('lets the admin record a manual refund', async () => {
    const created = await book('refund-key-02', 'ONLINE', '3');
    await request(app).post(`/api/v1/customer/payments/${created.payment.intentId}/mock-confirm`).set(auth(token));
    class DownProvider extends MockPaymentProvider {
      override async refundCharge(): Promise<never> {
        throw new Error('provider down');
      }
    }
    setPaymentProvider(new DownProvider());
    await request(app).post(`/api/v1/customer/bookings/${created.bookings[0].id}/cancel`).set(auth(token)).send({});
    setPaymentProvider(null);
    const id = (await request(app).get('/api/v1/admin/refunds').set(auth(adminToken))).body.data[0].id;
    const paid = await request(app).post(`/api/v1/admin/refunds/${id}/mark-paid`).set(auth(adminToken)).send({ reference: 'BANKAK-777' });
    expect(paid.body.data).toMatchObject({ status: 'SUCCEEDED', providerRef: 'manual:BANKAK-777' });
  });
});
