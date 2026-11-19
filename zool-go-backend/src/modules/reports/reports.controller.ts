import type { Request, Response } from 'express';
import { successResponse } from '../../shared/http/success-response';
import { reportsService, type BrokerActor } from './reports.service';

function actorOf(req: Request): BrokerActor {
  const auth = req.brokerAuth!;
  return {
    employeeId: auth.employeeId,
    officeId: auth.officeId,
    role: auth.role,
    permissions: auth.permissions,
  };
}

export class ReportsController {
  async summary(req: Request, res: Response): Promise<Response> {
    const data = await reportsService.summary(
      actorOf(req),
      req.query as { from?: string; to?: string },
    );
    return successResponse(res, {
      statusCode: 200,
      message: 'Office report summary retrieved successfully',
      data,
      requestId: req.requestId,
    });
  }

  async byEmployee(req: Request, res: Response): Promise<Response> {
    const data = await reportsService.byEmployee(
      actorOf(req),
      req.query as { from?: string; to?: string },
    );
    return successResponse(res, {
      statusCode: 200,
      message: 'Employee report retrieved successfully',
      data,
      requestId: req.requestId,
    });
  }

  async byCarrier(req: Request, res: Response): Promise<Response> {
    const data = await reportsService.byCarrier(
      actorOf(req),
      req.query as { from?: string; to?: string },
    );
    return successResponse(res, {
      statusCode: 200,
      message: 'Carrier report retrieved successfully',
      data,
      requestId: req.requestId,
    });
  }

  async walletActivity(req: Request, res: Response): Promise<Response> {
    const data = await reportsService.walletActivity(
      actorOf(req),
      req.query as { from?: string; to?: string },
    );
    return successResponse(res, {
      statusCode: 200,
      message: 'Wallet activity report retrieved successfully',
      data,
      requestId: req.requestId,
    });
  }
}

export const reportsController = new ReportsController();
