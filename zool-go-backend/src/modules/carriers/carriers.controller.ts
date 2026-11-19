import type { TransportCompanyStatus } from '@prisma/client';
import type { Request, Response } from 'express';
import { successResponse } from '../../shared/http/success-response';
import { carriersService } from './carriers.service';

export class CarriersController {
  async create(req: Request, res: Response): Promise<Response> {
    const carrier = await carriersService.create({
      key: req.body.key as string,
      name: req.body.name as string,
      actorAdminId: req.auth!.adminId,
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: 201,
      message: 'Carrier created successfully',
      data: carrier,
      requestId: req.requestId,
    });
  }

  async list(req: Request, res: Response): Promise<Response> {
    const result = await carriersService.list(
      req.query as {
        page?: number;
        pageSize?: number;
        status?: TransportCompanyStatus;
        q?: string;
      },
    );
    return successResponse(res, {
      statusCode: 200,
      message: 'Carriers retrieved successfully',
      data: result.items,
      meta: result.meta,
      requestId: req.requestId,
    });
  }

  async get(req: Request, res: Response): Promise<Response> {
    const carrier = await carriersService.getById(req.params.companyId!);
    return successResponse(res, {
      statusCode: 200,
      message: 'Carrier retrieved successfully',
      data: carrier,
      requestId: req.requestId,
    });
  }

  async update(req: Request, res: Response): Promise<Response> {
    const carrier = await carriersService.update({
      companyId: req.params.companyId!,
      name: req.body.name as string | undefined,
      status: req.body.status as TransportCompanyStatus | undefined,
      actorAdminId: req.auth!.adminId,
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: 200,
      message: 'Carrier updated successfully',
      data: carrier,
      requestId: req.requestId,
    });
  }

  async listAssigned(req: Request, res: Response): Promise<Response> {
    const carriers = await carriersService.listAssignedForOffice(req.brokerAuth!.officeId);
    return successResponse(res, {
      statusCode: 200,
      message: 'Assigned carriers retrieved successfully',
      data: carriers,
      requestId: req.requestId,
    });
  }
}

export const carriersController = new CarriersController();
