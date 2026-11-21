import type { Request, Response } from 'express';
import { successResponse } from '../../shared/http/success-response';
import { networkService } from './network.service';

const actor = (req: Request) => ({ actorAdminId: req.auth!.adminId, requestId: req.requestId });

export class NetworkController {
  async listRoutes(req: Request, res: Response): Promise<Response> {
    const r = await networkService.listRoutes(req.query as Parameters<typeof networkService.listRoutes>[0]);
    return successResponse(res, { message: 'Routes retrieved', data: r.items, meta: r.meta, requestId: req.requestId });
  }

  async getRoute(req: Request, res: Response): Promise<Response> {
    return successResponse(res, { message: 'Route retrieved', data: await networkService.getRoute(req.params.id!), requestId: req.requestId });
  }

  async createRoute(req: Request, res: Response): Promise<Response> {
    const route = await networkService.createRoute({ ...req.body, ...actor(req) });
    return successResponse(res, { statusCode: 201, message: 'Route created', data: route, requestId: req.requestId });
  }

  async updateRoute(req: Request, res: Response): Promise<Response> {
    const route = await networkService.updateRoute({ routeId: req.params.id!, patch: req.body, ...actor(req) });
    return successResponse(res, { message: 'Route updated', data: route, requestId: req.requestId });
  }

  async scheduleTrips(req: Request, res: Response): Promise<Response> {
    const trips = await networkService.scheduleTrips({ ...req.body, ...actor(req) });
    return successResponse(res, { statusCode: 201, message: 'Trips scheduled', data: trips, requestId: req.requestId });
  }

  async getTrip(req: Request, res: Response): Promise<Response> {
    return successResponse(res, { message: 'Trip retrieved', data: await networkService.getTrip(req.params.id!), requestId: req.requestId });
  }

  async updateAssignment(req: Request, res: Response): Promise<Response> {
    const trip = await networkService.updateAssignment({ tripId: req.params.id!, patch: req.body, ...actor(req) });
    return successResponse(res, { message: 'Trip assignment updated', data: trip, requestId: req.requestId });
  }
}

export const networkController = new NetworkController();
