import type { Request, Response } from 'express';
import { successResponse } from '../../shared/http/success-response';
import { customerTripsService, type TripSearchQuery } from './customer-trips.service';

class CustomerTripsController {
  async search(req: Request, res: Response): Promise<Response> {
    const result = await customerTripsService.search(req.customerAuth!.customerId, req.query as unknown as TripSearchQuery);
    return successResponse(res, { message: 'Trips retrieved', data: result.items, meta: result.meta, requestId: req.requestId });
  }

  async filters(req: Request, res: Response): Promise<Response> {
    const data = await customerTripsService.filters(req.query as unknown as TripSearchQuery);
    return successResponse(res, { message: 'Trip filters retrieved', data, requestId: req.requestId });
  }

  async detail(req: Request, res: Response): Promise<Response> {
    const data = await customerTripsService.detail(req.params.tripId!);
    return successResponse(res, { message: 'Trip retrieved', data, requestId: req.requestId });
  }

  async seats(req: Request, res: Response): Promise<Response> {
    const data = await customerTripsService.seats(req.customerAuth!.customerId, req.params.tripId!);
    return successResponse(res, { message: 'Seat map retrieved', data, requestId: req.requestId });
  }

  async hold(req: Request, res: Response): Promise<Response> {
    const data = await customerTripsService.hold(req.customerAuth!.customerId, req.params.tripId!, req.body.seatLabels as string[]);
    return successResponse(res, { statusCode: 201, message: 'Seats held', data, requestId: req.requestId });
  }

  async releaseHold(req: Request, res: Response): Promise<Response> {
    const data = await customerTripsService.releaseHold(req.customerAuth!.customerId, req.params.holdId!);
    return successResponse(res, { message: 'Hold released', data, requestId: req.requestId });
  }

  async recentSearches(req: Request, res: Response): Promise<Response> {
    const data = await customerTripsService.recentSearches(req.customerAuth!.customerId);
    return successResponse(res, { message: 'Recent searches retrieved', data, requestId: req.requestId });
  }

  async clearRecentSearches(req: Request, res: Response): Promise<Response> {
    const data = await customerTripsService.clearRecentSearches(req.customerAuth!.customerId);
    return successResponse(res, { message: 'Recent searches cleared', data, requestId: req.requestId });
  }
}

export const customerTripsController = new CustomerTripsController();
