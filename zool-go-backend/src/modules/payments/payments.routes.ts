import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticate } from '../../shared/middleware/authenticate';
import { authenticateBroker } from '../../shared/middleware/authenticate-broker';
import { requireBrokerPermission } from '../../shared/middleware/require-broker-permission';
import { requireAnyPermission, requirePermission } from '../../shared/middleware/require-permission';
import { validate } from '../../shared/middleware/validate';
import { paymentsController } from './payments.controller';
import {
  adminTopUpsQuerySchema,
  approveTopUpSchema,
  brokerTopUpsQuerySchema,
  createTopUpSchema,
  intentIdParamsSchema,
  officeIdParamsSchema,
  providerParamsSchema,
  rejectTopUpSchema,
} from './payments.validation';
import { receiptUpload, requireReceipt } from './receipt-upload';

/** Mounted at `${API_PREFIX}/broker/wallet/top-ups` */
export const brokerTopUpRoutes = Router();

brokerTopUpRoutes.use(authenticateBroker);

brokerTopUpRoutes.post(
  '/',
  requireBrokerPermission('broker.wallet.topup'),
  validate({ body: createTopUpSchema }),
  asyncHandler((req, res) => paymentsController.createTopUp(req, res)),
);

brokerTopUpRoutes.get(
  '/',
  requireBrokerPermission('broker.wallet.topup', { allowManager: true }),
  validate({ query: brokerTopUpsQuerySchema }),
  asyncHandler((req, res) => paymentsController.listBroker(req, res)),
);

brokerTopUpRoutes.get(
  '/:intentId',
  requireBrokerPermission('broker.wallet.topup', { allowManager: true }),
  validate({ params: intentIdParamsSchema }),
  asyncHandler((req, res) => paymentsController.getBroker(req, res)),
);

brokerTopUpRoutes.post(
  '/:intentId/mock-confirm',
  requireBrokerPermission('broker.wallet.topup'),
  validate({ params: intentIdParamsSchema }),
  asyncHandler((req, res) => paymentsController.mockConfirm(req, res)),
);

brokerTopUpRoutes.post(
  '/:intentId/evidence',
  requireBrokerPermission('broker.wallet.topup'),
  validate({ params: intentIdParamsSchema }),
  receiptUpload,
  requireReceipt,
  asyncHandler((req, res) => paymentsController.submitEvidence(req, res)),
);

/** Mounted at `${API_PREFIX}/payments/webhooks` */
export const paymentWebhookRoutes = Router();

paymentWebhookRoutes.post(
  '/:provider',
  validate({ params: providerParamsSchema }),
  asyncHandler((req, res) => paymentsController.webhook(req, res)),
);

/** Mounted at `${API_PREFIX}/admin/wallets` — additional top-up routes */
export const adminTopUpRoutes = Router();

adminTopUpRoutes.use(authenticate);

adminTopUpRoutes.get(
  '/top-ups',
  requireAnyPermission('wallets.topups.view', 'wallets.topups.review'),
  validate({ query: adminTopUpsQuerySchema }),
  asyncHandler((req, res) => paymentsController.listAdmin(req, res)),
);

adminTopUpRoutes.post(
  '/:officeId/top-ups',
  requirePermission('wallets.topups.create_for_office'),
  validate({ params: officeIdParamsSchema }),
  receiptUpload,
  requireReceipt,
  asyncHandler((req, res) => paymentsController.adminCreate(req, res)),
);

adminTopUpRoutes.post(
  '/top-ups/:intentId/approve',
  requirePermission('wallets.topups.approve'),
  validate({ params: intentIdParamsSchema, body: approveTopUpSchema }),
  asyncHandler((req, res) => paymentsController.approve(req, res)),
);

adminTopUpRoutes.post(
  '/top-ups/:intentId/reject',
  requirePermission('wallets.topups.reject'),
  validate({ params: intentIdParamsSchema, body: rejectTopUpSchema }),
  asyncHandler((req, res) => paymentsController.reject(req, res)),
);

adminTopUpRoutes.get(
  '/top-ups/:intentId/evidence',
  requirePermission('wallets.topups.evidence.view'),
  validate({ params: intentIdParamsSchema }),
  asyncHandler((req, res) => paymentsController.getEvidence(req, res)),
);
