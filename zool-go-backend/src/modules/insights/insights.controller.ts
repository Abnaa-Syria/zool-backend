import type { Request, Response } from 'express';
import { successResponse } from '../../shared/http/success-response';
import { insightsService } from './insights.service';

type RangeQuery = { from?: string; to?: string; officeId?: string; companyId?: string };

export class InsightsController {
  async overview(req: Request, res: Response): Promise<Response> {
    const data = await insightsService.overview(req.query as RangeQuery, req.auth!.permissions ?? []);
    return successResponse(res, { message: 'Overview retrieved', data, requestId: req.requestId });
  }

  async summary(req: Request, res: Response): Promise<Response> {
    const data = await insightsService.summary(req.query as RangeQuery);
    return successResponse(res, { message: 'Report summary retrieved', data, requestId: req.requestId });
  }

  async byOffice(req: Request, res: Response): Promise<Response> {
    const data = await insightsService.byOffice(req.query as RangeQuery);
    return successResponse(res, { message: 'Report by office retrieved', data, requestId: req.requestId });
  }

  async byCarrier(req: Request, res: Response): Promise<Response> {
    const data = await insightsService.byCarrier(req.query as RangeQuery);
    return successResponse(res, { message: 'Report by carrier retrieved', data, requestId: req.requestId });
  }
}

export const insightsController = new InsightsController();
