import type { Request, Response } from 'express';
import { isMobileClient } from '../../shared/http/client-platform';
import { successResponse } from '../../shared/http/success-response';
import {
  clearBrokerRefreshCookie,
  readBrokerRefreshToken,
  setBrokerRefreshCookie,
} from './broker-auth.cookies';
import { brokerAuthService } from './broker-auth.service';

/**
 * Web panel: refresh token in an HttpOnly cookie. Broker mobile app (`X-Client-Platform:
 * ios|android`): refresh token in the response body and sent back in the request body.
 */
function readRefresh(req: Request): string | undefined {
  if (isMobileClient(req)) {
    const raw = (req.body as { refreshToken?: unknown } | undefined)?.refreshToken;
    return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
  }
  return readBrokerRefreshToken(req);
}

function deliver<T extends object>(req: Request, res: Response, tokens: T, refreshToken: string) {
  if (isMobileClient(req)) return { ...tokens, refreshToken };
  setBrokerRefreshCookie(res, refreshToken);
  return tokens;
}

export class BrokerAuthController {
  async requestOtp(req: Request, res: Response): Promise<Response> {
    const result = await brokerAuthService.requestOtp({
      phone: req.body.phone as string,
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: 200,
      message: 'OTP requested successfully',
      data: result,
      requestId: req.requestId,
    });
  }

  async verifyOtp(req: Request, res: Response): Promise<Response> {
    const { tokens, refreshToken } = await brokerAuthService.verifyOtp({
      phone: req.body.phone as string,
      code: req.body.code as string,
      challengeId: req.body.challengeId as string | undefined,
      requestId: req.requestId,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });
    return successResponse(res, {
      statusCode: 200,
      message: 'OTP verified successfully',
      data: deliver(req, res, tokens, refreshToken),
      requestId: req.requestId,
    });
  }

  async refresh(req: Request, res: Response): Promise<Response> {
    const { tokens, refreshToken } = await brokerAuthService.refresh({
      refreshToken: readRefresh(req),
      requestId: req.requestId,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });
    return successResponse(res, {
      statusCode: 200,
      message: 'Session refreshed successfully',
      data: deliver(req, res, tokens, refreshToken),
      requestId: req.requestId,
    });
  }

  async logout(req: Request, res: Response): Promise<Response> {
    await brokerAuthService.logout({
      refreshToken: readRefresh(req),
      requestId: req.requestId,
    });
    if (!isMobileClient(req)) clearBrokerRefreshCookie(res);
    return successResponse(res, {
      statusCode: 200,
      message: 'Logged out successfully',
      data: { loggedOut: true },
      requestId: req.requestId,
    });
  }

  async me(req: Request, res: Response): Promise<Response> {
    const me = await brokerAuthService.me(req.brokerAuth!.employeeId);
    return successResponse(res, {
      statusCode: 200,
      message: 'Current broker employee retrieved successfully',
      data: me,
      requestId: req.requestId,
    });
  }
}

export const brokerAuthController = new BrokerAuthController();
