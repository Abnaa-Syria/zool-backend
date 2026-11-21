import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticate } from '../../shared/middleware/authenticate';
import { requirePermission } from '../../shared/middleware/require-permission';
import { validate } from '../../shared/middleware/validate';
import { networkController } from './network.controller';
import {
  createRouteSchema,
  idParamsSchema,
  listRoutesQuerySchema,
  patchAssignmentSchema,
  patchRouteSchema,
  scheduleTripsSchema,
} from './network.validation';

/** Admin routes (lines) and structured trip scheduling. Mounted at `${API_PREFIX}/admin`. */
export const adminNetworkRoutes = Router();

adminNetworkRoutes.use(authenticate);

adminNetworkRoutes.get('/routes', requirePermission('catalog.view'), validate({ query: listRoutesQuerySchema }), asyncHandler((req, res) => networkController.listRoutes(req, res)));
adminNetworkRoutes.post('/routes', requirePermission('catalog.manage'), validate({ body: createRouteSchema }), asyncHandler((req, res) => networkController.createRoute(req, res)));
adminNetworkRoutes.get('/routes/:id', requirePermission('catalog.view'), validate({ params: idParamsSchema }), asyncHandler((req, res) => networkController.getRoute(req, res)));
adminNetworkRoutes.patch('/routes/:id', requirePermission('catalog.manage'), validate({ params: idParamsSchema, body: patchRouteSchema }), asyncHandler((req, res) => networkController.updateRoute(req, res)));

adminNetworkRoutes.post('/trips/schedule', requirePermission('catalog.manage'), validate({ body: scheduleTripsSchema }), asyncHandler((req, res) => networkController.scheduleTrips(req, res)));
adminNetworkRoutes.get('/trips/:id', requirePermission('catalog.view'), validate({ params: idParamsSchema }), asyncHandler((req, res) => networkController.getTrip(req, res)));
adminNetworkRoutes.patch('/trips/:id/assignment', requirePermission('catalog.manage'), validate({ params: idParamsSchema, body: patchAssignmentSchema }), asyncHandler((req, res) => networkController.updateAssignment(req, res)));
