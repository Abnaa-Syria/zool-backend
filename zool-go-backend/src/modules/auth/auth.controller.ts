import type { Request, Response } from 'express';
import { successResponse } from '../../shared/http/success-response';
import {
  clearRefreshCookie,
  readRefreshToken,
  setRefreshCookie,
} from './auth.cookies';
import { authService } from './auth.service';

export class AuthController {
  async requestOtp(req: Request, res: Response): Promise<Response> {
    const result = await authService.requestOtp({
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
    const { tokens, refreshToken } = await authService.verifyOtp({
      phone: req.body.phone as string,
      code: req.body.code as string,
      challengeId: req.body.challengeId as string | undefined,
      requestId: req.requestId,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });
    setRefreshCookie(res, refreshToken);
    return successResponse(res, {
      statusCode: 200,
      message: 'OTP verified successfully',
      data: tokens,
      requestId: req.requestId,
    });
  }

  async refresh(req: Request, res: Response): Promise<Response> {
    const { tokens, refreshToken } = await authService.refresh({
      refreshToken: readRefreshToken(req),
      requestId: req.requestId,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });
    setRefreshCookie(res, refreshToken);
    return successResponse(res, {
      statusCode: 200,
      message: 'Session refreshed successfully',
      data: tokens,
      requestId: req.requestId,
    });
  }

  async logout(req: Request, res: Response): Promise<Response> {
    await authService.logout({
      refreshToken: readRefreshToken(req),
      adminId: req.auth?.adminId,
      requestId: req.requestId,
    });
    clearRefreshCookie(res);
    return successResponse(res, {
      statusCode: 200,
      message: 'Logged out successfully',
      data: { loggedOut: true },
      requestId: req.requestId,
    });
  }

  async logoutAll(req: Request, res: Response): Promise<Response> {
    await authService.logoutAll(req.auth!.adminId, req.requestId);
    clearRefreshCookie(res);
    return successResponse(res, {
      statusCode: 200,
      message: 'Logged out from all sessions successfully',
      data: { loggedOutAll: true },
      requestId: req.requestId,
    });
  }

  async me(req: Request, res: Response): Promise<Response> {
    const me = await authService.me(req.auth!.adminId);
    return successResponse(res, {
      statusCode: 200,
      message: 'Current admin retrieved successfully',
      data: me,
      requestId: req.requestId,
    });
  }

  async requestPhoneChangeOtp(req: Request, res: Response): Promise<Response> {
    const result = await authService.requestPhoneChangeOtp({
      adminId: req.auth!.adminId,
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

  async verifyPhoneChangeOtp(req: Request, res: Response): Promise<Response> {
    const me = await authService.verifyPhoneChangeOtp({
      adminId: req.auth!.adminId,
      phone: req.body.phone as string,
      code: req.body.code as string,
      challengeId: req.body.challengeId as string | undefined,
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: 200,
      message: 'Phone number updated successfully',
      data: me,
      requestId: req.requestId,
    });
  }
}

export const authController = new AuthController();
