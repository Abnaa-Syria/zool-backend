import { getRedis, redisKey } from '../../infrastructure/redis/redis';
import { AppError } from '../errors/app-error';
import { ErrorCodes } from '../errors/error-codes';

function versionKey(employeeId: string): string {
  return redisKey(`broker:authz:version:${employeeId}`);
}

export async function setBrokerAuthzVersion(employeeId: string, version: number): Promise<void> {
  try {
    await getRedis().set(versionKey(employeeId), String(version));
  } catch {
    throw AppError.internal('Failed to set broker authz version');
  }
}

export async function getBrokerAuthzVersion(employeeId: string): Promise<number | null> {
  try {
    const value = await getRedis().get(versionKey(employeeId));
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
export async function requireMatchingBrokerAuthzVersion(
  employeeId: string,
  tokenVersion: number,
): Promise<void> {
  const current = await getBrokerAuthzVersion(employeeId);
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
