import {
  AdminStatus,
  IdentityType,
  OtpChallengeStatus,
  OtpPurpose,
  type Prisma,
} from '@prisma/client';
import { getPrisma, type PrismaTx } from '../../infrastructure/database/prisma';

function client(tx?: PrismaTx) {
  return tx ?? getPrisma();
}

export class AuthRepository {
  findActiveAdminByPhone(phoneNormalized: string) {
    return getPrisma().adminIdentity.findUnique({
      where: {
        type_valueNormalized: {
          type: IdentityType.PHONE,
          valueNormalized: phoneNormalized,
        },
      },
      include: {
        adminUser: {
          include: {
            identities: true,
            userRoles: {
              where: { isActive: true },
              include: {
                role: {
                  include: {
                    rolePermissions: { include: { permission: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  findAdminById(adminId: string) {
    return getPrisma().adminUser.findUnique({
      where: { id: adminId },
      include: {
        identities: true,
        userRoles: {
          where: { isActive: true },
          include: {
            role: {
              include: {
                rolePermissions: { include: { permission: true } },
              },
            },
          },
        },
      },
    });
  }

  createOtpChallenge(
    data: {
      adminUserId: string;
      identityType: IdentityType;
      identityValue: string;
      purpose: OtpPurpose;
      codeHash: string;
      maxAttempts: number;
      expiresAt: Date;
      requestId?: string;
    },
    tx?: PrismaTx,
  ) {
    return client(tx).otpChallenge.create({ data });
  }

  findOtpChallengeById(id: string) {
    return getPrisma().otpChallenge.findUnique({ where: { id } });
  }

  findLatestPendingOtp(adminUserId: string, purpose: OtpPurpose) {
    return getPrisma().otpChallenge.findFirst({
      where: {
        adminUserId,
        purpose,
        status: OtpChallengeStatus.PENDING,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  updateOtpChallenge(
    id: string,
    data: Prisma.OtpChallengeUpdateInput,
    tx?: PrismaTx,
  ) {
    return client(tx).otpChallenge.update({ where: { id }, data });
  }

  expirePendingOtpChallenges(
    adminUserId: string,
    purpose: OtpPurpose,
    exceptId: string,
    tx?: PrismaTx,
  ) {
    return client(tx).otpChallenge.updateMany({
      where: {
        adminUserId,
        purpose,
        status: OtpChallengeStatus.PENDING,
        id: { not: exceptId },
      },
      data: { status: OtpChallengeStatus.EXPIRED },
    });
  }

  async updatePrimaryPhoneIdentity(
    adminUserId: string,
    phoneNormalized: string,
    tx?: PrismaTx,
  ) {
    const db = client(tx);
    const existing = await db.adminIdentity.findFirst({
      where: { adminUserId, type: IdentityType.PHONE },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
    if (!existing) {
      return db.adminIdentity.create({
        data: {
          adminUserId,
          type: IdentityType.PHONE,
          valueNormalized: phoneNormalized,
          isPrimary: true,
          verifiedAt: new Date(),
        },
      });
    }
    return db.adminIdentity.update({
      where: { id: existing.id },
      data: {
        valueNormalized: phoneNormalized,
        isPrimary: true,
        verifiedAt: new Date(),
      },
    });
  }

  createRefreshSession(
    data: {
      adminUserId: string;
      tokenHash: string;
      familyId: string;
      userAgent?: string;
      ipAddress?: string;
      expiresAt: Date;
    },
    tx?: PrismaTx,
  ) {
    return client(tx).refreshSession.create({ data });
  }

  findRefreshSessionByHash(tokenHash: string) {
    return getPrisma().refreshSession.findUnique({
      where: { tokenHash },
      include: { adminUser: true },
    });
  }

  updateRefreshSession(
    id: string,
    data: Prisma.RefreshSessionUpdateInput,
    tx?: PrismaTx,
  ) {
    return client(tx).refreshSession.update({ where: { id }, data });
  }

  revokeSession(id: string, reason: string, tx?: PrismaTx) {
    return client(tx).refreshSession.update({
      where: { id },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }

  revokeAllSessions(adminUserId: string, reason: string, exceptId?: string, tx?: PrismaTx) {
    return client(tx).refreshSession.updateMany({
      where: {
        adminUserId,
        revokedAt: null,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }

  bumpAuthzVersion(adminUserId: string, tx?: PrismaTx) {
    return client(tx).adminUser.update({
      where: { id: adminUserId },
      data: { authzVersion: { increment: 1 } },
      select: { id: true, authzVersion: true },
    });
  }

  revokeFamily(familyId: string, reason: string, tx?: PrismaTx) {
    return client(tx).refreshSession.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }

  touchAdminLogin(adminUserId: string, tx?: PrismaTx) {
    return client(tx).adminUser.update({
      where: { id: adminUserId },
      data: { lastLoginAt: new Date() },
    });
  }

  assertAdminActive(status: AdminStatus): boolean {
    return status === AdminStatus.ACTIVE;
  }
}

export const authRepository = new AuthRepository();
