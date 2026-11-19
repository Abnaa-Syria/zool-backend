import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { AppError } from '../errors/app-error';
import { ErrorCodes } from '../errors/error-codes';

export interface BrokerAccessTokenPayload {
  /** employeeId */
  sub: string;
  /** officeId */
  oid: string;
  /** refresh session id */
  sid: string;
  /** authz version */
  av: number;
  typ: 'broker_access';
}

export function signBrokerAccessToken(input: {
  employeeId: string;
  officeId: string;
  sessionId: string;
  authzVersion: number;
}): string {
  const payload: BrokerAccessTokenPayload = {
    sub: input.employeeId,
    oid: input.officeId,
    sid: input.sessionId,
    av: input.authzVersion,
    typ: 'broker_access',
  };

  return jwt.sign(payload, env().JWT_ACCESS_SECRET, {
    expiresIn: env().JWT_ACCESS_TTL_SECONDS,
    issuer: env().APP_NAME,
  } as jwt.SignOptions);
}

export function verifyBrokerAccessToken(token: string): BrokerAccessTokenPayload {
  try {
    const decoded = jwt.verify(token, env().JWT_ACCESS_SECRET, {
      issuer: env().APP_NAME,
    }) as jwt.JwtPayload & Partial<BrokerAccessTokenPayload>;

    if (
      decoded.typ !== 'broker_access' ||
      typeof decoded.sub !== 'string' ||
      typeof decoded.oid !== 'string' ||
      typeof decoded.sid !== 'string' ||
      typeof decoded.av !== 'number'
    ) {
      throw AppError.unauthorized('Invalid access token', {
        code: ErrorCodes.AUTH_TOKEN_INVALID,
      });
    }

    return {
      sub: decoded.sub,
      oid: decoded.oid,
      sid: decoded.sid,
      av: decoded.av,
      typ: 'broker_access',
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof jwt.TokenExpiredError) {
      throw AppError.unauthorized('Access token expired', {
        code: ErrorCodes.AUTH_TOKEN_EXPIRED,
      });
    }
    throw AppError.unauthorized('Invalid or expired access token', {
      code: ErrorCodes.AUTH_TOKEN_INVALID,
    });
  }
}
