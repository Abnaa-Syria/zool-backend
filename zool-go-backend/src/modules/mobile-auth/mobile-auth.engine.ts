import { OtpChallengeStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { env } from '../../config/env';
import { otpPolicy } from '../../shared/security/otp-policy';
import { getPrisma, type PrismaTx } from '../../infrastructure/database/prisma';
import { getRedis, redisKey } from '../../infrastructure/redis/redis';
import { AppError } from '../../shared/errors/app-error';
import { hmacOtp, otpCodeFor, randomToken, sha256Hex, timingSafeEqualString } from '../../shared/security/crypto';
import { signMobileAccessToken } from '../../shared/security/mobile-tokens';
import { setPrincipalAuthzVersion, type MobilePrincipal } from '../../shared/security/principal-authz-cache';
import { enforceRedisRateLimit } from '../../shared/security/redis-rate-limit';
import { normalizePhone } from '../../shared/utils/phone';
import { auditService } from '../audit/audit.service';
import { AuthErrors } from '../auth/auth.errors';
import { getOtpDeliveryProvider } from '../auth/otp-delivery';

export interface OtpChallengeRow {
  id: string;
  identityValue: string;
  status: OtpChallengeStatus;
  attemptCount: number;
  maxAttempts: number;
  expiresAt: Date;
  codeHash: string;
}

export interface RefreshSessionRow {
  id: string;
  principalId: string;
  familyId: string;
  revokedAt: Date | null;
  expiresAt: Date;
}

export interface SessionMeta {
  platform?: string;
  userAgent?: string;
  ipAddress?: string;
}

/**
 * Storage adapter: the only principal-specific part of mobile OTP login. Customer and driver
 * keep separate tables (separate identities, sessions and OTPs), but share one audited flow.
 */
export interface MobileAuthStore {
  principal: MobilePrincipal;
  /** `null` → this phone may not request a login code. `principalId: null` → account will be created on verify. */
  resolveForRequest(phone: string): Promise<{ principalId: string | null } | null>;
  createChallenge(data: {
    principalId: string | null;
    phone: string;
    codeHash: string;
    maxAttempts: number;
    expiresAt: Date;
    requestId?: string;
  }): Promise<{ id: string }>;
  findChallenge(id: string): Promise<OtpChallengeRow | null>;
  findLatestPending(phone: string): Promise<OtpChallengeRow | null>;
  updateChallenge(id: string, data: Partial<Pick<OtpChallengeRow, 'status' | 'attemptCount'>>): Promise<unknown>;
  /** PENDING → CONSUMED only; false when another request consumed it first. */
  consumeChallenge(id: string, tx: PrismaTx): Promise<boolean>;
  /** Runs inside the login transaction: finds or creates the principal and stamps the login. */
  completeLogin(phone: string, tx: PrismaTx): Promise<{ principalId: string; isNew: boolean }>;
  createSession(data: { principalId: string; tokenHash: string; familyId: string; expiresAt: Date } & SessionMeta, tx?: PrismaTx): Promise<{ id: string }>;
  findSessionByHash(tokenHash: string): Promise<RefreshSessionRow | null>;
  rotateSession(id: string, replacedById: string, tx: PrismaTx): Promise<unknown>;
  revokeSession(id: string, reason: string): Promise<unknown>;
  revokeFamily(familyId: string, reason: string): Promise<unknown>;
  revokeAll(principalId: string, reason: string): Promise<unknown>;
  /** Current authz version if the principal may hold a session, else null. */
  activeAuthzVersion(principalId: string): Promise<number | null>;
}

export interface MobileTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  /** Refresh token lifetime in seconds (the app stores it in secure storage) */
  refreshExpiresIn: number;
}

const keys = (p: MobilePrincipal) => ({
  cooldown: (phone: string) => `${p}:otp:cooldown:${phone}`,
  requestRate: (phone: string) => `${p}:otp:req:${phone}`,
  verifyRate: (phone: string) => `${p}:otp:verify:${phone}`,
});

/** Phone + OTP login with rotating refresh tokens (returned in the body: mobile apps only). */
export class MobileAuthEngine {
  constructor(private readonly store: MobileAuthStore) {}

  private get p(): MobilePrincipal {
    return this.store.principal;
  }

  async requestOtp(input: { phone: string; requestId?: string }) {
    const phone = normalizePhone(input.phone);
    const e = env();
    const k = keys(this.p);
    await enforceRedisRateLimit(k.requestRate(phone), otpPolicy().requestsPerPhone, e.OTP_REQUEST_RATE_LIMIT_WINDOW_SECONDS);

    const redis = getRedis();
    const cooldownKey = redisKey(k.cooldown(phone));
    const ttl = await redis.ttl(cooldownKey);
    if (ttl > 0) throw AuthErrors.cooldown(ttl);

    const resolved = await this.store.resolveForRequest(phone);
    if (!resolved) {
      await redis.set(cooldownKey, '1', 'EX', otpPolicy().cooldownSeconds);
      await auditService.record({
        action: `${this.p}.auth.otp.request_rejected`,
        resourceType: `${this.p}_identity`,
        requestId: input.requestId,
        metadata: { phone },
      });
      throw AppError.unauthorized(`No active ${this.p} account for this phone`);
    }

    const code = otpCodeFor(phone);
    const expiresAt = new Date(Date.now() + e.OTP_TTL_SECONDS * 1000);
    const challenge = await this.store.createChallenge({
      principalId: resolved.principalId,
      phone,
      codeHash: hmacOtp(code, e.OTP_HMAC_SECRET),
      maxAttempts: otpPolicy().maxAttempts,
      expiresAt,
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
    await redis.set(cooldownKey, '1', 'EX', otpPolicy().cooldownSeconds);
    await getOtpDeliveryProvider().sendOtp({ destination: phone, code, purpose: `${this.p.toUpperCase()}_LOGIN` });
    await auditService.record({
      action: `${this.p}.auth.otp.requested`,
      resourceType: `${this.p}_otp_challenge`,
      resourceId: challenge.id,
      requestId: input.requestId,
      metadata: { phone },
    });

    return {
      challengeId: challenge.id,
      expiresAt: expiresAt.toISOString(),
      cooldownSeconds: otpPolicy().cooldownSeconds,
      ...(e.NODE_ENV !== 'production' && e.OTP_DEV_EXPOSE === true ? { devOtp: code } : {}),
    };
  }

  async verifyOtp(input: { phone: string; code: string; challengeId?: string; requestId?: string } & SessionMeta) {
    const phone = normalizePhone(input.phone);
    const e = env();
    await enforceRedisRateLimit(keys(this.p).verifyRate(phone), otpPolicy().verifiesPerPhone, e.OTP_VERIFY_RATE_LIMIT_WINDOW_SECONDS);

    const challenge = input.challengeId
      ? await this.store.findChallenge(input.challengeId)
      : await this.store.findLatestPending(phone);
    if (!challenge || challenge.identityValue !== phone) throw AuthErrors.invalidOtp();
    if (challenge.status === OtpChallengeStatus.LOCKED) throw AuthErrors.lockedOtp();
    if (challenge.status === OtpChallengeStatus.CONSUMED) throw AuthErrors.invalidOtp();
    if (challenge.status === OtpChallengeStatus.EXPIRED || challenge.expiresAt.getTime() < Date.now()) {
      await this.store.updateChallenge(challenge.id, { status: OtpChallengeStatus.EXPIRED });
      throw AuthErrors.expiredOtp();
    }

    if (!timingSafeEqualString(hmacOtp(input.code, e.OTP_HMAC_SECRET), challenge.codeHash)) {
      const attemptCount = challenge.attemptCount + 1;
      const locked = attemptCount >= challenge.maxAttempts;
      await this.store.updateChallenge(challenge.id, {
        attemptCount,
        status: locked ? OtpChallengeStatus.LOCKED : OtpChallengeStatus.PENDING,
      });
      await auditService.record({
        action: `${this.p}.auth.otp.verify_failed`,
        resourceType: `${this.p}_otp_challenge`,
        resourceId: challenge.id,
        requestId: input.requestId,
        metadata: { reason: locked ? 'locked' : 'invalid_code' },
      });
      if (locked) throw AuthErrors.lockedOtp();
      throw AuthErrors.invalidOtp();
    }

    // The account may have been suspended between request and verify (customer: created here).
    const resolved = await this.store.resolveForRequest(phone);
    if (!resolved) throw AppError.unauthorized(`No active ${this.p} account for this phone`);

    const refreshToken = randomToken(48);
    const refreshExpiresAt = new Date(Date.now() + e.REFRESH_TOKEN_TTL_SECONDS * 1000);
    const { principalId, isNew, sessionId } = await getPrisma().$transaction(async (tx) => {
      // Conditional consume: two concurrent verifies of one code cannot both log in.
      if (!(await this.store.consumeChallenge(challenge.id, tx))) throw AuthErrors.invalidOtp();
      const login = await this.store.completeLogin(phone, tx);
      const session = await this.store.createSession(
        {
          principalId: login.principalId,
          tokenHash: sha256Hex(refreshToken),
          familyId: randomUUID(),
          expiresAt: refreshExpiresAt,
          ...pickMeta(input),
        },
        tx,
      );
      return { ...login, sessionId: session.id };
    });

    const tokens = await this.issue(principalId, sessionId, refreshToken);
    await auditService.record({
      action: `${this.p}.auth.login.success`,
      resourceType: `${this.p}_refresh_session`,
      resourceId: sessionId,
      requestId: input.requestId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      metadata: { principalId, isNew, platform: input.platform },
    });
    return { principalId, isNew, tokens };
  }

  async refresh(input: { refreshToken?: string; requestId?: string } & SessionMeta) {
    if (!input.refreshToken) throw AuthErrors.sessionInvalid();
    const existing = await this.store.findSessionByHash(sha256Hex(input.refreshToken));
    if (!existing) throw AuthErrors.sessionInvalid();
    if (existing.revokedAt) {
      await this.store.revokeFamily(existing.familyId, 'refresh_reuse_detected');
      await auditService.record({
        action: `${this.p}.auth.refresh.reuse_detected`,
        resourceType: `${this.p}_refresh_session`,
        resourceId: existing.id,
        requestId: input.requestId,
        metadata: { principalId: existing.principalId },
      });
      throw AuthErrors.sessionInvalid();
    }
    if (existing.expiresAt.getTime() < Date.now()) {
      await this.store.revokeSession(existing.id, 'expired');
      throw AuthErrors.sessionInvalid();
    }
    if ((await this.store.activeAuthzVersion(existing.principalId)) === null) {
      await this.store.revokeAll(existing.principalId, 'account_inactive');
      throw AppError.unauthorized(`${this.p} account is not active`);
    }

    const refreshToken = randomToken(48);
    const sessionId = await getPrisma().$transaction(async (tx) => {
      const created = await this.store.createSession(
        {
          principalId: existing.principalId,
          tokenHash: sha256Hex(refreshToken),
          familyId: existing.familyId,
          expiresAt: new Date(Date.now() + env().REFRESH_TOKEN_TTL_SECONDS * 1000),
          ...pickMeta(input),
        },
        tx,
      );
      await this.store.rotateSession(existing.id, created.id, tx);
      return created.id;
    });
    return { principalId: existing.principalId, tokens: await this.issue(existing.principalId, sessionId, refreshToken) };
  }

  async logout(input: { refreshToken?: string; requestId?: string }): Promise<void> {
    if (!input.refreshToken) return;
    const session = await this.store.findSessionByHash(sha256Hex(input.refreshToken));
    if (!session || session.revokedAt) return;
    await this.store.revokeSession(session.id, 'logout');
    await auditService.record({
      action: `${this.p}.auth.logout`,
      resourceType: `${this.p}_refresh_session`,
      resourceId: session.id,
      requestId: input.requestId,
      metadata: { principalId: session.principalId },
    });
  }

  private async issue(principalId: string, sessionId: string, refreshToken: string): Promise<MobileTokens> {
    const authzVersion = await this.store.activeAuthzVersion(principalId);
    if (authzVersion === null) throw AppError.unauthorized(`${this.p} account is not active`);
    await setPrincipalAuthzVersion(this.p, principalId, authzVersion);
    const e = env();
    return {
      accessToken: signMobileAccessToken(this.p, { id: principalId, sessionId, authzVersion }),
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: e.JWT_ACCESS_TTL_SECONDS,
      refreshExpiresIn: e.REFRESH_TOKEN_TTL_SECONDS,
    };
  }
}

function pickMeta(meta: SessionMeta): SessionMeta {
  return {
    ...(meta.platform ? { platform: meta.platform } : {}),
    ...(meta.userAgent ? { userAgent: meta.userAgent.slice(0, 512) } : {}),
    ...(meta.ipAddress ? { ipAddress: meta.ipAddress.slice(0, 64) } : {}),
  };
}
