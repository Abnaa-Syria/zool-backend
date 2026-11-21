import type { Request, Response } from 'express';
import { successResponse } from '../../shared/http/success-response';
import { geoService } from './geo.service';

const actor = (req: Request) => ({ actorAdminId: req.auth!.adminId, requestId: req.requestId });

export class GeoController {
  async listCities(req: Request, res: Response): Promise<Response> {
    const result = await geoService.listCities(req.query as Parameters<typeof geoService.listCities>[0]);
    return successResponse(res, { message: 'Cities retrieved', data: result.items, meta: result.meta, requestId: req.requestId });
  }

  async createCity(req: Request, res: Response): Promise<Response> {
    const city = await geoService.createCity({ ...req.body, ...actor(req) });
    return successResponse(res, { statusCode: 201, message: 'City created', data: city, requestId: req.requestId });
  }

  async updateCity(req: Request, res: Response): Promise<Response> {
    const city = await geoService.updateCity({ cityId: req.params.id!, patch: req.body, ...actor(req) });
    return successResponse(res, { message: 'City updated', data: city, requestId: req.requestId });
  }

  async listStations(req: Request, res: Response): Promise<Response> {
    const result = await geoService.listStations(req.query as Parameters<typeof geoService.listStations>[0]);
    return successResponse(res, { message: 'Stations retrieved', data: result.items, meta: result.meta, requestId: req.requestId });
  }

  async createStation(req: Request, res: Response): Promise<Response> {
    const station = await geoService.createStation({ ...req.body, ...actor(req) });
    return successResponse(res, { statusCode: 201, message: 'Station created', data: station, requestId: req.requestId });
  }

  async updateStation(req: Request, res: Response): Promise<Response> {
    const station = await geoService.updateStation({ stationId: req.params.id!, patch: req.body, ...actor(req) });
    return successResponse(res, { message: 'Station updated', data: station, requestId: req.requestId });
  }

  async listAmenities(req: Request, res: Response): Promise<Response> {
    const items = await geoService.listAmenities();
    return successResponse(res, { message: 'Amenities retrieved', data: items, requestId: req.requestId });
  }

  async createAmenity(req: Request, res: Response): Promise<Response> {
    const amenity = await geoService.createAmenity({ ...req.body, ...actor(req) });
    return successResponse(res, { statusCode: 201, message: 'Amenity created', data: amenity, requestId: req.requestId });
  }

  async updateAmenity(req: Request, res: Response): Promise<Response> {
    const amenity = await geoService.updateAmenity({ amenityId: req.params.id!, patch: req.body, ...actor(req) });
    return successResponse(res, { message: 'Amenity updated', data: amenity, requestId: req.requestId });
  }
}

export const geoController = new GeoController();
