import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { AppError } from '../errors/app-error';
import { ErrorCodes } from '../errors/error-codes';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  av: number;
  typ: 'access';
}

export function signAccessToken(input: {
  adminId: string;
  sessionId: string;
  authzVersion: number;
}): string {
  const payload: AccessTokenPayload = {
    sub: input.adminId,
    sid: input.sessionId,
    av: input.authzVersion,
    typ: 'access',
  };

  return jwt.sign(payload, env().JWT_ACCESS_SECRET, {
    expiresIn: env().JWT_ACCESS_TTL_SECONDS,
    issuer: env().APP_NAME,
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, env().JWT_ACCESS_SECRET, {
      issuer: env().APP_NAME,
    }) as jwt.JwtPayload & Partial<AccessTokenPayload>;

    if (
      decoded.typ !== 'access' ||
      typeof decoded.sub !== 'string' ||
      typeof decoded.sid !== 'string' ||
      typeof decoded.av !== 'number'
    ) {
      throw AppError.unauthorized('Invalid access token', {
        code: ErrorCodes.AUTH_TOKEN_INVALID,
      });
    }

    return {
      sub: decoded.sub,
      sid: decoded.sid,
      av: decoded.av,
      typ: 'access',
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
