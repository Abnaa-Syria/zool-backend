import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticateBroker } from '../../shared/middleware/authenticate-broker';
import { requireBrokerPermission } from '../../shared/middleware/require-broker-permission';
import { validate } from '../../shared/middleware/validate';
import { brokerStaffController } from './broker-staff.controller';
import {
  createStaffSchema,
  employeeIdParamsSchema,
  updateStaffSchema,
} from './broker-staff.validation';

/** Mounted at `${API_PREFIX}/broker/staff` */
export const brokerStaffRoutes = Router();

brokerStaffRoutes.use(authenticateBroker);
brokerStaffRoutes.use(requireBrokerPermission('broker.staff.manage'));

brokerStaffRoutes.get(
  '/',
  asyncHandler((req, res) => brokerStaffController.list(req, res)),
);

brokerStaffRoutes.post(
  '/',
  validate({ body: createStaffSchema }),
  asyncHandler((req, res) => brokerStaffController.create(req, res)),
);

brokerStaffRoutes.patch(
  '/:employeeId',
  validate({ params: employeeIdParamsSchema, body: updateStaffSchema }),
  asyncHandler((req, res) => brokerStaffController.update(req, res)),
);
