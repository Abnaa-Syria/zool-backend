import type { Request, Response } from 'express';
import { successResponse } from '../../shared/http/success-response';
import { auditService } from './audit.service';

export class AuditController {
  async list(req: Request, res: Response): Promise<Response> {
    const result = await auditService.list(
      req.query as {
        page?: number;
        pageSize?: number;
        actorAdminId?: string;
        action?: string;
        resourceType?: string;
        resourceId?: string;
        requestId?: string;
        from?: string;
        to?: string;
      },
    );
    return successResponse(res, {
      statusCode: 200,
      message: 'Audit logs retrieved successfully',
      data: result.items,
      meta: result.meta,
      requestId: req.requestId,
    });
  }
}

export const auditController = new AuditController();
