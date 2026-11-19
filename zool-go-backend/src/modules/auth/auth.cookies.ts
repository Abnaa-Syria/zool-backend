import type { CookieOptions, Request, Response } from 'express';
import { env } from '../../config/env';

function refreshCookieOptions(): CookieOptions {
  const e = env();
  const options: CookieOptions = {
    httpOnly: true,
    secure: e.REFRESH_COOKIE_SECURE,
    sameSite: e.REFRESH_COOKIE_SAMESITE,
    path: e.REFRESH_COOKIE_PATH,
    maxAge: e.REFRESH_TOKEN_TTL_SECONDS * 1000,
  };
  if (e.REFRESH_COOKIE_DOMAIN) {
    options.domain = e.REFRESH_COOKIE_DOMAIN;
  }
  return options;
}

/** HTTP cookie adapter — kept out of the domain service to avoid Express in services. */
export function setRefreshCookie(res: Response, refreshToken: string): void {
  res.cookie(env().REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
}

export function clearRefreshCookie(res: Response): void {
  const options = refreshCookieOptions();
  res.clearCookie(env().REFRESH_COOKIE_NAME, {
    httpOnly: options.httpOnly,
    secure: options.secure,
    sameSite: options.sameSite,
    path: options.path,
    ...(options.domain ? { domain: options.domain } : {}),
  });
}

export function readRefreshToken(req: Request): string | undefined {
  const raw = req.cookies?.[env().REFRESH_COOKIE_NAME];
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}
