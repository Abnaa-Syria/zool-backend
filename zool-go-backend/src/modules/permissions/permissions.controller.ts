import type { Request, Response } from 'express';
import { successResponse } from '../../shared/http/success-response';
import { permissionsService } from './permissions.service';

export class PermissionsController {
  async list(req: Request, res: Response): Promise<Response> {
    const items = await permissionsService.listFromDb();
    return successResponse(res, {
      statusCode: 200,
      message: 'Permissions retrieved successfully',
      data: items,
      requestId: req.requestId,
    });
  }
}

export const permissionsController = new PermissionsController();
