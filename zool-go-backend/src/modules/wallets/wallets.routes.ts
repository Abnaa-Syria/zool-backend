import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticate } from '../../shared/middleware/authenticate';
import { authenticateBroker } from '../../shared/middleware/authenticate-broker';
import { requirePermission } from '../../shared/middleware/require-permission';
import { validate } from '../../shared/middleware/validate';
import { walletsController } from './wallets.controller';
import {
  adminWalletListQuerySchema,
  ledgerQuerySchema,
  officeIdParamsSchema,
} from './wallets.validation';

/** Mounted at `${API_PREFIX}/broker/wallet` */
export const brokerWalletRoutes = Router();

brokerWalletRoutes.use(authenticateBroker);

brokerWalletRoutes.get(
  '/',
  asyncHandler((req, res) => walletsController.getBrokerWallet(req, res)),
);

brokerWalletRoutes.get(
  '/ledger',
  validate({ query: ledgerQuerySchema }),
  asyncHandler((req, res) => walletsController.listBrokerLedger(req, res)),
);

/** Mounted at `${API_PREFIX}/admin/wallets` */
export const adminWalletRoutes = Router();

adminWalletRoutes.use(authenticate);

adminWalletRoutes.get(
  '/',
  requirePermission('wallets.view'),
  validate({ query: adminWalletListQuerySchema }),
  asyncHandler((req, res) => walletsController.listAdmin(req, res)),
);

adminWalletRoutes.get(
  '/:officeId',
  requirePermission('wallets.view'),
  validate({ params: officeIdParamsSchema, query: ledgerQuerySchema }),
  asyncHandler((req, res) => walletsController.getAdminWallet(req, res)),
);
