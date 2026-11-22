import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticateCustomer } from '../../shared/middleware/authenticate-mobile';
import { validate } from '../../shared/middleware/validate';
import { createMobileAuthRoutes, customerAuthStore, MobileAuthController, MobileAuthEngine } from '../mobile-auth';
import { customerBookingsController } from './customer-bookings.controller';
import {
  bookingIdParamsSchema,
  bookingsListQuerySchema,
  cancelBookingSchema,
  checkoutCreateSchema,
  checkoutQuoteSchema,
  intentParamsSchema,
  rateBookingSchema,
  ticketParamsSchema,
} from './customer-bookings.validation';
import { customerProfileController } from './customer-profile.controller';
import { customerTripsController } from './customer-trips.controller';
import {
  createCustomerHoldSchema,
  holdIdParamsSchema,
  tripIdParamsSchema,
  tripSearchBaseSchema,
  tripSearchQuerySchema,
} from './customer-trips.validation';
import { customerProfileService } from './customer-profile.service';
import { updateCustomerMeSchema, updateCustomerPreferencesSchema } from './customer-profile.validation';

/** Mounted at `${API_PREFIX}/customer/auth`. Verify creates the account on first login. */
export const customerAuthRoutes = createMobileAuthRoutes(
  new MobileAuthController(
    new MobileAuthEngine(customerAuthStore),
    { key: 'customer', load: (id) => customerProfileService.summary(id) },
    'isNewCustomer',
  ),
);

/** Mounted at `${API_PREFIX}/customer/me`. */
export const customerMeRoutes = Router();
customerMeRoutes.use(authenticateCustomer);
customerMeRoutes.get('/', asyncHandler((req, res) => customerProfileController.me(req, res)));
customerMeRoutes.patch('/', validate({ body: updateCustomerMeSchema }), asyncHandler((req, res) => customerProfileController.update(req, res)));
customerMeRoutes.patch(
  '/preferences',
  validate({ body: updateCustomerPreferencesSchema }),
  asyncHandler((req, res) => customerProfileController.preferences(req, res)),
);
customerMeRoutes.delete('/', asyncHandler((req, res) => customerProfileController.remove(req, res)));

/** Mounted at `${API_PREFIX}/customer/trips`. */
export const customerTripRoutes = Router();
customerTripRoutes.use(authenticateCustomer);
customerTripRoutes.get('/', validate({ query: tripSearchQuerySchema }), asyncHandler((req, res) => customerTripsController.search(req, res)));
customerTripRoutes.get('/filters', validate({ query: tripSearchBaseSchema }), asyncHandler((req, res) => customerTripsController.filters(req, res)));
customerTripRoutes.get('/:tripId', validate({ params: tripIdParamsSchema }), asyncHandler((req, res) => customerTripsController.detail(req, res)));
customerTripRoutes.get('/:tripId/seats', validate({ params: tripIdParamsSchema }), asyncHandler((req, res) => customerTripsController.seats(req, res)));
customerTripRoutes.post(
  '/:tripId/holds',
  validate({ params: tripIdParamsSchema, body: createCustomerHoldSchema }),
  asyncHandler((req, res) => customerTripsController.hold(req, res)),
);

/** Mounted at `${API_PREFIX}/customer/holds`. */
export const customerHoldRoutes = Router();
customerHoldRoutes.use(authenticateCustomer);
customerHoldRoutes.delete('/:holdId', validate({ params: holdIdParamsSchema }), asyncHandler((req, res) => customerTripsController.releaseHold(req, res)));

/** Mounted at `${API_PREFIX}/customer/recent-searches`. */
export const customerRecentSearchRoutes = Router();
customerRecentSearchRoutes.use(authenticateCustomer);
customerRecentSearchRoutes.get('/', asyncHandler((req, res) => customerTripsController.recentSearches(req, res)));
customerRecentSearchRoutes.delete('/', asyncHandler((req, res) => customerTripsController.clearRecentSearches(req, res)));

/** Mounted at `${API_PREFIX}/customer/bookings`. */
export const customerBookingRoutes = Router();
customerBookingRoutes.use(authenticateCustomer);
customerBookingRoutes.post('/quote', validate({ body: checkoutQuoteSchema }), asyncHandler((req, res) => customerBookingsController.quote(req, res)));
customerBookingRoutes.post('/', validate({ body: checkoutCreateSchema }), asyncHandler((req, res) => customerBookingsController.create(req, res)));
customerBookingRoutes.get('/', validate({ query: bookingsListQuerySchema }), asyncHandler((req, res) => customerBookingsController.list(req, res)));
customerBookingRoutes.get('/:bookingId', validate({ params: bookingIdParamsSchema }), asyncHandler((req, res) => customerBookingsController.get(req, res)));
customerBookingRoutes.get(
  '/:bookingId/cancellation-quote',
  validate({ params: bookingIdParamsSchema }),
  asyncHandler((req, res) => customerBookingsController.cancellationQuote(req, res)),
);
customerBookingRoutes.post(
  '/:bookingId/cancel',
  validate({ params: bookingIdParamsSchema, body: cancelBookingSchema }),
  asyncHandler((req, res) => customerBookingsController.cancel(req, res)),
);
customerBookingRoutes.post(
  '/:bookingId/rating',
  validate({ params: bookingIdParamsSchema, body: rateBookingSchema }),
  asyncHandler((req, res) => customerBookingsController.rate(req, res)),
);

/** Mounted at `${API_PREFIX}/customer/tickets`. */
export const customerTicketRoutes = Router();
customerTicketRoutes.use(authenticateCustomer);
customerTicketRoutes.get('/:ticketNumber', validate({ params: ticketParamsSchema }), asyncHandler((req, res) => customerBookingsController.ticket(req, res)));
customerTicketRoutes.get('/:ticketNumber/pdf', validate({ params: ticketParamsSchema }), asyncHandler((req, res) => customerBookingsController.ticketPdf(req, res)));

/** Mounted at `${API_PREFIX}/customer/payments`. */
export const customerPaymentRoutes = Router();
customerPaymentRoutes.use(authenticateCustomer);
customerPaymentRoutes.get('/methods', asyncHandler((req, res) => customerBookingsController.paymentMethods(req, res)));
customerPaymentRoutes.get('/:intentId', validate({ params: intentParamsSchema }), asyncHandler((req, res) => customerBookingsController.payment(req, res)));
customerPaymentRoutes.post(
  '/:intentId/mock-confirm',
  validate({ params: intentParamsSchema }),
  asyncHandler((req, res) => customerBookingsController.mockConfirm(req, res)),
);
