import type { Request, Response } from 'express';
import { successResponse } from '../../shared/http/success-response';
import { settingsService } from './settings.service';

export class SettingsController {
  async list(req: Request, res: Response): Promise<Response> {
    return successResponse(res, { message: 'Settings retrieved', data: await settingsService.list(), requestId: req.requestId });
  }

  async reset(req: Request, res: Response): Promise<Response> {
    const data = await settingsService.reset({ key: req.params.key!, actorAdminId: req.auth!.adminId, requestId: req.requestId });
    return successResponse(res, { message: 'Setting reset to default', data, requestId: req.requestId });
  }

  async update(req: Request, res: Response): Promise<Response> {
    const data = await settingsService.update({
      values: req.body.values as Record<string, unknown>,
      actorAdminId: req.auth!.adminId,
      requestId: req.requestId,
    });
    return successResponse(res, { message: 'Settings updated', data, requestId: req.requestId });
  }
}

export const settingsController = new SettingsController();
