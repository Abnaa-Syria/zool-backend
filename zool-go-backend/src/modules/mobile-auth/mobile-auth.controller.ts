import type { Request, Response } from 'express';
import { clientPlatform } from '../../shared/http/client-platform';
import { successResponse } from '../../shared/http/success-response';
import type { MobileAuthEngine } from './mobile-auth.engine';

export interface MobileAuthProfile {
  /** Response key of the profile in verify/refresh, e.g. `customer` or `driver` */
  key: string;
  load(principalId: string): Promise<unknown>;
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

/** HTTP adapter shared by the customer and driver auth routes (body refresh tokens). */
export class MobileAuthController {
  constructor(
    private readonly engine: MobileAuthEngine,
    private readonly profile: MobileAuthProfile,
    private readonly newFlagKey?: string,
  ) {}

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
      ...result.tokens,
      ...(this.newFlagKey ? { [this.newFlagKey]: result.isNew } : {}),
      [this.profile.key]: await this.profile.load(result.principalId),
    };
    return successResponse(res, { message: 'OTP verified successfully', data, requestId: req.requestId });
  }

  async refresh(req: Request, res: Response): Promise<Response> {
    const result = await this.engine.refresh({ refreshToken: req.body.refreshToken as string, ...meta(req) });
    const data = { ...result.tokens, [this.profile.key]: await this.profile.load(result.principalId) };
    return successResponse(res, { message: 'Session refreshed successfully', data, requestId: req.requestId });
  }

  async logout(req: Request, res: Response): Promise<Response> {
    await this.engine.logout({ refreshToken: req.body?.refreshToken as string | undefined, requestId: req.requestId });
    return successResponse(res, { message: 'Logged out successfully', data: { loggedOut: true }, requestId: req.requestId });
  }
}
