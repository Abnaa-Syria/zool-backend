import type { Request, Response } from 'express';
import { successResponse } from '../../shared/http/success-response';
import { fleetService } from './fleet.service';

const actor = (req: Request) => ({ actorAdminId: req.auth!.adminId, requestId: req.requestId });

export class FleetController {
  async listVehicles(req: Request, res: Response): Promise<Response> {
    const r = await fleetService.listVehicles(req.query as Parameters<typeof fleetService.listVehicles>[0]);
    return successResponse(res, { message: 'Vehicles retrieved', data: r.items, meta: r.meta, requestId: req.requestId });
  }

  async getVehicle(req: Request, res: Response): Promise<Response> {
    const v = await fleetService.getVehicle(req.params.id!);
    return successResponse(res, { message: 'Vehicle retrieved', data: v, requestId: req.requestId });
  }

  async createVehicle(req: Request, res: Response): Promise<Response> {
    const v = await fleetService.createVehicle({ ...req.body, ...actor(req) });
    return successResponse(res, { statusCode: 201, message: 'Vehicle created', data: v, requestId: req.requestId });
  }

  async updateVehicle(req: Request, res: Response): Promise<Response> {
    const v = await fleetService.updateVehicle({ vehicleId: req.params.id!, patch: req.body, ...actor(req) });
    return successResponse(res, { message: 'Vehicle updated', data: v, requestId: req.requestId });
  }

  async listDrivers(req: Request, res: Response): Promise<Response> {
    const r = await fleetService.listDrivers(req.query as Parameters<typeof fleetService.listDrivers>[0]);
    return successResponse(res, { message: 'Drivers retrieved', data: r.items, meta: r.meta, requestId: req.requestId });
  }

  async getDriver(req: Request, res: Response): Promise<Response> {
    const d = await fleetService.getDriver(req.params.id!);
    return successResponse(res, { message: 'Driver retrieved', data: d, requestId: req.requestId });
  }

  async createDriver(req: Request, res: Response): Promise<Response> {
    const d = await fleetService.createDriver({ ...req.body, ...actor(req) });
    return successResponse(res, { statusCode: 201, message: 'Driver created', data: d, requestId: req.requestId });
  }

  async updateDriver(req: Request, res: Response): Promise<Response> {
    const d = await fleetService.updateDriver({ driverId: req.params.id!, patch: req.body, ...actor(req) });
    return successResponse(res, { message: 'Driver updated', data: d, requestId: req.requestId });
  }
}

export const fleetController = new FleetController();
