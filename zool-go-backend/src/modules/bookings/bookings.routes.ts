import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticate } from '../../shared/middleware/authenticate';
import { authenticateBroker } from '../../shared/middleware/authenticate-broker';
import { requireBrokerPermission } from '../../shared/middleware/require-broker-permission';
import { requirePermission } from '../../shared/middleware/require-permission';
import { validate } from '../../shared/middleware/validate';
import { bookingsController } from './bookings.controller';
import {
  adminCancelBookingSchema,
  adminListBookingsQuerySchema,
  bookingIdParamsSchema,
  confirmBookingSchema,
  dispatchBookingSchema,
  listBookingsQuerySchema,
  quoteBookingSchema,
  ticketPdfParamsSchema,
} from './bookings.validation';

/** Mounted at `${API_PREFIX}/broker/bookings` */
export const brokerBookingRoutes = Router();

brokerBookingRoutes.use(authenticateBroker);

brokerBookingRoutes.post(
  '/quote',
  requireBrokerPermission('broker.book'),
  validate({ body: quoteBookingSchema }),
  asyncHandler((req, res) => bookingsController.quote(req, res)),
);

brokerBookingRoutes.post(
  '/confirm',
  requireBrokerPermission('broker.book'),
  validate({ body: confirmBookingSchema }),
  asyncHandler((req, res) => bookingsController.confirm(req, res)),
);

brokerBookingRoutes.get(
  '/',
  validate({ query: listBookingsQuerySchema }),
  asyncHandler((req, res) => bookingsController.list(req, res)),
);

brokerBookingRoutes.get(
  '/:id',
  validate({ params: bookingIdParamsSchema }),
  asyncHandler((req, res) => bookingsController.get(req, res)),
);

brokerBookingRoutes.post(
  '/:id/cancel',
  requireBrokerPermission('broker.book'),
  validate({ params: bookingIdParamsSchema }),
  asyncHandler((req, res) => bookingsController.cancel(req, res)),
);

brokerBookingRoutes.post(
  '/:id/dispatch',
  requireBrokerPermission('broker.book'),
  validate({ params: bookingIdParamsSchema, body: dispatchBookingSchema }),
  asyncHandler((req, res) => bookingsController.dispatch(req, res)),
);

brokerBookingRoutes.get(
  '/:id/tickets/:ticketNumber/pdf',
  requireBrokerPermission('broker.book'),
  validate({ params: ticketPdfParamsSchema }),
  asyncHandler((req, res) => bookingsController.getTicketPdf(req, res)),
);

/** Mounted at `${API_PREFIX}/admin/bookings` */
export const adminBookingRoutes = Router();

adminBookingRoutes.use(authenticate);

adminBookingRoutes.get(
  '/',
  requirePermission('bookings.view'),
  validate({ query: adminListBookingsQuerySchema }),
  asyncHandler((req, res) => bookingsController.listAdmin(req, res)),
);

adminBookingRoutes.get(
  '/:id/tickets/:ticketNumber/pdf',
  requirePermission('bookings.view'),
  validate({ params: ticketPdfParamsSchema }),
  asyncHandler((req, res) => bookingsController.getAdminTicketPdf(req, res)),
);

adminBookingRoutes.get(
  '/:id',
  requirePermission('bookings.view'),
  validate({ params: bookingIdParamsSchema }),
  asyncHandler((req, res) => bookingsController.getAdmin(req, res)),
);

adminBookingRoutes.post(
  '/:id/cancel',
  requirePermission('bookings.cancel'),
  validate({ params: bookingIdParamsSchema, body: adminCancelBookingSchema }),
  asyncHandler((req, res) => bookingsController.cancelAdmin(req, res)),
);
