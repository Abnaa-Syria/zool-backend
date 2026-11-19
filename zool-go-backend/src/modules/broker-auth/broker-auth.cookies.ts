import type { CookieOptions, Request, Response } from 'express';
import { env } from '../../config/env';

function brokerRefreshCookieOptions(): CookieOptions {
  const e = env();
  const options: CookieOptions = {
    httpOnly: true,
    secure: e.REFRESH_COOKIE_SECURE,
    sameSite: e.REFRESH_COOKIE_SAMESITE,
    path: e.BROKER_REFRESH_COOKIE_PATH,
    maxAge: e.REFRESH_TOKEN_TTL_SECONDS * 1000,
  };
  if (e.REFRESH_COOKIE_DOMAIN) {
    options.domain = e.REFRESH_COOKIE_DOMAIN;
  }
  return options;
}

/** HTTP cookie adapter for the broker principal (separate from the admin cookie). */
export function setBrokerRefreshCookie(res: Response, refreshToken: string): void {
  res.cookie(env().BROKER_REFRESH_COOKIE_NAME, refreshToken, brokerRefreshCookieOptions());
}

export function clearBrokerRefreshCookie(res: Response): void {
  const options = brokerRefreshCookieOptions();
  res.clearCookie(env().BROKER_REFRESH_COOKIE_NAME, {
    httpOnly: options.httpOnly,
    secure: options.secure,
    sameSite: options.sameSite,
    path: options.path,
    ...(options.domain ? { domain: options.domain } : {}),
  });
}

export function readBrokerRefreshToken(req: Request): string | undefined {
  const raw = req.cookies?.[env().BROKER_REFRESH_COOKIE_NAME];
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}
