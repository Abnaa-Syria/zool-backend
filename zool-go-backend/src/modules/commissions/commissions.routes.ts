import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticate } from '../../shared/middleware/authenticate';
import { authenticateBroker } from '../../shared/middleware/authenticate-broker';
import { requireBrokerPermission } from '../../shared/middleware/require-broker-permission';
import { requirePermission } from '../../shared/middleware/require-permission';
import { validate } from '../../shared/middleware/validate';
import { commissionsController } from './commissions.controller';
import {
  adminCommissionsQuerySchema,
  adminSettlementsQuerySchema,
  brokerCommissionsQuerySchema,
  createSettlementSchema,
  finalizeSettlementSchema,
  settlementAccrualsQuerySchema,
  settlementIdParamsSchema,
} from './commissions.validation';

/** Mounted at `${API_PREFIX}/broker/commissions` */
export const brokerCommissionRoutes = Router();

brokerCommissionRoutes.use(authenticateBroker);

brokerCommissionRoutes.get(
  '/',
  requireBrokerPermission('broker.reports.view', { allowManager: true }),
  validate({ query: brokerCommissionsQuerySchema }),
  asyncHandler((req, res) => commissionsController.listBroker(req, res)),
);

/** Mounted at `${API_PREFIX}/admin/commissions` */
export const adminCommissionRoutes = Router();

adminCommissionRoutes.use(authenticate);

adminCommissionRoutes.get(
  '/settlements',
  requirePermission('commissions.view'),
  validate({ query: adminSettlementsQuerySchema }),
  asyncHandler((req, res) => commissionsController.listSettlements(req, res)),
);

adminCommissionRoutes.post(
  '/settlements',
  requirePermission('commissions.payout'),
  validate({ body: createSettlementSchema }),
  asyncHandler((req, res) => commissionsController.createDraft(req, res)),
);

adminCommissionRoutes.get(
  '/settlements/:id/accruals',
  requirePermission('commissions.view'),
  validate({ params: settlementIdParamsSchema, query: settlementAccrualsQuerySchema }),
  asyncHandler((req, res) => commissionsController.listSettlementAccruals(req, res)),
);

adminCommissionRoutes.get(
  '/settlements/:id',
  requirePermission('commissions.view'),
  validate({ params: settlementIdParamsSchema }),
  asyncHandler((req, res) => commissionsController.getSettlement(req, res)),
);

adminCommissionRoutes.post(
  '/settlements/:id/finalize',
  requirePermission('commissions.payout'),
  validate({ params: settlementIdParamsSchema, body: finalizeSettlementSchema }),
  asyncHandler((req, res) => commissionsController.finalize(req, res)),
);

adminCommissionRoutes.post(
  '/settlements/:id/cancel',
  requirePermission('commissions.payout'),
  validate({ params: settlementIdParamsSchema }),
  asyncHandler((req, res) => commissionsController.cancel(req, res)),
);

adminCommissionRoutes.get(
  '/',
  requirePermission('commissions.view'),
  validate({ query: adminCommissionsQuerySchema }),
  asyncHandler((req, res) => commissionsController.listAdmin(req, res)),
);
