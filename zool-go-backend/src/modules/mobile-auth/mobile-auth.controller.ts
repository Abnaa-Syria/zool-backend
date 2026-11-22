import type { CookieOptions, Request, Response } from 'express';
import { env } from '../../config/env';
import { clientPlatform, isMobileClient } from '../../shared/http/client-platform';
import { successResponse } from '../../shared/http/success-response';
import type { MobileAuthEngine } from './mobile-auth.engine';

export interface MobileAuthProfile {
  /** Response key of the profile in verify/refresh, e.g. `customer` or `driver` */
  key: string;
  load(principalId: string): Promise<unknown>;
}

/** Web principals (carrier portal) keep the refresh token in an HttpOnly cookie. */
export interface WebCookie {
  name: string;
  path: string;
}

function meta(req: Request) {
  const platform = clientPlatform(req);
  return {
    requestId: req.requestId,
    ...(platform !== 'web' ? { platform } : {}),
    ...(req.ip ? { ipAddress: req.ip } : {}),
    ...(req.get('user-agent') ? { userAgent: req.get('user-agent')! } : {}),
  };
}

function cookieOptions(cookie: WebCookie): CookieOptions {
  const e = env();
  return {
    httpOnly: true,
    secure: e.REFRESH_COOKIE_SECURE,
    sameSite: e.REFRESH_COOKIE_SAMESITE,
    path: cookie.path,
    maxAge: e.REFRESH_TOKEN_TTL_SECONDS * 1000,
    ...(e.REFRESH_COOKIE_DOMAIN ? { domain: e.REFRESH_COOKIE_DOMAIN } : {}),
  };
}

/**
 * HTTP adapter shared by the phone-OTP principals. Mobile clients (`X-Client-Platform`) get the
 * refresh token in the body; when a web cookie is configured, browsers get it as an HttpOnly
 * cookie instead (never in the body).
 */
export class MobileAuthController {
  constructor(
    private readonly engine: MobileAuthEngine,
    private readonly profile: MobileAuthProfile,
    private readonly newFlagKey?: string,
    private readonly webCookie?: WebCookie,
  ) {}

  private useCookie(req: Request): boolean {
    return this.webCookie !== undefined && !isMobileClient(req);
  }

  private readRefresh(req: Request): string | undefined {
    const body = (req.body as { refreshToken?: string } | undefined)?.refreshToken;
    if (body) return body;
    if (!this.webCookie) return undefined;
    const raw = req.cookies?.[this.webCookie.name];
    return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
  }

  private deliver<T extends { refreshToken: string }>(req: Request, res: Response, tokens: T) {
    if (!this.useCookie(req)) return tokens;
    res.cookie(this.webCookie!.name, tokens.refreshToken, cookieOptions(this.webCookie!));
    const { refreshToken: _hidden, ...rest } = tokens;
    return rest;
  }

  async requestOtp(req: Request, res: Response): Promise<Response> {
    const data = await this.engine.requestOtp({ phone: req.body.phone as string, requestId: req.requestId });
    return successResponse(res, { message: 'OTP requested successfully', data, requestId: req.requestId });
  }

  async verifyOtp(req: Request, res: Response): Promise<Response> {
    const result = await this.engine.verifyOtp({
      phone: req.body.phone as string,
      code: req.body.code as string,
      challengeId: req.body.challengeId as string | undefined,
      ...meta(req),
    });
    const data = {
      ...this.deliver(req, res, result.tokens),
      ...(this.newFlagKey ? { [this.newFlagKey]: result.isNew } : {}),
      [this.profile.key]: await this.profile.load(result.principalId),
    };
    return successResponse(res, { message: 'OTP verified successfully', data, requestId: req.requestId });
  }

  async refresh(req: Request, res: Response): Promise<Response> {
    const result = await this.engine.refresh({ refreshToken: this.readRefresh(req), ...meta(req) });
    const data = { ...this.deliver(req, res, result.tokens), [this.profile.key]: await this.profile.load(result.principalId) };
    return successResponse(res, { message: 'Session refreshed successfully', data, requestId: req.requestId });
  }

  async logout(req: Request, res: Response): Promise<Response> {
    await this.engine.logout({ refreshToken: this.readRefresh(req), requestId: req.requestId });
    if (this.useCookie(req)) {
      const { maxAge: _m, ...opts } = cookieOptions(this.webCookie!);
      res.clearCookie(this.webCookie!.name, opts);
    }
    return successResponse(res, { message: 'Logged out successfully', data: { loggedOut: true }, requestId: req.requestId });
  }
}
