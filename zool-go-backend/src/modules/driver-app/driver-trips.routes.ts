import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { TripStatus } from '@prisma/client';
import { successResponse } from '../../shared/http/success-response';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticateDriver } from '../../shared/middleware/authenticate-mobile';
import { validate } from '../../shared/middleware/validate';
import { paginationQuerySchema } from '../../shared/validation/common';
import { driverTripsService } from './driver-trips.service';

const tripParams = z.object({ tripId: z.string().min(1).max(64) });
const stopParams = tripParams.extend({ stopId: z.string().min(1).max(64) });
const listQuery = paginationQuerySchema.extend({ tab: z.enum(['UPCOMING', 'CURRENT', 'COMPLETED']).optional() });
const statusBody = z.object({ status: z.enum(['BOARDING', 'IN_PROGRESS', 'COMPLETED']) }).strict();
const stopBody = z.object({ event: z.enum(['ARRIVED', 'DEPARTED']) }).strict();
const positionsBody = z
  .object({
    positions: z
      .array(
        z
          .object({
            lat: z.number().min(-90).max(90),
            lng: z.number().min(-180).max(180),
            speedKmh: z.number().int().min(0).max(300).optional(),
            heading: z.number().int().min(0).max(359).optional(),
            recordedAt: z.string().datetime(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
const scanBody = z.object({ code: z.string().trim().min(4).max(256) }).strict();
const boardBody = z
  .object({ ticketNumber: z.string().trim().min(4).max(64), method: z.enum(['QR', 'MANUAL']).default('QR'), cashCollectedMinor: z.number().int().min(0).optional() })
  .strict();
const noShowBody = z.object({ ticketNumber: z.string().trim().min(4).max(64) }).strict();

const ok = (req: Request, res: Response, message: string, data: unknown, statusCode = 200) =>
  successResponse(res, { statusCode, message, data, requestId: req.requestId });

class DriverTripsController {
  async dashboard(req: Request, res: Response) {
    return ok(req, res, 'Dashboard', await driverTripsService.dashboard(req.driverAuth!.driverId));
  }

  async list(req: Request, res: Response) {
    const r = await driverTripsService.list(req.driverAuth!.driverId, req.query as { tab?: 'UPCOMING' | 'CURRENT' | 'COMPLETED'; page?: number; pageSize?: number });
    return successResponse(res, { message: 'Trips retrieved', data: r.items, meta: r.meta, requestId: req.requestId });
  }

  async detail(req: Request, res: Response) {
    return ok(req, res, 'Trip retrieved', await driverTripsService.detail(req.driverAuth!.driverId, req.params.tripId!));
  }

  async status(req: Request, res: Response) {
    const data = await driverTripsService.setStatus(req.driverAuth!.driverId, req.params.tripId!, req.body.status as TripStatus, req.requestId);
    return ok(req, res, 'Trip status updated', data);
  }

  async stop(req: Request, res: Response) {
    return ok(req, res, 'Stop recorded', await driverTripsService.stopEvent(req.driverAuth!.driverId, req.params.tripId!, req.params.stopId!, req.body.event));
  }

  async positions(req: Request, res: Response) {
    return ok(req, res, 'Positions recorded', await driverTripsService.recordPositions(req.driverAuth!.driverId, req.params.tripId!, req.body.positions), 202);
  }

  async manifest(req: Request, res: Response) {
    return ok(req, res, 'Manifest retrieved', await driverTripsService.manifest(req.driverAuth!.driverId, req.params.tripId!));
  }

  async scan(req: Request, res: Response) {
    return ok(req, res, 'Scan result', await driverTripsService.scan(req.driverAuth!.driverId, req.params.tripId!, req.body.code as string));
  }

  async board(req: Request, res: Response) {
    const data = await driverTripsService.board(req.driverAuth!.driverId, req.params.tripId!, { ...req.body, requestId: req.requestId });
    return ok(req, res, data.replayed ? 'Already boarded' : 'Passenger boarded', data, data.replayed ? 200 : 201);
  }

  async noShow(req: Request, res: Response) {
    return ok(req, res, 'Marked as no-show', await driverTripsService.markNoShow(req.driverAuth!.driverId, req.params.tripId!, req.body.ticketNumber as string));
  }

  async cash(req: Request, res: Response) {
    return ok(req, res, 'Cash summary', await driverTripsService.cash(req.driverAuth!.driverId, req.params.tripId!));
  }
}

const c = new DriverTripsController();

/** Mounted at `${API_PREFIX}/driver/dashboard`. */
export const driverDashboardRoutes = Router();
driverDashboardRoutes.get('/', authenticateDriver, asyncHandler((req, res) => c.dashboard(req, res)));

/** Mounted at `${API_PREFIX}/driver/trips`. Only trips assigned to the signed-in driver. */
export const driverTripRoutes = Router();
driverTripRoutes.use(authenticateDriver);
driverTripRoutes.get('/', validate({ query: listQuery }), asyncHandler((req, res) => c.list(req, res)));
driverTripRoutes.get('/:tripId', validate({ params: tripParams }), asyncHandler((req, res) => c.detail(req, res)));
driverTripRoutes.post('/:tripId/status', validate({ params: tripParams, body: statusBody }), asyncHandler((req, res) => c.status(req, res)));
driverTripRoutes.post('/:tripId/stops/:stopId', validate({ params: stopParams, body: stopBody }), asyncHandler((req, res) => c.stop(req, res)));
driverTripRoutes.post('/:tripId/positions', validate({ params: tripParams, body: positionsBody }), asyncHandler((req, res) => c.positions(req, res)));
driverTripRoutes.get('/:tripId/manifest', validate({ params: tripParams }), asyncHandler((req, res) => c.manifest(req, res)));
driverTripRoutes.post('/:tripId/scan', validate({ params: tripParams, body: scanBody }), asyncHandler((req, res) => c.scan(req, res)));
driverTripRoutes.post('/:tripId/boardings', validate({ params: tripParams, body: boardBody }), asyncHandler((req, res) => c.board(req, res)));
driverTripRoutes.post('/:tripId/no-shows', validate({ params: tripParams, body: noShowBody }), asyncHandler((req, res) => c.noShow(req, res)));
driverTripRoutes.get('/:tripId/cash', validate({ params: tripParams }), asyncHandler((req, res) => c.cash(req, res)));
