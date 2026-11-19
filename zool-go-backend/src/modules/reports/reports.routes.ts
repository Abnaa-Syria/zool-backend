import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticateBroker } from '../../shared/middleware/authenticate-broker';
import { requireBrokerPermission } from '../../shared/middleware/require-broker-permission';
import { validate } from '../../shared/middleware/validate';
import { reportsController } from './reports.controller';
import { reportsRangeQuerySchema } from './reports.validation';

/** Mounted at `${API_PREFIX}/broker/reports` */
export const brokerReportsRoutes = Router();

brokerReportsRoutes.use(authenticateBroker);
brokerReportsRoutes.use(requireBrokerPermission('broker.reports.view', { allowManager: true }));

brokerReportsRoutes.get(
  '/summary',
  validate({ query: reportsRangeQuerySchema }),
  asyncHandler((req, res) => reportsController.summary(req, res)),
);

brokerReportsRoutes.get(
  '/by-employee',
  validate({ query: reportsRangeQuerySchema }),
  asyncHandler((req, res) => reportsController.byEmployee(req, res)),
);

brokerReportsRoutes.get(
  '/by-carrier',
  validate({ query: reportsRangeQuerySchema }),
  asyncHandler((req, res) => reportsController.byCarrier(req, res)),
);

brokerReportsRoutes.get(
  '/wallet-activity',
  validate({ query: reportsRangeQuerySchema }),
  asyncHandler((req, res) => reportsController.walletActivity(req, res)),
);
