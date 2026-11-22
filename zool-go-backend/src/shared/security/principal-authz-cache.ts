import { getRedis, redisKey } from '../../infrastructure/redis/redis';
import { AppError } from '../errors/app-error';
import { ErrorCodes } from '../errors/error-codes';

/**
 * authzVersion cache for the mobile principals (driver, customer). Same fail-closed contract as
 * the admin/broker caches: a token is valid only while its `av` claim equals the cached version.
 */
export type MobilePrincipal = 'driver' | 'customer' | 'carrier';

function versionKey(principal: MobilePrincipal, id: string): string {
  return redisKey(`${principal}:authz:version:${id}`);
}

export async function setPrincipalAuthzVersion(principal: MobilePrincipal, id: string, version: number): Promise<void> {
  try {
    await getRedis().set(versionKey(principal, id), String(version));
  } catch {
    throw AppError.internal(`Failed to set ${principal} authz version`);
  }
}

export async function getPrincipalAuthzVersion(principal: MobilePrincipal, id: string): Promise<number | null> {
  try {
    const value = await getRedis().get(versionKey(principal, id));
    if (value === null) return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    throw AppError.unauthorized('Authorization service unavailable', { code: ErrorCodes.AUTH_AUTHZ_STALE });
  }
}

export async function requireMatchingPrincipalAuthzVersion(
  principal: MobilePrincipal,
  id: string,
  tokenVersion: number,
): Promise<void> {
  const current = await getPrincipalAuthzVersion(principal, id);
  if (current === null || current !== tokenVersion) {
    throw AppError.unauthorized('Authorization changed; please sign in again', { code: ErrorCodes.AUTH_AUTHZ_STALE });
  }
}
