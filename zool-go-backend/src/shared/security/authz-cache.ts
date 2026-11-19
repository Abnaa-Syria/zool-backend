import { getRedis, redisKey } from '../../infrastructure/redis/redis';
import { AppError } from '../errors/app-error';
import { ErrorCodes } from '../errors/error-codes';

function versionKey(adminId: string): string {
  return redisKey(`authz:version:${adminId}`);
}

function permissionsKey(adminId: string): string {
  return redisKey(`authz:permissions:${adminId}`);
}

export async function setAuthzVersion(adminId: string, version: number): Promise<void> {
  try {
    await getRedis().set(versionKey(adminId), String(version));
  } catch {
    throw AppError.internal('Failed to set authz version');
  }
}

export async function getAuthzVersion(adminId: string): Promise<number | null> {
  try {
    const value = await getRedis().get(versionKey(adminId));
    if (value === null) return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    throw AppError.unauthorized('Authorization service unavailable', {
      code: ErrorCodes.AUTH_AUTHZ_STALE,
    });
  }
}

/** Fail-closed: Redis must be available and version must match. */
export async function requireMatchingAuthzVersion(
  adminId: string,
  tokenVersion: number,
): Promise<void> {
  const current = await getAuthzVersion(adminId);
  if (current === null) {
    throw AppError.unauthorized('Authorization version missing; please sign in again', {
      code: ErrorCodes.AUTH_AUTHZ_STALE,
    });
  }
  if (current !== tokenVersion) {
    throw AppError.unauthorized('Authorization changed; please refresh session', {
      code: ErrorCodes.AUTH_AUTHZ_STALE,
    });
  }
}

export async function cachePermissions(
  adminId: string,
  permissions: string[],
  ttlSeconds = 60,
): Promise<void> {
  try {
    await getRedis().set(permissionsKey(adminId), JSON.stringify(permissions), 'EX', ttlSeconds);
  } catch {
    // Cache write failure is non-fatal for request path after authz version matched
  }
}

export async function getCachedPermissions(adminId: string): Promise<string[] | null> {
  try {
    const raw = await getRedis().get(permissionsKey(adminId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((p) => typeof p === 'string')) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function invalidatePermissionCache(adminId: string): Promise<void> {
  try {
    await getRedis().del(permissionsKey(adminId));
  } catch {
    // ignore
  }
}
