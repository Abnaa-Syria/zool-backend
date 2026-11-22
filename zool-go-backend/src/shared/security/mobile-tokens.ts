import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { AppError } from '../errors/app-error';
import { ErrorCodes } from '../errors/error-codes';
import type { MobilePrincipal } from './principal-authz-cache';

/**
 * Access tokens of the mobile-only principals (customer, driver). `typ` keeps them disjoint from
 * admin and broker tokens: a customer token never authenticates a driver route and vice versa.
 */
export interface MobileAccessTokenPayload {
  sub: string;
  sid: string;
  av: number;
  typ: `${MobilePrincipal}_access`;
}

export function signMobileAccessToken(
  principal: MobilePrincipal,
  input: { id: string; sessionId: string; authzVersion: number },
): string {
  const payload: MobileAccessTokenPayload = {
    sub: input.id,
    sid: input.sessionId,
    av: input.authzVersion,
    typ: `${principal}_access`,
  };
  return jwt.sign(payload, env().JWT_ACCESS_SECRET, {
    expiresIn: env().JWT_ACCESS_TTL_SECONDS,
    issuer: env().APP_NAME,
  } as jwt.SignOptions);
}

export function verifyMobileAccessToken(principal: MobilePrincipal, token: string): MobileAccessTokenPayload {
  try {
    const decoded = jwt.verify(token, env().JWT_ACCESS_SECRET, {
      issuer: env().APP_NAME,
    }) as jwt.JwtPayload & Partial<MobileAccessTokenPayload>;
    if (
      decoded.typ !== `${principal}_access` ||
      typeof decoded.sub !== 'string' ||
      typeof decoded.sid !== 'string' ||
      typeof decoded.av !== 'number'
    ) {
      throw AppError.unauthorized('Invalid access token', { code: ErrorCodes.AUTH_TOKEN_INVALID });
    }
    return { sub: decoded.sub, sid: decoded.sid, av: decoded.av, typ: decoded.typ };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof jwt.TokenExpiredError) {
      throw AppError.unauthorized('Access token expired', { code: ErrorCodes.AUTH_TOKEN_EXPIRED });
    }
    throw AppError.unauthorized('Invalid or expired access token', { code: ErrorCodes.AUTH_TOKEN_INVALID });
  }
}
