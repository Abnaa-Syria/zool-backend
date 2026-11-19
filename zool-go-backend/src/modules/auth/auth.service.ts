import {
  AdminStatus,
  IdentityType,
  OtpChallengeStatus,
  OtpPurpose,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { env } from '../../config/env';
import { getPrisma } from '../../infrastructure/database/prisma';
import { getRedis, redisKey } from '../../infrastructure/redis/redis';
import { AppError } from '../../shared/errors/app-error';
import {
  cachePermissions,
  invalidatePermissionCache,
  setAuthzVersion,
} from '../../shared/security/authz-cache';
import {
  generateOtp,
  hmacOtp,
  randomToken,
  sha256Hex,
  timingSafeEqualString,
} from '../../shared/security/crypto';
import { signAccessToken } from '../../shared/security/tokens';
import {
  isPermissionKey,
  type PermissionKey,
} from '../../shared/constants/permissions';
import { normalizePhone } from '../../shared/utils/phone';
import { auditService } from '../audit/audit.service';
import { AuthErrors } from './auth.errors';
import { OTP_REDIS } from './auth.constants';
import type { AuthMeDto, AuthTokensDto, OtpRequestResultDto } from './auth.dto';
import { authRepository } from './auth.repository';
import { getOtpDeliveryProvider } from './otp-delivery';

function shouldExposeDevOtp(): boolean {
  const e = env();
  return e.NODE_ENV !== 'production' && e.OTP_DEV_EXPOSE === true;
}

function primaryPhone(
  admin: NonNullable<Awaited<ReturnType<typeof authRepository.findAdminById>>>,
): string | null {
  return (
    admin.identities.find((i) => i.type === IdentityType.PHONE && i.isPrimary)?.valueNormalized ??
    admin.identities.find((i) => i.type === IdentityType.PHONE)?.valueNormalized ??
    null
  );
}

function mapAdminToMeDto(admin: NonNullable<Awaited<ReturnType<typeof authRepository.findAdminById>>>): AuthMeDto {
  const roles = admin.userRoles
    .filter((ur) => ur.role.isActive)
    .map((ur) => ({ id: ur.role.id, key: ur.role.key, name: ur.role.name }));

  const permissions = new Set<PermissionKey>();
  for (const ur of admin.userRoles) {
    if (!ur.role.isActive) continue;
    for (const rp of ur.role.rolePermissions) {
      if (isPermissionKey(rp.permission.key)) {
        permissions.add(rp.permission.key);
      }
    }
  }

  return {
    id: admin.id,
    employeeCode: admin.employeeCode,
    displayName: admin.displayName,
    status: admin.status,
    isBootstrap: admin.isBootstrap,
    roles,
    permissions: [...permissions],
    identities: admin.identities.map((i) => ({
      type: i.type,
      value: i.valueNormalized,
      isPrimary: i.isPrimary,
    })),
  };
}

async function enforceRedisRateLimit(key: string, max: number, windowSeconds: number): Promise<void> {
  const redis = getRedis();
  const namespaced = redisKey(key);
  const count = await redis.incr(namespaced);
  if (count === 1) {
    await redis.expire(namespaced, windowSeconds);
  }
  if (count > max) {
    throw AppError.rateLimited('Rate limit exceeded', { retryAfterSeconds: windowSeconds });
  }
}

export class AuthService {
  async requestOtp(input: { phone: string; requestId?: string }): Promise<OtpRequestResultDto> {
    const phone = normalizePhone(input.phone);
    const e = env();

    try {
      await enforceRedisRateLimit(
        OTP_REDIS.requestRate(phone),
        e.OTP_REQUEST_RATE_LIMIT_MAX,
        e.OTP_REQUEST_RATE_LIMIT_WINDOW_SECONDS,
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw AppError.internal('OTP rate limiting unavailable');
    }

    const redis = getRedis();
    const cooldownKey = redisKey(OTP_REDIS.cooldown(phone));
    const ttl = await redis.ttl(cooldownKey);
    if (ttl > 0) {
      throw AuthErrors.cooldown(ttl);
    }

    const identity = await authRepository.findActiveAdminByPhone(phone);
    if (!identity || identity.adminUser.status !== AdminStatus.ACTIVE) {
      await auditService.record({
        action: 'auth.otp.request_rejected',
        resourceType: 'admin_identity',
        requestId: input.requestId,
        metadata: { phone, reason: 'unknown_or_inactive' },
      });
      // Uniform response shape timing: still set a short cooldown to reduce enumeration usefulness
      await redis.set(cooldownKey, '1', 'EX', e.OTP_RESEND_COOLDOWN_SECONDS);
      throw AppError.unauthorized('No active admin found for this phone');
    }

    const code = generateOtp(e.OTP_LENGTH);
    const codeHash = hmacOtp(code, e.OTP_HMAC_SECRET);
    const expiresAt = new Date(Date.now() + e.OTP_TTL_SECONDS * 1000);

    const challenge = await authRepository.createOtpChallenge({
      adminUserId: identity.adminUserId,
      identityType: IdentityType.PHONE,
      identityValue: phone,
      purpose: OtpPurpose.ADMIN_LOGIN,
      codeHash,
      maxAttempts: e.OTP_MAX_ATTEMPTS,
      expiresAt,
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });

    await redis.set(cooldownKey, '1', 'EX', e.OTP_RESEND_COOLDOWN_SECONDS);
    await redis.set(
      redisKey(OTP_REDIS.activeChallenge(phone)),
      challenge.id,
      'EX',
      e.OTP_TTL_SECONDS,
    );

    await getOtpDeliveryProvider().sendOtp({
      destination: phone,
      code,
      purpose: OtpPurpose.ADMIN_LOGIN,
    });

    await auditService.record({
      actorAdminId: identity.adminUserId,
      action: 'auth.otp.requested',
      resourceType: 'otp_challenge',
      resourceId: challenge.id,
      requestId: input.requestId,
      metadata: { phone },
    });

    const result: OtpRequestResultDto = {
      challengeId: challenge.id,
      expiresAt: expiresAt.toISOString(),
      cooldownSeconds: e.OTP_RESEND_COOLDOWN_SECONDS,
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
  }): Promise<{ tokens: AuthTokensDto; refreshToken: string }> {
    const phone = normalizePhone(input.phone);
    const e = env();

    try {
      await enforceRedisRateLimit(
        OTP_REDIS.verifyRate(phone),
        e.OTP_VERIFY_RATE_LIMIT_MAX,
        e.OTP_VERIFY_RATE_LIMIT_WINDOW_SECONDS,
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw AppError.internal('OTP verification rate limiting unavailable');
    }

    const identity = await authRepository.findActiveAdminByPhone(phone);
    if (!identity || identity.adminUser.status !== AdminStatus.ACTIVE) {
      await auditService.record({
        action: 'auth.otp.verify_failed',
        resourceType: 'admin_identity',
        requestId: input.requestId,
        metadata: { phone, reason: 'unknown_or_inactive' },
      });
      throw AppError.unauthorized('No active admin found for this phone');
    }

    const challenge = input.challengeId
      ? await authRepository.findOtpChallengeById(input.challengeId)
      : await authRepository.findLatestPendingOtp(identity.adminUserId, OtpPurpose.ADMIN_LOGIN);

    if (!challenge || challenge.identityValue !== phone || challenge.purpose !== OtpPurpose.ADMIN_LOGIN) {
      throw AuthErrors.invalidOtp();
    }

    if (challenge.status === OtpChallengeStatus.LOCKED) {
      throw AuthErrors.lockedOtp();
    }
    if (challenge.status === OtpChallengeStatus.CONSUMED) {
      throw AuthErrors.invalidOtp();
    }
    if (challenge.status === OtpChallengeStatus.EXPIRED || challenge.expiresAt.getTime() < Date.now()) {
      await authRepository.updateOtpChallenge(challenge.id, { status: OtpChallengeStatus.EXPIRED });
      throw AuthErrors.expiredOtp();
    }

    const expectedHash = hmacOtp(input.code, e.OTP_HMAC_SECRET);
    const matches = timingSafeEqualString(expectedHash, challenge.codeHash);

    if (!matches) {
      const attemptCount = challenge.attemptCount + 1;
      const locked = attemptCount >= challenge.maxAttempts;
      await authRepository.updateOtpChallenge(challenge.id, {
        attemptCount,
        status: locked ? OtpChallengeStatus.LOCKED : OtpChallengeStatus.PENDING,
      });
      await auditService.record({
        actorAdminId: identity.adminUserId,
        action: 'auth.otp.verify_failed',
        resourceType: 'otp_challenge',
        resourceId: challenge.id,
        requestId: input.requestId,
        metadata: { reason: locked ? 'locked' : 'invalid_code' },
      });
      if (locked) throw AuthErrors.lockedOtp();
      throw AuthErrors.invalidOtp();
    }

    const refreshToken = randomToken(48);
    const tokenHash = sha256Hex(refreshToken);
    const familyId = randomUUID();
    const expiresAt = new Date(Date.now() + e.REFRESH_TOKEN_TTL_SECONDS * 1000);

    const session = await getPrisma().$transaction(async (tx) => {
      await authRepository.updateOtpChallenge(
        challenge.id,
        { status: OtpChallengeStatus.CONSUMED, consumedAt: new Date() },
        tx,
      );
      await authRepository.touchAdminLogin(identity.adminUserId, tx);
      return authRepository.createRefreshSession(
        {
          adminUserId: identity.adminUserId,
          tokenHash,
          familyId,
          expiresAt,
          ...(input.userAgent ? { userAgent: input.userAgent } : {}),
          ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
        },
        tx,
      );
    });

    await setAuthzVersion(identity.adminUserId, identity.adminUser.authzVersion);
    const admin = await authRepository.findAdminById(identity.adminUserId);
    if (!admin) throw AppError.unauthorized();
    const me = mapAdminToMeDto(admin);
    await cachePermissions(admin.id, me.permissions);

    const accessToken = signAccessToken({
      adminId: admin.id,
      sessionId: session.id,
      authzVersion: admin.authzVersion,
    });

    await auditService.record({
      actorAdminId: admin.id,
      action: 'auth.login.success',
      resourceType: 'refresh_session',
      resourceId: session.id,
      requestId: input.requestId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return {
      refreshToken,
      tokens: {
        accessToken,
        tokenType: 'Bearer',
        expiresIn: e.JWT_ACCESS_TTL_SECONDS,
        admin: me,
      },
    };
  }

  async refresh(input: {
    refreshToken?: string;
    requestId?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{ tokens: AuthTokensDto; refreshToken: string }> {
    if (!input.refreshToken) {
      throw AuthErrors.sessionInvalid();
    }

    const tokenHash = sha256Hex(input.refreshToken);
    const existing = await authRepository.findRefreshSessionByHash(tokenHash);
    if (!existing) {
      throw AuthErrors.sessionInvalid();
    }

    if (existing.revokedAt) {
      // Possible reuse of rotated token — revoke family
      await authRepository.revokeFamily(existing.familyId, 'refresh_reuse_detected');
      await invalidatePermissionCache(existing.adminUserId);
      await auditService.record({
        actorAdminId: existing.adminUserId,
        action: 'auth.refresh.reuse_detected',
        resourceType: 'refresh_session',
        resourceId: existing.id,
        requestId: input.requestId,
      });
      throw AuthErrors.sessionInvalid();
    }

    if (existing.expiresAt.getTime() < Date.now()) {
      await authRepository.revokeSession(existing.id, 'expired');
      throw AuthErrors.sessionInvalid();
    }

    if (existing.adminUser.status !== AdminStatus.ACTIVE) {
      await authRepository.revokeAllSessions(existing.adminUserId, 'admin_suspended');
      throw AppError.unauthorized('Admin account is suspended');
    }

    const newRefresh = randomToken(48);
    const newHash = sha256Hex(newRefresh);
    const expiresAt = new Date(Date.now() + env().REFRESH_TOKEN_TTL_SECONDS * 1000);

    const newSession = await getPrisma().$transaction(async (tx) => {
      const created = await authRepository.createRefreshSession(
        {
          adminUserId: existing.adminUserId,
          tokenHash: newHash,
          familyId: existing.familyId,
          expiresAt,
          ...(input.userAgent ? { userAgent: input.userAgent } : {}),
          ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
        },
        tx,
      );
      await authRepository.updateRefreshSession(
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

    await setAuthzVersion(existing.adminUserId, existing.adminUser.authzVersion);
    const admin = await authRepository.findAdminById(existing.adminUserId);
    if (!admin) throw AuthErrors.sessionInvalid();
    const me = mapAdminToMeDto(admin);
    await cachePermissions(admin.id, me.permissions);

    const accessToken = signAccessToken({
      adminId: admin.id,
      sessionId: newSession.id,
      authzVersion: admin.authzVersion,
    });

    return {
      refreshToken: newRefresh,
      tokens: {
        accessToken,
        tokenType: 'Bearer',
        expiresIn: env().JWT_ACCESS_TTL_SECONDS,
        admin: me,
      },
    };
  }

  async logout(input: { refreshToken?: string; adminId?: string; requestId?: string }): Promise<void> {
    if (!input.refreshToken) return;
    const tokenHash = sha256Hex(input.refreshToken);
    const session = await authRepository.findRefreshSessionByHash(tokenHash);
    if (!session || session.revokedAt) return;
    await authRepository.revokeSession(session.id, 'logout');
    await auditService.record({
      actorAdminId: input.adminId ?? session.adminUserId,
      action: 'auth.logout',
      resourceType: 'refresh_session',
      resourceId: session.id,
      requestId: input.requestId,
    });
  }

  async logoutAll(adminId: string, requestId?: string): Promise<void> {
    await authRepository.revokeAllSessions(adminId, 'logout_all');
    await invalidatePermissionCache(adminId);
    // Bump authz so existing access tokens fail quickly
    const admin = await getPrisma().adminUser.update({
      where: { id: adminId },
      data: { authzVersion: { increment: 1 } },
    });
    await setAuthzVersion(adminId, admin.authzVersion);
    await auditService.record({
      actorAdminId: adminId,
      action: 'auth.logout_all',
      resourceType: 'admin_user',
      resourceId: adminId,
      requestId,
    });
  }

  async me(adminId: string): Promise<AuthMeDto> {
    const admin = await authRepository.findAdminById(adminId);
    if (!admin || admin.status !== AdminStatus.ACTIVE) {
      throw AppError.unauthorized();
    }
    return mapAdminToMeDto(admin);
  }

  /**
   * Authenticated self-service: OTP is sent to the *new* number.
   * Does not issue tokens. Bound to `adminId`; no permission required.
   */
  async requestPhoneChangeOtp(input: {
    adminId: string;
    phone: string;
    requestId?: string;
  }): Promise<OtpRequestResultDto> {
    const phone = normalizePhone(input.phone);
    const e = env();
    const rateIdentity = OTP_REDIS.phoneChange(phone);
    const adminRateIdentity = OTP_REDIS.phoneChange(`admin:${input.adminId}`);

    try {
      await enforceRedisRateLimit(
        OTP_REDIS.requestRate(adminRateIdentity),
        e.OTP_REQUEST_RATE_LIMIT_MAX,
        e.OTP_REQUEST_RATE_LIMIT_WINDOW_SECONDS,
      );
      await enforceRedisRateLimit(
        OTP_REDIS.requestRate(rateIdentity),
        e.OTP_REQUEST_RATE_LIMIT_MAX,
        e.OTP_REQUEST_RATE_LIMIT_WINDOW_SECONDS,
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw AppError.internal('OTP rate limiting unavailable');
    }

    const redis = getRedis();
    const cooldownKey = redisKey(OTP_REDIS.cooldown(rateIdentity));
    const ttl = await redis.ttl(cooldownKey);
    if (ttl > 0) {
      throw AuthErrors.cooldown(ttl);
    }

    const admin = await authRepository.findAdminById(input.adminId);
    if (!admin || admin.status !== AdminStatus.ACTIVE) {
      throw AppError.unauthorized();
    }

    const current = primaryPhone(admin);
    if (current === phone) {
      throw AppError.validation('Phone is already registered to your account', { field: 'phone' });
    }

    const taken = await authRepository.findActiveAdminByPhone(phone);
    if (taken) {
      throw AppError.conflict('Phone identity already registered');
    }

    const code = generateOtp(e.OTP_LENGTH);
    const codeHash = hmacOtp(code, e.OTP_HMAC_SECRET);
    const expiresAt = new Date(Date.now() + e.OTP_TTL_SECONDS * 1000);

    const challenge = await authRepository.createOtpChallenge({
      adminUserId: admin.id,
      identityType: IdentityType.PHONE,
      identityValue: phone,
      purpose: OtpPurpose.ADMIN_PHONE_CHANGE,
      codeHash,
      maxAttempts: e.OTP_MAX_ATTEMPTS,
      expiresAt,
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });

    await redis.set(cooldownKey, '1', 'EX', e.OTP_RESEND_COOLDOWN_SECONDS);
    await redis.set(
      redisKey(OTP_REDIS.activeChallenge(rateIdentity)),
      challenge.id,
      'EX',
      e.OTP_TTL_SECONDS,
    );

    await getOtpDeliveryProvider().sendOtp({
      destination: phone,
      code,
      purpose: OtpPurpose.ADMIN_PHONE_CHANGE,
    });

    await auditService.record({
      actorAdminId: admin.id,
      action: 'auth.phone_change.otp_requested',
      resourceType: 'otp_challenge',
      resourceId: challenge.id,
      requestId: input.requestId,
      metadata: { phone },
    });

    const result: OtpRequestResultDto = {
      challengeId: challenge.id,
      expiresAt: expiresAt.toISOString(),
      cooldownSeconds: e.OTP_RESEND_COOLDOWN_SECONDS,
    };

    if (shouldExposeDevOtp()) {
      result.devOtp = code;
    }

    return result;
  }

  async verifyPhoneChangeOtp(input: {
    adminId: string;
    phone: string;
    code: string;
    challengeId?: string;
    requestId?: string;
  }): Promise<AuthMeDto> {
    const phone = normalizePhone(input.phone);
    const e = env();
    const rateIdentity = OTP_REDIS.phoneChange(phone);
    const adminRateIdentity = OTP_REDIS.phoneChange(`admin:${input.adminId}`);

    try {
      await enforceRedisRateLimit(
        OTP_REDIS.verifyRate(adminRateIdentity),
        e.OTP_VERIFY_RATE_LIMIT_MAX,
        e.OTP_VERIFY_RATE_LIMIT_WINDOW_SECONDS,
      );
      await enforceRedisRateLimit(
        OTP_REDIS.verifyRate(rateIdentity),
        e.OTP_VERIFY_RATE_LIMIT_MAX,
        e.OTP_VERIFY_RATE_LIMIT_WINDOW_SECONDS,
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw AppError.internal('OTP verification rate limiting unavailable');
    }

    const admin = await authRepository.findAdminById(input.adminId);
    if (!admin || admin.status !== AdminStatus.ACTIVE) {
      throw AppError.unauthorized();
    }

    const current = primaryPhone(admin);
    if (current === phone) {
      throw AppError.validation('Phone is already registered to your account', { field: 'phone' });
    }

    const taken = await authRepository.findActiveAdminByPhone(phone);
    if (taken && taken.adminUserId !== admin.id) {
      throw AppError.conflict('Phone identity already registered');
    }

    const challenge = input.challengeId
      ? await authRepository.findOtpChallengeById(input.challengeId)
      : await authRepository.findLatestPendingOtp(admin.id, OtpPurpose.ADMIN_PHONE_CHANGE);

    if (
      !challenge ||
      challenge.adminUserId !== admin.id ||
      challenge.identityValue !== phone ||
      challenge.purpose !== OtpPurpose.ADMIN_PHONE_CHANGE
    ) {
      throw AuthErrors.invalidOtp();
    }

    if (challenge.status === OtpChallengeStatus.LOCKED) {
      throw AuthErrors.lockedOtp();
    }
    if (challenge.status === OtpChallengeStatus.CONSUMED) {
      throw AuthErrors.invalidOtp();
    }
    if (challenge.status === OtpChallengeStatus.EXPIRED || challenge.expiresAt.getTime() < Date.now()) {
      await authRepository.updateOtpChallenge(challenge.id, { status: OtpChallengeStatus.EXPIRED });
      throw AuthErrors.expiredOtp();
    }

    const expectedHash = hmacOtp(input.code, e.OTP_HMAC_SECRET);
    const matches = timingSafeEqualString(expectedHash, challenge.codeHash);

    if (!matches) {
      const attemptCount = challenge.attemptCount + 1;
      const locked = attemptCount >= challenge.maxAttempts;
      await authRepository.updateOtpChallenge(challenge.id, {
        attemptCount,
        status: locked ? OtpChallengeStatus.LOCKED : OtpChallengeStatus.PENDING,
      });
      await auditService.record({
        actorAdminId: admin.id,
        action: 'auth.phone_change.otp_verify_failed',
        resourceType: 'otp_challenge',
        resourceId: challenge.id,
        requestId: input.requestId,
        metadata: { reason: locked ? 'locked' : 'invalid_code' },
      });
      if (locked) throw AuthErrors.lockedOtp();
      throw AuthErrors.invalidOtp();
    }

    try {
      await getPrisma().$transaction(async (tx) => {
        await authRepository.updateOtpChallenge(
          challenge.id,
          { status: OtpChallengeStatus.CONSUMED, consumedAt: new Date() },
          tx,
        );
        await authRepository.expirePendingOtpChallenges(
          admin.id,
          OtpPurpose.ADMIN_PHONE_CHANGE,
          challenge.id,
          tx,
        );
        await authRepository.updatePrimaryPhoneIdentity(admin.id, phone, tx);
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'P2002') {
        throw AppError.conflict('Phone identity already registered');
      }
      throw error;
    }

    const updated = await authRepository.findAdminById(admin.id);
    if (!updated) throw AppError.unauthorized();

    await auditService.record({
      actorAdminId: admin.id,
      action: 'admin.phone_changed',
      resourceType: 'admin_user',
      resourceId: admin.id,
      requestId: input.requestId,
      metadata: { before: current, after: phone },
    });

    return mapAdminToMeDto(updated);
  }
}

export const authService = new AuthService();
