import { Router, type Request, type Response } from 'express';
import { BookingStatus } from '@prisma/client';
import { z } from 'zod';
import { getPrisma } from '../../infrastructure/database/prisma';
import { AppError } from '../../shared/errors/app-error';
import { successResponse } from '../../shared/http/success-response';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticate } from '../../shared/middleware/authenticate';
import { authenticateCustomer } from '../../shared/middleware/authenticate-mobile';
import { requirePermission } from '../../shared/middleware/require-permission';
import { validate } from '../../shared/middleware/validate';
import { trackingService } from './tracking.service';

const bookingParams = z.object({ bookingId: z.string().min(1).max(64) });
const tripParams = z.object({ tripId: z.string().min(1).max(64) });

class TrackingController {
  /** Customer: live state of the trip of one of my confirmed bookings (polled every ~15 s). */
  async customerLive(req: Request, res: Response): Promise<Response> {
    const booking = await getPrisma().booking.findFirst({
      where: { id: req.params.bookingId!, customerId: req.customerAuth!.customerId },
      select: { tripId: true, status: true },
    });
    if (!booking) throw AppError.notFound('Booking not found');
    if (booking.status !== BookingStatus.CONFIRMED) throw AppError.conflict('Live tracking is available for confirmed bookings', { status: booking.status });
    const data = await trackingService.viewById(booking.tripId);
    return successResponse(res, { message: 'Live trip', data, requestId: req.requestId });
  }

  async adminActive(req: Request, res: Response): Promise<Response> {
    const data = await trackingService.activeTrips();
    return successResponse(res, { message: 'Active trips', data, meta: { total: data.length }, requestId: req.requestId });
  }

  async adminTrip(req: Request, res: Response): Promise<Response> {
    const [live, trail] = await Promise.all([trackingService.viewById(req.params.tripId!), trackingService.trail(req.params.tripId!)]);
    return successResponse(res, { message: 'Trip tracking', data: { ...live, trail }, requestId: req.requestId });
  }
}

const c = new TrackingController();

/** Mounted at `${API_PREFIX}/customer/bookings`. */
export const customerLiveRoutes = Router();
customerLiveRoutes.get('/:bookingId/live', authenticateCustomer, validate({ params: bookingParams }), asyncHandler((req, res) => c.customerLive(req, res)));

/** Mounted at `${API_PREFIX}/admin/tracking` (catalog.view). */
export const adminTrackingRoutes = Router();
adminTrackingRoutes.use(authenticate);
adminTrackingRoutes.get('/live', requirePermission('catalog.view'), asyncHandler((req, res) => c.adminActive(req, res)));
adminTrackingRoutes.get('/trips/:tripId', requirePermission('catalog.view'), validate({ params: tripParams }), asyncHandler((req, res) => c.adminTrip(req, res)));
