import type { CommissionAccrualStatus, CommissionSettlementStatus } from '@prisma/client';
import type { Request, Response } from 'express';
import { successResponse } from '../../shared/http/success-response';
import { commissionsService } from './commissions.service';

export class CommissionsController {
  async listBroker(req: Request, res: Response): Promise<Response> {
    const result = await commissionsService.listUnsettledForOffice(
      req.brokerAuth!.officeId,
      req.query as { page?: number; pageSize?: number; status?: CommissionAccrualStatus },
    );
    return successResponse(res, {
      statusCode: 200,
      message: 'Commissions retrieved successfully',
      data: result.data,
      meta: result.meta,
      requestId: req.requestId,
    });
  }

  async listAdmin(req: Request, res: Response): Promise<Response> {
    const result = await commissionsService.listAdmin(
      req.query as {
        page?: number;
        pageSize?: number;
        officeId?: string;
        status?: CommissionAccrualStatus;
      },
    );
    return successResponse(res, {
      statusCode: 200,
      message: 'Commission accruals retrieved successfully',
      data: result.items,
      meta: result.meta,
      requestId: req.requestId,
    });
  }

  async listSettlements(req: Request, res: Response): Promise<Response> {
    const result = await commissionsService.listSettlements(
      req.query as {
        page?: number;
        pageSize?: number;
        officeId?: string;
        status?: CommissionSettlementStatus;
      },
    );
    return successResponse(res, {
      statusCode: 200,
      message: 'Commission settlements retrieved successfully',
      data: result.items,
      meta: result.meta,
      requestId: req.requestId,
    });
  }

  async getSettlement(req: Request, res: Response): Promise<Response> {
    const settlement = await commissionsService.getSettlement(req.params.id!);
    return successResponse(res, {
      statusCode: 200,
      message: 'Commission settlement retrieved successfully',
      data: settlement,
      requestId: req.requestId,
    });
  }

  async listSettlementAccruals(req: Request, res: Response): Promise<Response> {
    const result = await commissionsService.listSettlementAccruals(
      req.params.id!,
      req.query as { page?: number; pageSize?: number },
    );
    return successResponse(res, {
      statusCode: 200,
      message: 'Settlement accruals retrieved successfully',
      data: result.items,
      meta: result.meta,
      requestId: req.requestId,
    });
  }

  async createDraft(req: Request, res: Response): Promise<Response> {
    const settlement = await commissionsService.createDraft({
      officeId: req.body.officeId as string,
      periodFrom: req.body.periodFrom as Date,
      periodTo: req.body.periodTo as Date,
      note: req.body.note as string | undefined,
      actorAdminId: req.auth!.adminId,
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: 201,
      message: 'Commission settlement drafted successfully',
      data: settlement,
      requestId: req.requestId,
    });
  }

  async finalize(req: Request, res: Response): Promise<Response> {
    const result = await commissionsService.finalize({
      settlementId: req.params.id!,
      payoutReference: req.body?.payoutReference as string | undefined,
      note: req.body?.note as string | undefined,
      actorAdminId: req.auth!.adminId,
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: 200,
      message: result.replayed
        ? 'Commission settlement already finalized'
        : 'Commission settlement finalized successfully',
      data: result.settlement,
      requestId: req.requestId,
    });
  }

  async cancel(req: Request, res: Response): Promise<Response> {
    const result = await commissionsService.cancel({
      settlementId: req.params.id!,
      actorAdminId: req.auth!.adminId,
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: 200,
      message: result.replayed
        ? 'Commission settlement already cancelled'
        : 'Commission settlement cancelled successfully',
      data: result.settlement,
      requestId: req.requestId,
    });
  }
}

export const commissionsController = new CommissionsController();
