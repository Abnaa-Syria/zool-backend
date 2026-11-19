import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticate } from '../../shared/middleware/authenticate';
import { authenticateBroker } from '../../shared/middleware/authenticate-broker';
import { requireBrokerPermission } from '../../shared/middleware/require-broker-permission';
import { requirePermission } from '../../shared/middleware/require-permission';
import { validate } from '../../shared/middleware/validate';
import { catalogController } from './catalog.controller';
import {
  adminTripsQuerySchema,
  appendSeatsSchema,
  brokerTripsQuerySchema,
  createHoldsSchema,
  createTripSchema,
  holdIdParamsSchema,
  patchTripSchema,
  tripIdParamsSchema,
} from './catalog.validation';

/** Admin routes. Mounted at `${API_PREFIX}/catalog` */
export const catalogRoutes = Router();

catalogRoutes.use(authenticate);

catalogRoutes.post(
  '/trips',
  requirePermission('catalog.manage'),
  validate({ body: createTripSchema }),
  asyncHandler((req, res) => catalogController.createTrip(req, res)),
);

catalogRoutes.get(
  '/trips',
  requirePermission('catalog.view'),
  validate({ query: adminTripsQuerySchema }),
  asyncHandler((req, res) => catalogController.listTripsAdmin(req, res)),
);

catalogRoutes.get(
  '/trips/:tripId',
  requirePermission('catalog.view'),
  validate({ params: tripIdParamsSchema }),
  asyncHandler((req, res) => catalogController.getTripAdmin(req, res)),
);

catalogRoutes.patch(
  '/trips/:tripId',
  requirePermission('catalog.manage'),
  validate({ params: tripIdParamsSchema, body: patchTripSchema }),
  asyncHandler((req, res) => catalogController.patchTrip(req, res)),
);

catalogRoutes.post(
  '/trips/:tripId/seats',
  requirePermission('catalog.manage'),
  validate({ params: tripIdParamsSchema, body: appendSeatsSchema }),
  asyncHandler((req, res) => catalogController.appendSeats(req, res)),
);

/** Broker routes. Mounted at `${API_PREFIX}/broker/trips` */
export const brokerTripRoutes = Router();

brokerTripRoutes.use(authenticateBroker);

brokerTripRoutes.get(
  '/',
  validate({ query: brokerTripsQuerySchema }),
  asyncHandler((req, res) => catalogController.searchTrips(req, res)),
);

brokerTripRoutes.get(
  '/:tripId',
  validate({ params: tripIdParamsSchema }),
  asyncHandler((req, res) => catalogController.getTrip(req, res)),
);

brokerTripRoutes.post(
  '/:tripId/holds',
  requireBrokerPermission('broker.book'),
  validate({ params: tripIdParamsSchema, body: createHoldsSchema }),
  asyncHandler((req, res) => catalogController.createHolds(req, res)),
);

/** Broker routes. Mounted at `${API_PREFIX}/broker/holds` */
export const brokerHoldRoutes = Router();

brokerHoldRoutes.use(authenticateBroker);

brokerHoldRoutes.delete(
  '/:holdId',
  requireBrokerPermission('broker.book'),
  validate({ params: holdIdParamsSchema }),
  asyncHandler((req, res) => catalogController.releaseHold(req, res)),
);
