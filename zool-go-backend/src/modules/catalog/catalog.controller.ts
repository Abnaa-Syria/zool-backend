import type { Request, Response } from 'express';
import { successResponse } from '../../shared/http/success-response';
import { catalogService } from './catalog.service';

export class CatalogController {
  async createTrip(req: Request, res: Response): Promise<Response> {
    const trip = await catalogService.createTrip({
      companyId: req.body.companyId as string,
      origin: req.body.origin as string,
      destination: req.body.destination as string,
      departureAt: req.body.departureAt as Date,
      basePrice: req.body.basePrice as number,
      seatLabels: req.body.seatLabels as string[],
      actorAdminId: req.auth!.adminId,
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: 201,
      message: 'Trip created successfully',
      data: trip,
      requestId: req.requestId,
    });
  }

  async listTripsAdmin(req: Request, res: Response): Promise<Response> {
    const result = await catalogService.listTripsAdmin(
      req.query as {
        page?: number;
        pageSize?: number;
        companyId?: string;
        origin?: string;
        destination?: string;
        date?: string;
      },
    );
    return successResponse(res, {
      statusCode: 200,
      message: 'Trips retrieved successfully',
      data: result.items,
      meta: result.meta,
      requestId: req.requestId,
    });
  }

  async patchTrip(req: Request, res: Response): Promise<Response> {
    const body = req.body as {
      origin?: string;
      destination?: string;
      departureAt?: Date;
      basePrice?: number;
      isActive?: boolean;
    };
    const trip = await catalogService.patchTrip({
      tripId: req.params.tripId!,
      ...body,
      actorAdminId: req.auth!.adminId,
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: 200,
      message: 'Trip updated successfully',
      data: trip,
      requestId: req.requestId,
    });
  }

  async appendSeats(req: Request, res: Response): Promise<Response> {
    const result = await catalogService.appendSeats({
      tripId: req.params.tripId!,
      seatLabels: req.body.seatLabels as string[],
      actorAdminId: req.auth!.adminId,
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: 200,
      message: 'Seats appended successfully',
      data: result,
      requestId: req.requestId,
    });
  }

  async searchTrips(req: Request, res: Response): Promise<Response> {
    const result = await catalogService.searchTripsForBroker(
      req.brokerAuth!.officeId,
      req.query as {
        page?: number;
        pageSize?: number;
        fromCityId?: string;
        toCityId?: string;
        origin?: string;
        destination?: string;
        date?: string;
        dateFrom?: string;
        dateTo?: string;
      },
    );
    return successResponse(res, {
      statusCode: 200,
      message: 'Trips retrieved successfully',
      data: result.items,
      meta: result.meta,
      requestId: req.requestId,
    });
  }

  async getTripAdmin(req: Request, res: Response): Promise<Response> {
    const trip = await catalogService.getTripForAdmin(req.params.tripId!);
    return successResponse(res, {
      statusCode: 200,
      message: 'Trip retrieved successfully',
      data: trip,
      requestId: req.requestId,
    });
  }

  async getTrip(req: Request, res: Response): Promise<Response> {
    const auth = req.brokerAuth!;
    const trip = await catalogService.getTripForBroker({
      tripId: req.params.tripId!,
      officeId: auth.officeId,
      employeeId: auth.employeeId,
    });
    return successResponse(res, {
      statusCode: 200,
      message: 'Trip retrieved successfully',
      data: trip,
      requestId: req.requestId,
    });
  }

  async createHolds(req: Request, res: Response): Promise<Response> {
    const auth = req.brokerAuth!;
    const result = await catalogService.createHolds({
      tripId: req.params.tripId!,
      officeId: auth.officeId,
      employeeId: auth.employeeId,
      mode: req.body.mode as 'MANUAL' | 'AUTO' | undefined,
      seatIds: req.body.seatIds as string[] | undefined,
      seatCount: req.body.seatCount as number | undefined,
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: 201,
      message: 'Seats held successfully',
      data: result,
      requestId: req.requestId,
    });
  }

  async releaseHold(req: Request, res: Response): Promise<Response> {
    const auth = req.brokerAuth!;
    const result = await catalogService.releaseHold({
      holdId: req.params.holdId!,
      officeId: auth.officeId,
      employeeId: auth.employeeId,
      role: auth.role,
    });
    return successResponse(res, {
      statusCode: 200,
      message: 'Seat hold released successfully',
      data: result,
      requestId: req.requestId,
    });
  }
}

export const catalogController = new CatalogController();
