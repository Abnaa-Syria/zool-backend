import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticate } from '../../shared/middleware/authenticate';
import { requirePermission } from '../../shared/middleware/require-permission';
import { validate } from '../../shared/middleware/validate';
import { brokersController } from './brokers.controller';
import {
  createStaffSchema,
  updateStaffSchema,
} from '../broker-staff/broker-staff.validation';
import {
  createBrokerOfficeSchema,
  listBrokerOfficesQuerySchema,
  officeIdParamsSchema,
  officeStaffParamsSchema,
  replaceAssignmentsSchema,
  updateOfficePolicySchema,
  updateOfficeStatusSchema,
} from './brokers.validation';

/**
 * Central-admin routes for broker offices.
 * Mounted at `${API_PREFIX}/brokers` — not the broker principal (`/broker/*`).
 */
export const brokersRoutes = Router();

brokersRoutes.use(authenticate);

brokersRoutes.post(
  '/',
  requirePermission('brokers.manage'),
  validate({ body: createBrokerOfficeSchema }),
  asyncHandler((req, res) => brokersController.create(req, res)),
);

brokersRoutes.get(
  '/',
  requirePermission('brokers.view'),
  validate({ query: listBrokerOfficesQuerySchema }),
  asyncHandler((req, res) => brokersController.list(req, res)),
);

brokersRoutes.get(
  '/:officeId',
  requirePermission('brokers.view'),
  validate({ params: officeIdParamsSchema }),
  asyncHandler((req, res) => brokersController.get(req, res)),
);

brokersRoutes.put(
  '/:officeId/carriers',
  requirePermission('brokers.manage'),
  validate({ params: officeIdParamsSchema, body: replaceAssignmentsSchema }),
  asyncHandler((req, res) => brokersController.replaceCarriers(req, res)),
);

brokersRoutes.patch(
  '/:officeId/status',
  requirePermission('brokers.manage'),
  validate({ params: officeIdParamsSchema, body: updateOfficeStatusSchema }),
  asyncHandler((req, res) => brokersController.updateStatus(req, res)),
);

brokersRoutes.patch(
  '/:officeId',
  requirePermission('brokers.manage'),
  validate({ params: officeIdParamsSchema, body: updateOfficePolicySchema }),
  asyncHandler((req, res) => brokersController.updatePolicy(req, res)),
);

brokersRoutes.post(
  '/:officeId/staff',
  requirePermission('brokers.manage'),
  validate({ params: officeIdParamsSchema, body: createStaffSchema }),
  asyncHandler((req, res) => brokersController.createStaff(req, res)),
);

brokersRoutes.patch(
  '/:officeId/staff/:employeeId',
  requirePermission('brokers.manage'),
  validate({ params: officeStaffParamsSchema, body: updateStaffSchema }),
  asyncHandler((req, res) => brokersController.updateStaff(req, res)),
);
