import { expect } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { resetEnvCache, loadEnv } from '../../src/config/env';
import { createApp } from '../../src/app';
import { connectPrisma, disconnectPrisma, getPrisma } from '../../src/infrastructure/database/prisma';
import { connectRedis, disconnectRedis, getRedis } from '../../src/infrastructure/redis/redis';
import { PERMISSION_CATALOG, SUPER_ADMIN_ROLE_KEY } from '../../src/shared/constants/permissions';
import { AdminStatus, IdentityType } from '@prisma/client';
import { normalizePhone } from '../../src/shared/utils/phone';
import { setAuthzVersion } from '../../src/shared/security/authz-cache';

let app: Express | null = null;

export async function bootTestApp(): Promise<Express> {
  resetEnvCache();
  loadEnv(process.env);
  await connectPrisma();
  await connectRedis();
  app = createApp();
  return app;
}

export async function shutdownTestApp(): Promise<void> {
  await disconnectPrisma();
  await disconnectRedis();
  app = null;
}

export async function resetDatabase(): Promise<void> {
  const prisma = getPrisma();
  // Phase 2 tables (children first)
  await prisma.cashCollection.deleteMany();
  await prisma.boardingScan.deleteMany();
  await prisma.vehiclePosition.deleteMany();
  await prisma.refund.deleteMany();
  await prisma.paymentIntent.deleteMany();
  await prisma.couponRedemption.deleteMany();
  await prisma.coupon.deleteMany();
  await prisma.carrierRating.deleteMany();
  await prisma.bookingChange.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.deviceToken.deleteMany();
  await prisma.recentSearch.deleteMany();
  // Stage 2 (children first; bookings/payouts restrict employee/trip/admin deletes)
  await prisma.ticketDispatchAttempt.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.bookingPassenger.deleteMany();
  await prisma.commissionAccrual.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.commissionSettlement.deleteMany();
  await prisma.commissionPayout.deleteMany();
  await prisma.seatHold.deleteMany();
  await prisma.tripSeat.deleteMany();
  await prisma.trip.deleteMany();
  await prisma.bookingGroup.deleteMany();
  await prisma.routeStop.deleteMany();
  await prisma.route.deleteMany();
  await prisma.vehicleAmenity.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.amenity.deleteMany();
  await prisma.tripStop.deleteMany();
  await prisma.station.deleteMany();
  await prisma.city.deleteMany();
  await prisma.driverOtpChallenge.deleteMany();
  await prisma.driverRefreshSession.deleteMany();
  await prisma.driverIdentity.deleteMany();
  await prisma.driver.deleteMany();
  await prisma.walletLedgerEntry.deleteMany();
  await prisma.topUpEvidence.deleteMany();
  await prisma.topUpIntent.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.brokerCarrierAssignment.deleteMany();
  await prisma.transportCompany.deleteMany();
  await prisma.brokerOtpChallenge.deleteMany();
  await prisma.brokerRefreshSession.deleteMany();
  await prisma.brokerIdentity.deleteMany();
  await prisma.brokerEmployee.deleteMany();
  await prisma.brokerOffice.deleteMany();

  await prisma.auditLog.deleteMany();
  await prisma.otpChallenge.deleteMany();
  await prisma.refreshSession.deleteMany();
  await prisma.rolePermission.deleteMany();
  await prisma.userRole.deleteMany();
  await prisma.adminIdentity.deleteMany();
  await prisma.adminUser.deleteMany();
  await prisma.role.deleteMany();
  await prisma.permission.deleteMany();
  await prisma.customerOtpChallenge.deleteMany();
  await prisma.customerRefreshSession.deleteMany();
  await prisma.customerIdentity.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.systemSetting.deleteMany();

  const redis = getRedis();
  const keys = await redis.keys(`${process.env.REDIS_KEY_PREFIX ?? 'zoolgo_test:'}*`);
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}

export async function seedCatalogAndSuperAdmin(phone = '+249900000001') {
  const prisma = getPrisma();
  for (const permission of PERMISSION_CATALOG) {
    await prisma.permission.create({
      data: {
        key: permission.key,
        module: permission.module,
        description: permission.description,
      },
    });
  }
  const permissions = await prisma.permission.findMany();
  const role = await prisma.role.create({
    data: {
      key: SUPER_ADMIN_ROLE_KEY,
      name: 'Super Admin',
      isSystem: true,
      isActive: true,
      rolePermissions: {
        create: permissions.map((p) => ({ permissionId: p.id })),
      },
    },
  });

  const admin = await prisma.adminUser.create({
    data: {
      employeeCode: 'ZG-EMP-BOOTSTRAP',
      displayName: 'Super Admin',
      status: AdminStatus.ACTIVE,
      isBootstrap: true,
      identities: {
        create: {
          type: IdentityType.PHONE,
          valueNormalized: normalizePhone(phone),
          isPrimary: true,
          verifiedAt: new Date(),
        },
      },
      userRoles: {
        create: { roleId: role.id, assignedBy: 'test' },
      },
    },
  });

  await setAuthzVersion(admin.id, admin.authzVersion);
  return { admin, role };
}

export async function loginWithOtp(appInstance: Express, phone: string) {
  const reqRes = await request(appInstance)
    .post('/api/v1/auth/otp/request')
    .send({ phone });
  expect(reqRes.status).toBe(200);
  const devOtp = reqRes.body.data.devOtp as string;
  expect(devOtp).toBeTruthy();

  const agent = request.agent(appInstance);
  const verifyRes = await agent
    .post('/api/v1/auth/otp/verify')
    .send({ phone, code: devOtp, challengeId: reqRes.body.data.challengeId });
  expect(verifyRes.status).toBe(200);
  return {
    agent,
    accessToken: verifyRes.body.data.accessToken as string,
    admin: verifyRes.body.data.admin,
  };
}

export async function loginBrokerWithOtp(appInstance: Express, phone: string) {
  const reqRes = await request(appInstance)
    .post('/api/v1/broker/auth/otp/request')
    .send({ phone });
  expect(reqRes.status).toBe(200);
  const devOtp = reqRes.body.data.devOtp as string;
  expect(devOtp).toBeTruthy();

  const agent = request.agent(appInstance);
  const verifyRes = await agent
    .post('/api/v1/broker/auth/otp/verify')
    .send({ phone, code: devOtp, challengeId: reqRes.body.data.challengeId });
  expect(verifyRes.status).toBe(200);
  return {
    agent,
    accessToken: verifyRes.body.data.accessToken as string,
    employee: verifyRes.body.data.employee,
    cookies: verifyRes.headers['set-cookie'] as unknown as string[],
  };
}
