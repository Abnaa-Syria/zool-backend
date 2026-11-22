import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticate } from '../../shared/middleware/authenticate';
import { authenticateBroker } from '../../shared/middleware/authenticate-broker';
import { requirePermission } from '../../shared/middleware/require-permission';
import { validate } from '../../shared/middleware/validate';
import { successResponse } from '../../shared/http/success-response';
import { carrierPortalService } from '../carrier-portal/carrier-portal.service';
import { carriersController } from './carriers.controller';
import { carriersService } from './carriers.service';
import {
  affectedTripsQuerySchema,
  companyIdParamsSchema,
  createCarrierSchema,
  createCarrierStaffSchema,
  listCarriersQuerySchema,
  patchCarrierSchema,
  patchCarrierStaffSchema,
  staffParamsSchema,
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

// D-CARRIER-PORTAL-01: carrier portal accounts managed by the platform admin.
carriersRoutes.get(
  '/:companyId/staff',
  requirePermission('carriers.view'),
  validate({ params: companyIdParamsSchema }),
  asyncHandler(async (req, res) =>
    successResponse(res, { message: 'Carrier staff', data: await carrierPortalService.listStaff(req.params.companyId!), requestId: req.requestId }),
  ),
);

carriersRoutes.post(
  '/:companyId/staff',
  requirePermission('carriers.manage'),
  validate({ params: companyIdParamsSchema, body: createCarrierStaffSchema }),
  asyncHandler(async (req, res) => {
    await carriersService.getById(req.params.companyId!);
    const data = await carrierPortalService.createStaff({ companyId: req.params.companyId!, ...req.body, actor: { actorAdminId: req.auth!.adminId, requestId: req.requestId } });
    return successResponse(res, { statusCode: 201, message: 'Carrier employee created', data, requestId: req.requestId });
  }),
);

carriersRoutes.patch(
  '/:companyId/staff/:employeeId',
  requirePermission('carriers.manage'),
  validate({ params: staffParamsSchema, body: patchCarrierStaffSchema }),
  asyncHandler(async (req, res) => {
    const data = await carrierPortalService.updateStaff({
      companyId: req.params.companyId!,
      employeeId: req.params.employeeId!,
      patch: req.body,
      actor: { actorAdminId: req.auth!.adminId, requestId: req.requestId },
    });
    return successResponse(res, { message: 'Carrier employee updated', data, requestId: req.requestId });
  }),
);

/** Broker routes. Mounted at `${API_PREFIX}/broker/carriers` */
export const brokerCarrierRoutes = Router();

brokerCarrierRoutes.use(authenticateBroker);

brokerCarrierRoutes.get(
  '/',
  asyncHandler((req, res) => carriersController.listAssigned(req, res)),
);
