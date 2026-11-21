import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticate } from '../../shared/middleware/authenticate';
import { requirePermission } from '../../shared/middleware/require-permission';
import { validate } from '../../shared/middleware/validate';
import { fleetController } from './fleet.controller';
import {
  createDriverSchema,
  createVehicleSchema,
  idParamsSchema,
  listDriversQuerySchema,
  listVehiclesQuerySchema,
  patchDriverSchema,
  patchVehicleSchema,
} from './fleet.validation';

/** Admin fleet. Mounted at `${API_PREFIX}/admin` (vehicles, drivers). */
export const adminFleetRoutes = Router();

adminFleetRoutes.use(authenticate);

adminFleetRoutes.get('/vehicles', requirePermission('fleet.view'), validate({ query: listVehiclesQuerySchema }), asyncHandler((req, res) => fleetController.listVehicles(req, res)));
adminFleetRoutes.post('/vehicles', requirePermission('fleet.manage'), validate({ body: createVehicleSchema }), asyncHandler((req, res) => fleetController.createVehicle(req, res)));
adminFleetRoutes.get('/vehicles/:id', requirePermission('fleet.view'), validate({ params: idParamsSchema }), asyncHandler((req, res) => fleetController.getVehicle(req, res)));
adminFleetRoutes.patch('/vehicles/:id', requirePermission('fleet.manage'), validate({ params: idParamsSchema, body: patchVehicleSchema }), asyncHandler((req, res) => fleetController.updateVehicle(req, res)));

adminFleetRoutes.get('/drivers', requirePermission('fleet.view'), validate({ query: listDriversQuerySchema }), asyncHandler((req, res) => fleetController.listDrivers(req, res)));
adminFleetRoutes.post('/drivers', requirePermission('fleet.manage'), validate({ body: createDriverSchema }), asyncHandler((req, res) => fleetController.createDriver(req, res)));
adminFleetRoutes.get('/drivers/:id', requirePermission('fleet.view'), validate({ params: idParamsSchema }), asyncHandler((req, res) => fleetController.getDriver(req, res)));
adminFleetRoutes.patch('/drivers/:id', requirePermission('fleet.manage'), validate({ params: idParamsSchema, body: patchDriverSchema }), asyncHandler((req, res) => fleetController.updateDriver(req, res)));
