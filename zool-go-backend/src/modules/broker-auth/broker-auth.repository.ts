import {
  IdentityType,
  OtpChallengeStatus,
  type BrokerOtpPurpose,
  type Prisma,
} from '@prisma/client';
import { getPrisma, type PrismaTx } from '../../infrastructure/database/prisma';

function client(tx?: PrismaTx) {
  return tx ?? getPrisma();
}

const employeeInclude = {
  office: true,
  identities: true,
} satisfies Prisma.BrokerEmployeeInclude;

export type BrokerEmployeeWithOffice = Prisma.BrokerEmployeeGetPayload<{
  include: typeof employeeInclude;
}>;

export class BrokerAuthRepository {
  findIdentityByPhone(phoneNormalized: string) {
    return getPrisma().brokerIdentity.findUnique({
      where: {
        type_valueNormalized: {
          type: IdentityType.PHONE,
          valueNormalized: phoneNormalized,
        },
      },
      include: { brokerEmployee: { include: employeeInclude } },
    });
  }

  findEmployeeById(employeeId: string) {
    return getPrisma().brokerEmployee.findUnique({
      where: { id: employeeId },
      include: employeeInclude,
    });
  }

  createOtpChallenge(
    data: {
      brokerEmployeeId: string;
      identityType: IdentityType;
      identityValue: string;
      purpose: BrokerOtpPurpose;
      codeHash: string;
      maxAttempts: number;
      expiresAt: Date;
      requestId?: string;
    },
    tx?: PrismaTx,
  ) {
    return client(tx).brokerOtpChallenge.create({ data });
  }

  findOtpChallengeById(id: string) {
    return getPrisma().brokerOtpChallenge.findUnique({ where: { id } });
  }

  findLatestPendingOtp(brokerEmployeeId: string, purpose: BrokerOtpPurpose) {
    return getPrisma().brokerOtpChallenge.findFirst({
      where: { brokerEmployeeId, purpose, status: OtpChallengeStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    });
  }

  updateOtpChallenge(id: string, data: Prisma.BrokerOtpChallengeUpdateInput, tx?: PrismaTx) {
    return client(tx).brokerOtpChallenge.update({ where: { id }, data });
  }

  createRefreshSession(
    data: {
      brokerEmployeeId: string;
      tokenHash: string;
      familyId: string;
      userAgent?: string;
      ipAddress?: string;
      expiresAt: Date;
    },
    tx?: PrismaTx,
  ) {
    return client(tx).brokerRefreshSession.create({ data });
  }

  findRefreshSessionByHash(tokenHash: string) {
    return getPrisma().brokerRefreshSession.findUnique({
      where: { tokenHash },
      include: { brokerEmployee: { include: { office: true } } },
    });
  }

  updateRefreshSession(id: string, data: Prisma.BrokerRefreshSessionUpdateInput, tx?: PrismaTx) {
    return client(tx).brokerRefreshSession.update({ where: { id }, data });
  }

  revokeSession(id: string, reason: string, tx?: PrismaTx) {
    return client(tx).brokerRefreshSession.update({
      where: { id },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }

  revokeFamily(familyId: string, reason: string, tx?: PrismaTx) {
    return client(tx).brokerRefreshSession.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }

  revokeAllForEmployee(brokerEmployeeId: string, reason: string, tx?: PrismaTx) {
    return client(tx).brokerRefreshSession.updateMany({
      where: { brokerEmployeeId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }

  touchLogin(employeeId: string, tx?: PrismaTx) {
    return client(tx).brokerEmployee.update({
      where: { id: employeeId },
      data: { lastLoginAt: new Date() },
    });
  }
}

export const brokerAuthRepository = new BrokerAuthRepository();
