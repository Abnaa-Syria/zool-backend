import {
  BrokerEmployeeStatus,
  BrokerOfficeStatus,
  BrokerOtpPurpose,
  IdentityType,
  OtpChallengeStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { env } from '../../config/env';
import { otpPolicy } from '../../shared/security/otp-policy';
import { getPrisma } from '../../infrastructure/database/prisma';
import { getRedis, redisKey } from '../../infrastructure/redis/redis';
import {
  brokerPermissionsFromFlags,
  type BrokerEmployeeFlags,
} from '../../shared/constants/broker-permissions';
import { AppError } from '../../shared/errors/app-error';
import { setBrokerAuthzVersion } from '../../shared/security/broker-authz-cache';
import { signBrokerAccessToken } from '../../shared/security/broker-tokens';
import {
  generateOtp,
  hmacOtp,
  randomToken,
  sha256Hex,
  timingSafeEqualString,
} from '../../shared/security/crypto';
import { enforceRedisRateLimit } from '../../shared/security/redis-rate-limit';
import { normalizePhone } from '../../shared/utils/phone';
import { auditService } from '../audit/audit.service';
import { AuthErrors } from '../auth/auth.errors';
import { getOtpDeliveryProvider } from '../auth/otp-delivery';
import type {
  BrokerAuthTokensDto,
  BrokerMeDto,
  BrokerOtpRequestResultDto,
} from './broker-auth.dto';
import { brokerAuthRepository, type BrokerEmployeeWithOffice } from './broker-auth.repository';
import { BROKER_OTP_REDIS } from './broker-auth.constants';

function shouldExposeDevOtp(): boolean {
  const e = env();
  return e.NODE_ENV !== 'production' && e.OTP_DEV_EXPOSE === true;
}

function flagsOf(employee: BrokerEmployeeFlags): BrokerEmployeeFlags {
  return {
    canBook: employee.canBook,
    canTopUp: employee.canTopUp,
    canViewReports: employee.canViewReports,
    canManageStaff: employee.canManageStaff,
  };
}

export function mapEmployeeToMeDto(employee: BrokerEmployeeWithOffice): BrokerMeDto {
  const flags = flagsOf(employee);
  return {
    id: employee.id,
    displayName: employee.displayName,
    role: employee.role,
    status: employee.status,
    permissions: brokerPermissionsFromFlags(flags),
    flags,
    office: {
      id: employee.office.id,
      code: employee.office.code,
      name: employee.office.name,
      status: employee.office.status,
    },
    identities: employee.identities.map((i) => ({
      type: i.type,
      value: i.valueNormalized,
      isPrimary: i.isPrimary,
    })),
  };
}

function assertEmployeeUsable(employee: BrokerEmployeeWithOffice): void {
  if (employee.status !== BrokerEmployeeStatus.ACTIVE) {
    throw AppError.unauthorized('Broker employee account is suspended');
  }
  if (employee.office.status !== BrokerOfficeStatus.ACTIVE) {
    throw AppError.unauthorized('Broker office is suspended');
  }
}

function isUsable(employee: BrokerEmployeeWithOffice): boolean {
  return (
    employee.status === BrokerEmployeeStatus.ACTIVE &&
    employee.office.status === BrokerOfficeStatus.ACTIVE
  );
}

export class BrokerAuthService {
  async requestOtp(input: {
    phone: string;
    requestId?: string;
  }): Promise<BrokerOtpRequestResultDto> {
    const phone = normalizePhone(input.phone);
    const e = env();

    try {
      await enforceRedisRateLimit(
        BROKER_OTP_REDIS.requestRate(phone),
        otpPolicy().requestsPerPhone,
        e.OTP_REQUEST_RATE_LIMIT_WINDOW_SECONDS,
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw AppError.internal('OTP rate limiting unavailable');
    }

    const redis = getRedis();
    const cooldownKey = redisKey(BROKER_OTP_REDIS.cooldown(phone));
    const ttl = await redis.ttl(cooldownKey);
    if (ttl > 0) {
      throw AuthErrors.cooldown(ttl);
    }

    const identity = await brokerAuthRepository.findIdentityByPhone(phone);
    if (!identity || !isUsable(identity.brokerEmployee)) {
      await auditService.record({
        action: 'broker.auth.otp.request_rejected',
        resourceType: 'broker_identity',
        requestId: input.requestId,
        metadata: { phone, reason: 'unknown_or_inactive' },
      });
      await redis.set(cooldownKey, '1', 'EX', otpPolicy().cooldownSeconds);
      throw AppError.unauthorized('No active broker employee found for this phone');
    }

    const code = generateOtp(e.OTP_LENGTH);
    const codeHash = hmacOtp(code, e.OTP_HMAC_SECRET);
    const expiresAt = new Date(Date.now() + e.OTP_TTL_SECONDS * 1000);

    const challenge = await brokerAuthRepository.createOtpChallenge({
      brokerEmployeeId: identity.brokerEmployeeId,
      identityType: IdentityType.PHONE,
      identityValue: phone,
      purpose: BrokerOtpPurpose.BROKER_LOGIN,
      codeHash,
      maxAttempts: otpPolicy().maxAttempts,
      expiresAt,
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });

    await redis.set(cooldownKey, '1', 'EX', otpPolicy().cooldownSeconds);
    await redis.set(
      redisKey(BROKER_OTP_REDIS.activeChallenge(phone)),
      challenge.id,
      'EX',
      e.OTP_TTL_SECONDS,
    );

    await getOtpDeliveryProvider().sendOtp({
      destination: phone,
      code,
      purpose: BrokerOtpPurpose.BROKER_LOGIN,
    });

    await auditService.record({
      action: 'broker.auth.otp.requested',
      resourceType: 'broker_otp_challenge',
      resourceId: challenge.id,
      requestId: input.requestId,
      metadata: { phone, employeeId: identity.brokerEmployeeId },
    });

    const result: BrokerOtpRequestResultDto = {
      challengeId: challenge.id,
      expiresAt: expiresAt.toISOString(),
      cooldownSeconds: otpPolicy().cooldownSeconds,
    };

    if (shouldExposeDevOtp()) {
      result.devOtp = code;
    }

    return result;
  }

  async verifyOtp(input: {
    phone: string;
    code: string;
    challengeId?: string;
    requestId?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{ tokens: BrokerAuthTokensDto; refreshToken: string }> {
    const phone = normalizePhone(input.phone);
    const e = env();

    try {
      await enforceRedisRateLimit(
        BROKER_OTP_REDIS.verifyRate(phone),
        otpPolicy().verifiesPerPhone,
        e.OTP_VERIFY_RATE_LIMIT_WINDOW_SECONDS,
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw AppError.internal('OTP verification rate limiting unavailable');
    }

    const identity = await brokerAuthRepository.findIdentityByPhone(phone);
    if (!identity || !isUsable(identity.brokerEmployee)) {
      await auditService.record({
        action: 'broker.auth.otp.verify_failed',
        resourceType: 'broker_identity',
        requestId: input.requestId,
        metadata: { phone, reason: 'unknown_or_inactive' },
      });
      throw AppError.unauthorized('No active broker employee found for this phone');
    }
    const employeeId = identity.brokerEmployeeId;

    const challenge = input.challengeId
      ? await brokerAuthRepository.findOtpChallengeById(input.challengeId)
      : await brokerAuthRepository.findLatestPendingOtp(employeeId, BrokerOtpPurpose.BROKER_LOGIN);

    if (
      !challenge ||
      challenge.identityValue !== phone ||
      challenge.purpose !== BrokerOtpPurpose.BROKER_LOGIN
    ) {
      throw AuthErrors.invalidOtp();
    }

    if (challenge.status === OtpChallengeStatus.LOCKED) {
      throw AuthErrors.lockedOtp();
    }
    if (challenge.status === OtpChallengeStatus.CONSUMED) {
      throw AuthErrors.invalidOtp();
    }
    if (
      challenge.status === OtpChallengeStatus.EXPIRED ||
      challenge.expiresAt.getTime() < Date.now()
    ) {
      await brokerAuthRepository.updateOtpChallenge(challenge.id, {
        status: OtpChallengeStatus.EXPIRED,
      });
      throw AuthErrors.expiredOtp();
    }

    const expectedHash = hmacOtp(input.code, e.OTP_HMAC_SECRET);
    const matches = timingSafeEqualString(expectedHash, challenge.codeHash);

    if (!matches) {
      const attemptCount = challenge.attemptCount + 1;
      const locked = attemptCount >= challenge.maxAttempts;
      await brokerAuthRepository.updateOtpChallenge(challenge.id, {
        attemptCount,
        status: locked ? OtpChallengeStatus.LOCKED : OtpChallengeStatus.PENDING,
      });
      await auditService.record({
        action: 'broker.auth.otp.verify_failed',
        resourceType: 'broker_otp_challenge',
        resourceId: challenge.id,
        requestId: input.requestId,
        metadata: { employeeId, reason: locked ? 'locked' : 'invalid_code' },
      });
      if (locked) throw AuthErrors.lockedOtp();
      throw AuthErrors.invalidOtp();
    }

    const refreshToken = randomToken(48);
    const tokenHash = sha256Hex(refreshToken);
    const familyId = randomUUID();
    const expiresAt = new Date(Date.now() + e.REFRESH_TOKEN_TTL_SECONDS * 1000);

    const session = await getPrisma().$transaction(async (tx) => {
      await brokerAuthRepository.updateOtpChallenge(
        challenge.id,
        { status: OtpChallengeStatus.CONSUMED, consumedAt: new Date() },
        tx,
      );
      await brokerAuthRepository.touchLogin(employeeId, tx);
      return brokerAuthRepository.createRefreshSession(
        {
          brokerEmployeeId: employeeId,
          tokenHash,
          familyId,
          expiresAt,
          ...(input.userAgent ? { userAgent: input.userAgent } : {}),
          ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
        },
        tx,
      );
    });

    const employee = await brokerAuthRepository.findEmployeeById(employeeId);
    if (!employee) throw AppError.unauthorized();
    await setBrokerAuthzVersion(employee.id, employee.authzVersion);

    const accessToken = signBrokerAccessToken({
      employeeId: employee.id,
      officeId: employee.officeId,
      sessionId: session.id,
      authzVersion: employee.authzVersion,
    });

    await auditService.record({
      action: 'broker.auth.login.success',
      resourceType: 'broker_refresh_session',
      resourceId: session.id,
      requestId: input.requestId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      metadata: { employeeId: employee.id, officeId: employee.officeId },
    });

    return {
      refreshToken,
      tokens: {
        accessToken,
        tokenType: 'Bearer',
        expiresIn: e.JWT_ACCESS_TTL_SECONDS,
        employee: mapEmployeeToMeDto(employee),
      },
    };
  }

  async refresh(input: {
    refreshToken?: string;
    requestId?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{ tokens: BrokerAuthTokensDto; refreshToken: string }> {
    if (!input.refreshToken) {
      throw AuthErrors.sessionInvalid();
    }

    const tokenHash = sha256Hex(input.refreshToken);
    const existing = await brokerAuthRepository.findRefreshSessionByHash(tokenHash);
    if (!existing) {
      throw AuthErrors.sessionInvalid();
    }

    if (existing.revokedAt) {
      await brokerAuthRepository.revokeFamily(existing.familyId, 'refresh_reuse_detected');
      await auditService.record({
        action: 'broker.auth.refresh.reuse_detected',
        resourceType: 'broker_refresh_session',
        resourceId: existing.id,
        requestId: input.requestId,
        metadata: { employeeId: existing.brokerEmployeeId },
      });
      throw AuthErrors.sessionInvalid();
    }

    if (existing.expiresAt.getTime() < Date.now()) {
      await brokerAuthRepository.revokeSession(existing.id, 'expired');
      throw AuthErrors.sessionInvalid();
    }

    if (
      existing.brokerEmployee.status !== BrokerEmployeeStatus.ACTIVE ||
      existing.brokerEmployee.office.status !== BrokerOfficeStatus.ACTIVE
    ) {
      await brokerAuthRepository.revokeAllForEmployee(
        existing.brokerEmployeeId,
        'employee_or_office_suspended',
      );
      throw AppError.unauthorized('Broker account is suspended');
    }

    const newRefresh = randomToken(48);
    const newHash = sha256Hex(newRefresh);
    const expiresAt = new Date(Date.now() + env().REFRESH_TOKEN_TTL_SECONDS * 1000);

    const newSession = await getPrisma().$transaction(async (tx) => {
      const created = await brokerAuthRepository.createRefreshSession(
        {
          brokerEmployeeId: existing.brokerEmployeeId,
          tokenHash: newHash,
          familyId: existing.familyId,
          expiresAt,
          ...(input.userAgent ? { userAgent: input.userAgent } : {}),
          ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
        },
        tx,
      );
      await brokerAuthRepository.updateRefreshSession(
        existing.id,
        {
          revokedAt: new Date(),
          revokeReason: 'rotated',
          replacedById: created.id,
          lastUsedAt: new Date(),
        },
        tx,
      );
      return created;
    });

    const employee = await brokerAuthRepository.findEmployeeById(existing.brokerEmployeeId);
    if (!employee) throw AuthErrors.sessionInvalid();
    await setBrokerAuthzVersion(employee.id, employee.authzVersion);

    const accessToken = signBrokerAccessToken({
      employeeId: employee.id,
      officeId: employee.officeId,
      sessionId: newSession.id,
      authzVersion: employee.authzVersion,
    });

    return {
      refreshToken: newRefresh,
      tokens: {
        accessToken,
        tokenType: 'Bearer',
        expiresIn: env().JWT_ACCESS_TTL_SECONDS,
        employee: mapEmployeeToMeDto(employee),
      },
    };
  }

  async logout(input: { refreshToken?: string; requestId?: string }): Promise<void> {
    if (!input.refreshToken) return;
    const tokenHash = sha256Hex(input.refreshToken);
    const session = await brokerAuthRepository.findRefreshSessionByHash(tokenHash);
    if (!session || session.revokedAt) return;
    await brokerAuthRepository.revokeSession(session.id, 'logout');
    await auditService.record({
      action: 'broker.auth.logout',
      resourceType: 'broker_refresh_session',
      resourceId: session.id,
      requestId: input.requestId,
      metadata: { employeeId: session.brokerEmployeeId },
    });
  }

  async me(employeeId: string): Promise<BrokerMeDto> {
    const employee = await brokerAuthRepository.findEmployeeById(employeeId);
    if (!employee) throw AppError.unauthorized();
    assertEmployeeUsable(employee);
    return mapEmployeeToMeDto(employee);
  }
}

export const brokerAuthService = new BrokerAuthService();
