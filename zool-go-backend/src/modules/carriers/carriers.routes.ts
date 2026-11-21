import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticate } from '../../shared/middleware/authenticate';
import { authenticateBroker } from '../../shared/middleware/authenticate-broker';
import { requirePermission } from '../../shared/middleware/require-permission';
import { validate } from '../../shared/middleware/validate';
import { carriersController } from './carriers.controller';
import {
  affectedTripsQuerySchema,
  companyIdParamsSchema,
  createCarrierSchema,
  listCarriersQuerySchema,
  patchCarrierSchema,
} from './carriers.validation';

/** Admin routes. Mounted at `${API_PREFIX}/carriers` */
export const carriersRoutes = Router();

carriersRoutes.use(authenticate);

carriersRoutes.post(
  '/',
  requirePermission('carriers.manage'),
  validate({ body: createCarrierSchema }),
  asyncHandler((req, res) => carriersController.create(req, res)),
);

carriersRoutes.get(
  '/',
  requirePermission('carriers.view'),
  validate({ query: listCarriersQuerySchema }),
  asyncHandler((req, res) => carriersController.list(req, res)),
);

carriersRoutes.get(
  '/:companyId',
  requirePermission('carriers.view'),
  validate({ params: companyIdParamsSchema }),
  asyncHandler((req, res) => carriersController.get(req, res)),
);

carriersRoutes.get(
  '/:companyId/affected-trips',
  requirePermission('carriers.view'),
  validate({ params: companyIdParamsSchema, query: affectedTripsQuerySchema }),
  asyncHandler((req, res) => carriersController.affectedTrips(req, res)),
);

carriersRoutes.patch(
  '/:companyId',
  requirePermission('carriers.manage'),
  validate({ params: companyIdParamsSchema, body: patchCarrierSchema }),
  asyncHandler((req, res) => carriersController.update(req, res)),
);

/** Broker routes. Mounted at `${API_PREFIX}/broker/carriers` */
export const brokerCarrierRoutes = Router();

brokerCarrierRoutes.use(authenticateBroker);

brokerCarrierRoutes.get(
  '/',
  asyncHandler((req, res) => carriersController.listAssigned(req, res)),
);
