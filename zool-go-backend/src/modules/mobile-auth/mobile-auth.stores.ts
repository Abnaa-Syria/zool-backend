import {
  CarrierEmployeeStatus,
  CarrierOtpPurpose,
  CustomerOtpPurpose,
  CustomerStatus,
  DriverOtpPurpose,
  DriverStatus,
  IdentityType,
  OtpChallengeStatus,
  Prisma,
} from '@prisma/client';
import { getPrisma, type PrismaTx } from '../../infrastructure/database/prisma';
import { AppError } from '../../shared/errors/app-error';
import type { MobileAuthStore } from './mobile-auth.engine';

const phoneKey = (phone: string) => ({ type_valueNormalized: { type: IdentityType.PHONE, valueNormalized: phone } });

/** Customer identities: the account is created by the first successful OTP verify. */
export const customerAuthStore: MobileAuthStore = {
  principal: 'customer',

  async resolveForRequest(phone) {
    const identity = await getPrisma().customerIdentity.findUnique({
      where: phoneKey(phone),
      include: { customer: { select: { status: true } } },
    });
    if (!identity) return { principalId: null };
    return identity.customer.status === CustomerStatus.ACTIVE ? { principalId: identity.customerId } : null;
  },

  createChallenge(data) {
    return getPrisma().customerOtpChallenge.create({
      data: {
        customerId: data.principalId,
        identityType: IdentityType.PHONE,
        identityValue: data.phone,
        purpose: CustomerOtpPurpose.CUSTOMER_LOGIN,
        codeHash: data.codeHash,
        maxAttempts: data.maxAttempts,
        expiresAt: data.expiresAt,
        requestId: data.requestId ?? null,
      },
      select: { id: true },
    });
  },

  async findChallenge(id) {
    const c = await getPrisma().customerOtpChallenge.findUnique({ where: { id } });
    return c && c.purpose === CustomerOtpPurpose.CUSTOMER_LOGIN ? c : null;
  },

  findLatestPending(phone) {
    return getPrisma().customerOtpChallenge.findFirst({
      where: { identityValue: phone, purpose: CustomerOtpPurpose.CUSTOMER_LOGIN, status: OtpChallengeStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    });
  },

  updateChallenge(id, data) {
    return getPrisma().customerOtpChallenge.update({ where: { id }, data });
  },

  async consumeChallenge(id, tx) {
    const r = await tx.customerOtpChallenge.updateMany({
      where: { id, status: OtpChallengeStatus.PENDING },
      data: { status: OtpChallengeStatus.CONSUMED, consumedAt: new Date() },
    });
    return r.count === 1;
  },

  async completeLogin(phone, tx) {
    const existing = await tx.customerIdentity.findUnique({ where: phoneKey(phone) });
    if (existing) {
      await tx.customer.update({ where: { id: existing.customerId }, data: { lastLoginAt: new Date() } });
      return { principalId: existing.customerId, isNew: false };
    }
    try {
      const customer = await tx.customer.create({
        data: {
          lastLoginAt: new Date(),
          identities: {
            create: { type: IdentityType.PHONE, valueNormalized: phone, isPrimary: true, verifiedAt: new Date() },
          },
        },
      });
      return { principalId: customer.id, isNew: true };
    } catch (err) {
      // Same phone verified concurrently: the unique identity rejects the second account.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw AppError.conflict('This phone was just registered; please retry');
      }
      throw err;
    }
  },

  createSession(data, tx) {
    const { principalId, ...rest } = data;
    return (tx ?? getPrisma()).customerRefreshSession.create({ data: { customerId: principalId, ...rest }, select: { id: true } });
  },

  async findSessionByHash(tokenHash) {
    const s = await getPrisma().customerRefreshSession.findUnique({ where: { tokenHash } });
    return s ? { ...s, principalId: s.customerId } : null;
  },

  rotateSession(id, replacedById, tx) {
    return tx.customerRefreshSession.update({
      where: { id },
      data: { revokedAt: new Date(), revokeReason: 'rotated', replacedById, lastUsedAt: new Date() },
    });
  },

  revokeSession(id, reason) {
    return getPrisma().customerRefreshSession.update({ where: { id }, data: { revokedAt: new Date(), revokeReason: reason } });
  },

  revokeFamily(familyId, reason) {
    return getPrisma().customerRefreshSession.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  },

  revokeAll(customerId, reason) {
    return revokeAllCustomerSessions(customerId, reason);
  },

  async activeAuthzVersion(id) {
    const c = await getPrisma().customer.findUnique({ where: { id }, select: { status: true, authzVersion: true } });
    return c?.status === CustomerStatus.ACTIVE ? c.authzVersion : null;
  },
};

export function revokeAllCustomerSessions(customerId: string, reason: string, tx?: PrismaTx) {
  return (tx ?? getPrisma()).customerRefreshSession.updateMany({
    where: { customerId, revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: reason },
  });
}

/** Drivers are created by the admin (fleet module); unknown phones cannot log in. */
export const driverAuthStore: MobileAuthStore = {
  principal: 'driver',

  async resolveForRequest(phone) {
    const identity = await getPrisma().driverIdentity.findUnique({
      where: phoneKey(phone),
      include: { driver: { select: { status: true } } },
    });
    return identity && identity.driver.status === DriverStatus.ACTIVE ? { principalId: identity.driverId } : null;
  },

  createChallenge(data) {
    return getPrisma().driverOtpChallenge.create({
      data: {
        driverId: data.principalId!,
        identityType: IdentityType.PHONE,
        identityValue: data.phone,
        purpose: DriverOtpPurpose.DRIVER_LOGIN,
        codeHash: data.codeHash,
        maxAttempts: data.maxAttempts,
        expiresAt: data.expiresAt,
        requestId: data.requestId ?? null,
      },
      select: { id: true },
    });
  },

  findChallenge(id) {
    return getPrisma().driverOtpChallenge.findUnique({ where: { id } });
  },

  findLatestPending(phone) {
    return getPrisma().driverOtpChallenge.findFirst({
      where: { identityValue: phone, purpose: DriverOtpPurpose.DRIVER_LOGIN, status: OtpChallengeStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    });
  },

  updateChallenge(id, data) {
    return getPrisma().driverOtpChallenge.update({ where: { id }, data });
  },

  async consumeChallenge(id, tx) {
    const r = await tx.driverOtpChallenge.updateMany({
      where: { id, status: OtpChallengeStatus.PENDING },
      data: { status: OtpChallengeStatus.CONSUMED, consumedAt: new Date() },
    });
    return r.count === 1;
  },

  async completeLogin(phone, tx) {
    const identity = await tx.driverIdentity.findUniqueOrThrow({ where: phoneKey(phone) });
    await tx.driver.update({ where: { id: identity.driverId }, data: { lastLoginAt: new Date() } });
    return { principalId: identity.driverId, isNew: false };
  },

  createSession(data, tx) {
    const { principalId, ...rest } = data;
    return (tx ?? getPrisma()).driverRefreshSession.create({ data: { driverId: principalId, ...rest }, select: { id: true } });
  },

  async findSessionByHash(tokenHash) {
    const s = await getPrisma().driverRefreshSession.findUnique({ where: { tokenHash } });
    return s ? { ...s, principalId: s.driverId } : null;
  },

  rotateSession(id, replacedById, tx) {
    return tx.driverRefreshSession.update({
      where: { id },
      data: { revokedAt: new Date(), revokeReason: 'rotated', replacedById, lastUsedAt: new Date() },
    });
  },

  revokeSession(id, reason) {
    return getPrisma().driverRefreshSession.update({ where: { id }, data: { revokedAt: new Date(), revokeReason: reason } });
  },

  revokeFamily(familyId, reason) {
    return getPrisma().driverRefreshSession.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  },

  revokeAll(driverId, reason) {
    return getPrisma().driverRefreshSession.updateMany({
      where: { driverId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  },

  async activeAuthzVersion(id) {
    const d = await getPrisma().driver.findUnique({ where: { id }, select: { status: true, authzVersion: true } });
    return d?.status === DriverStatus.ACTIVE ? d.authzVersion : null;
  },
};

/** Carrier portal staff (D-CARRIER-PORTAL-01): created by the admin or the carrier manager. */
export const carrierAuthStore: MobileAuthStore = {
  principal: 'carrier',

  async resolveForRequest(phone) {
    const identity = await getPrisma().carrierIdentity.findUnique({
      where: phoneKey(phone),
      include: { employee: { select: { status: true } } },
    });
    return identity && identity.employee.status === CarrierEmployeeStatus.ACTIVE ? { principalId: identity.carrierEmployeeId } : null;
  },

  createChallenge(data) {
    return getPrisma().carrierOtpChallenge.create({
      data: {
        carrierEmployeeId: data.principalId!,
        identityType: IdentityType.PHONE,
        identityValue: data.phone,
        purpose: CarrierOtpPurpose.CARRIER_LOGIN,
        codeHash: data.codeHash,
        maxAttempts: data.maxAttempts,
        expiresAt: data.expiresAt,
        requestId: data.requestId ?? null,
      },
      select: { id: true },
    });
  },

  findChallenge(id) {
    return getPrisma().carrierOtpChallenge.findUnique({ where: { id } });
  },

  findLatestPending(phone) {
    return getPrisma().carrierOtpChallenge.findFirst({
      where: { identityValue: phone, purpose: CarrierOtpPurpose.CARRIER_LOGIN, status: OtpChallengeStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    });
  },

  updateChallenge(id, data) {
    return getPrisma().carrierOtpChallenge.update({ where: { id }, data });
  },

  async consumeChallenge(id, tx) {
    const r = await tx.carrierOtpChallenge.updateMany({
      where: { id, status: OtpChallengeStatus.PENDING },
      data: { status: OtpChallengeStatus.CONSUMED, consumedAt: new Date() },
    });
    return r.count === 1;
  },

  async completeLogin(phone, tx) {
    const identity = await tx.carrierIdentity.findUniqueOrThrow({ where: phoneKey(phone) });
    await tx.carrierEmployee.update({ where: { id: identity.carrierEmployeeId }, data: { lastLoginAt: new Date() } });
    return { principalId: identity.carrierEmployeeId, isNew: false };
  },

  createSession(data, tx) {
    const { principalId, ...rest } = data;
    return (tx ?? getPrisma()).carrierRefreshSession.create({ data: { carrierEmployeeId: principalId, ...rest }, select: { id: true } });
  },

  async findSessionByHash(tokenHash) {
    const s = await getPrisma().carrierRefreshSession.findUnique({ where: { tokenHash } });
    return s ? { ...s, principalId: s.carrierEmployeeId } : null;
  },

  rotateSession(id, replacedById, tx) {
    return tx.carrierRefreshSession.update({
      where: { id },
      data: { revokedAt: new Date(), revokeReason: 'rotated', replacedById, lastUsedAt: new Date() },
    });
  },

  revokeSession(id, reason) {
    return getPrisma().carrierRefreshSession.update({ where: { id }, data: { revokedAt: new Date(), revokeReason: reason } });
  },

  revokeFamily(familyId, reason) {
    return getPrisma().carrierRefreshSession.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  },

  revokeAll(employeeId, reason) {
    return getPrisma().carrierRefreshSession.updateMany({
      where: { carrierEmployeeId: employeeId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  },

  async activeAuthzVersion(id) {
    const d = await getPrisma().carrierEmployee.findUnique({ where: { id }, select: { status: true, authzVersion: true } });
    return d?.status === CarrierEmployeeStatus.ACTIVE ? d.authzVersion : null;
  },
};
