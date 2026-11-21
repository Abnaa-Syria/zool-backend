import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticate } from '../../shared/middleware/authenticate';
import { requirePermission } from '../../shared/middleware/require-permission';
import { validate } from '../../shared/middleware/validate';
import { geoController } from './geo.controller';
import {
  createAmenitySchema,
  createCitySchema,
  createStationSchema,
  idParamsSchema,
  listCitiesQuerySchema,
  listStationsQuerySchema,
  patchAmenitySchema,
  patchCitySchema,
  patchStationSchema,
} from './geo.validation';

/** Admin reference data. Mounted at `${API_PREFIX}/admin` (cities, stations, amenities). */
export const adminGeoRoutes = Router();

adminGeoRoutes.use(authenticate);

adminGeoRoutes.get(
  '/cities',
  requirePermission('geo.view'),
  validate({ query: listCitiesQuerySchema }),
  asyncHandler((req, res) => geoController.listCities(req, res)),
);
adminGeoRoutes.post(
  '/cities',
  requirePermission('geo.manage'),
  validate({ body: createCitySchema }),
  asyncHandler((req, res) => geoController.createCity(req, res)),
);
adminGeoRoutes.patch(
  '/cities/:id',
  requirePermission('geo.manage'),
  validate({ params: idParamsSchema, body: patchCitySchema }),
  asyncHandler((req, res) => geoController.updateCity(req, res)),
);

adminGeoRoutes.get(
  '/stations',
  requirePermission('geo.view'),
  validate({ query: listStationsQuerySchema }),
  asyncHandler((req, res) => geoController.listStations(req, res)),
);
adminGeoRoutes.post(
  '/stations',
  requirePermission('geo.manage'),
  validate({ body: createStationSchema }),
  asyncHandler((req, res) => geoController.createStation(req, res)),
);
adminGeoRoutes.patch(
  '/stations/:id',
  requirePermission('geo.manage'),
  validate({ params: idParamsSchema, body: patchStationSchema }),
  asyncHandler((req, res) => geoController.updateStation(req, res)),
);

adminGeoRoutes.get(
  '/amenities',
  requirePermission('geo.view'),
  asyncHandler((req, res) => geoController.listAmenities(req, res)),
);
adminGeoRoutes.post(
  '/amenities',
  requirePermission('geo.manage'),
  validate({ body: createAmenitySchema }),
  asyncHandler((req, res) => geoController.createAmenity(req, res)),
);
adminGeoRoutes.patch(
  '/amenities/:id',
  requirePermission('geo.manage'),
  validate({ params: idParamsSchema, body: patchAmenitySchema }),
  asyncHandler((req, res) => geoController.updateAmenity(req, res)),
);
