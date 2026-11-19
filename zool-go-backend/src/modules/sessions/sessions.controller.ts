import type { Request, Response } from 'express';
import { successResponse } from '../../shared/http/success-response';
import { sessionsService } from './sessions.service';

export class SessionsController {
  async list(req: Request, res: Response): Promise<Response> {
    const result = await sessionsService.list({
      ...(req.query as { page?: number; pageSize?: number; adminId?: string }),
    });
    return successResponse(res, {
      statusCode: 200,
      message: 'Sessions retrieved successfully',
      data: result.items,
      meta: result.meta,
      requestId: req.requestId,
    });
  }

  async revoke(req: Request, res: Response): Promise<Response> {
    const result = await sessionsService.revoke({
      sessionId: req.params.sessionId!,
      actorAdminId: req.auth!.adminId,
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: 200,
      message: 'Session revoked successfully',
      data: result,
      requestId: req.requestId,
    });
  }
}

export const sessionsController = new SessionsController();
