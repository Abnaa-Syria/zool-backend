import { PrincipalType } from '@prisma/client';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import { successResponse } from '../../shared/http/success-response';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticateBroker } from '../../shared/middleware/authenticate-broker';
import { authenticateCustomer, authenticateDriver } from '../../shared/middleware/authenticate-mobile';
import { validate } from '../../shared/middleware/validate';
import { paginationQuerySchema } from '../../shared/validation/common';
import { notificationsService } from './notifications.service';

const idParams = z.object({ id: z.string().min(1).max(64) });
const tokenParams = z.object({ token: z.string().min(10).max(512) });
const deviceBody = z.object({ platform: z.enum(['IOS', 'ANDROID', 'WEB']), pushToken: z.string().trim().min(10).max(512) }).strict();

type Who = (req: Request) => { type: PrincipalType; id: string };

/** Feed + device routes for one app principal (customer, driver or broker employee). */
function feedRoutes(auth: RequestHandler, who: Who) {
  const feed = Router();
  feed.use(auth);
  feed.get('/', validate({ query: paginationQuerySchema }), asyncHandler(async (req: Request, res: Response) => {
    const r = await notificationsService.feed(who(req), req.query as { page?: number; pageSize?: number });
    return successResponse(res, { message: 'Notifications retrieved', data: r.items, meta: r.meta, requestId: req.requestId });
  }));
  feed.get('/unread-count', asyncHandler(async (req: Request, res: Response) =>
    successResponse(res, { message: 'Unread count', data: await notificationsService.unreadCount(who(req)), requestId: req.requestId })));
  feed.post('/read-all', asyncHandler(async (req: Request, res: Response) =>
    successResponse(res, { message: 'All marked as read', data: await notificationsService.markAllRead(who(req)), requestId: req.requestId })));
  feed.post('/:id/read', validate({ params: idParams }), asyncHandler(async (req: Request, res: Response) =>
    successResponse(res, { message: 'Marked as read', data: await notificationsService.markRead(who(req), req.params.id!), requestId: req.requestId })));

  const devices = Router();
  devices.use(auth);
  devices.post('/', validate({ body: deviceBody }), asyncHandler(async (req: Request, res: Response) =>
    successResponse(res, { statusCode: 201, message: 'Device registered', data: await notificationsService.registerDevice(who(req), req.body.platform, req.body.pushToken), requestId: req.requestId })));
  devices.delete('/:token', validate({ params: tokenParams }), asyncHandler(async (req: Request, res: Response) =>
    successResponse(res, { message: 'Device removed', data: await notificationsService.removeDevice(who(req), req.params.token!), requestId: req.requestId })));
  return { feed, devices };
}

/** `${API_PREFIX}/customer/notifications` and `/customer/devices` */
export const customerNotificationRoutes = feedRoutes(authenticateCustomer, (req) => ({ type: PrincipalType.CUSTOMER, id: req.customerAuth!.customerId }));
/** `${API_PREFIX}/driver/notifications` and `/driver/devices` */
export const driverNotificationRoutes = feedRoutes(authenticateDriver, (req) => ({ type: PrincipalType.DRIVER, id: req.driverAuth!.driverId }));
/** `${API_PREFIX}/broker/notifications` and `/broker/devices` */
export const brokerNotificationRoutes = feedRoutes(authenticateBroker, (req) => ({ type: PrincipalType.BROKER_EMPLOYEE, id: req.brokerAuth!.employeeId }));
