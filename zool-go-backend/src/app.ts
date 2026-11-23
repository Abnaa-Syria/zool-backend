import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { readFileSync } from 'fs';
import path from 'path';
import YAML from 'yaml';
import { corsOrigins, env } from './config/env';
import { logger } from './infrastructure/observability/logger';
import { errorHandler, notFoundHandler } from './shared/middleware/error-handler';
import { requestIdMiddleware } from './shared/middleware/request-id';
import { authRoutes } from './modules/auth';
import { adminsRoutes } from './modules/admins';
import { rolesRoutes } from './modules/roles';
import { permissionsRoutes } from './modules/permissions';
import { sessionsRoutes } from './modules/sessions';
import { auditRoutes } from './modules/audit';
import { healthRoutes } from './modules/health';
import { brokersRoutes } from './modules/brokers';
import { brokerAuthRoutes } from './modules/broker-auth';
import { brokerStaffRoutes } from './modules/broker-staff';
import { adminWalletRoutes, brokerWalletRoutes } from './modules/wallets';
import { adminTopUpRoutes, brokerTopUpRoutes, paymentWebhookRoutes } from './modules/payments';
import { brokerCarrierRoutes, carriersRoutes } from './modules/carriers';
import { brokerHoldRoutes, brokerTripRoutes, catalogRoutes } from './modules/catalog';
import { adminBookingRoutes, brokerBookingRoutes } from './modules/bookings';
import { adminCommissionRoutes, brokerCommissionRoutes } from './modules/commissions';
import { brokerDashboardRoutes, brokerReportsRoutes } from './modules/reports';
import { adminGeoRoutes } from './modules/geo';
import { adminFleetRoutes } from './modules/fleet';
import { adminNetworkRoutes } from './modules/network';
import { adminSettingsRoutes } from './modules/settings';
import { adminInsightsRoutes } from './modules/insights';
import { adminCustomersRoutes } from './modules/customers';
import { adminCouponsRoutes } from './modules/coupons';
import { adminContentRoutes, publicContentRoutes } from './modules/content';
import { publicAppRoutes } from './modules/public-app';
import {
  customerAuthRoutes,
  customerBookingRoutes,
  customerHoldRoutes,
  customerMeRoutes,
  customerPaymentRoutes,
  customerRecentSearchRoutes,
  customerTicketRoutes,
  customerTripRoutes,
} from './modules/customer-app';
import { driverAuthRoutes, driverDashboardRoutes, driverMeRoutes, driverTripRoutes } from './modules/driver-app';
import { adminTrackingRoutes, customerLiveRoutes } from './modules/tracking';
import { brokerBookingChangeRoutes, customerBookingChangeRoutes } from './modules/booking-changes';
import { brokerNotificationRoutes, customerNotificationRoutes, driverNotificationRoutes } from './modules/notifications';
import { adminRefundRoutes } from './modules/refunds';
import { carrierAuthRoutes, carrierPortalRoutes } from './modules/carrier-portal';
import { adminCarrierSettlementRoutes } from './modules/carrier-settlements';
import { adminCrudRoutes, adminOrgDeleteRoutes } from './modules/admin-delete';
import { settingsFreshness } from './shared/middleware/settings-freshness';

export function createApp() {
  const app = express();
  const config = env();

  if (config.TRUST_PROXY) {
    app.set('trust proxy', 1);
  }

  app.use(helmet());
  app.use(
    cors({
      origin: corsOrigins(),
      credentials: true,
    }),
  );
  // Request ID must precede body parsers so malformed JSON still carries requestId.
  app.use(requestIdMiddleware);

  const prefix = config.API_PREFIX;

  // Capture raw bytes for HMAC verification (must run before express.json).
  app.use(
    `${prefix}/payments/webhooks`,
    express.raw({ type: '*/*', limit: '100kb' }),
    (req, _res, next) => {
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body ?? ''), 'utf8');
      req.rawBody = raw;
      if (raw.length === 0) {
        req.body = {};
        next();
        return;
      }
      try {
        req.body = JSON.parse(raw.toString('utf8')) as unknown;
      } catch {
        req.body = {};
      }
      next();
    },
    paymentWebhookRoutes,
  );

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(
    pinoHttp({
      logger,
      autoLogging: config.NODE_ENV !== 'test',
      customProps: (req) => ({ requestId: req.requestId }),
    }),
  );

  app.use(settingsFreshness);
  app.use(prefix, healthRoutes);
  app.use(`${prefix}/auth`, authRoutes);
  app.use(`${prefix}/admins`, adminsRoutes);
  app.use(`${prefix}/roles`, rolesRoutes);
  app.use(`${prefix}/permissions`, permissionsRoutes);
  app.use(`${prefix}/sessions`, sessionsRoutes);
  app.use(`${prefix}/audit-logs`, auditRoutes);

  // Stage 2 — broker vertical (broker principal)
  app.use(`${prefix}/broker/auth`, brokerAuthRoutes);
  app.use(`${prefix}/broker/staff`, brokerStaffRoutes);
  app.use(`${prefix}/broker/wallet/top-ups`, brokerTopUpRoutes);
  app.use(`${prefix}/broker/wallet`, brokerWalletRoutes);
  app.use(`${prefix}/broker/carriers`, brokerCarrierRoutes);
  app.use(`${prefix}/broker/trips`, brokerTripRoutes);
  app.use(`${prefix}/broker/holds`, brokerHoldRoutes);
  app.use(`${prefix}/broker/bookings`, brokerBookingRoutes);
  app.use(`${prefix}/broker/bookings`, brokerBookingChangeRoutes);
  app.use(`${prefix}/broker/commissions`, brokerCommissionRoutes);
  app.use(`${prefix}/broker/reports`, brokerReportsRoutes);
  app.use(`${prefix}/broker/dashboard`, brokerDashboardRoutes);
  app.use(`${prefix}/broker/notifications`, brokerNotificationRoutes.feed);
  app.use(`${prefix}/broker/devices`, brokerNotificationRoutes.devices);

  // Phase 6 — customer app principal
  app.use(`${prefix}/customer/auth`, customerAuthRoutes);
  app.use(`${prefix}/customer/me`, customerMeRoutes);
  app.use(`${prefix}/customer/trips`, customerTripRoutes);
  app.use(`${prefix}/customer/holds`, customerHoldRoutes);
  app.use(`${prefix}/customer/recent-searches`, customerRecentSearchRoutes);
  app.use(`${prefix}/customer/bookings`, customerBookingRoutes);
  app.use(`${prefix}/customer/bookings`, customerBookingChangeRoutes);
  app.use(`${prefix}/customer/bookings`, customerLiveRoutes);
  app.use(`${prefix}/customer/tickets`, customerTicketRoutes);
  app.use(`${prefix}/customer/payments`, customerPaymentRoutes);
  app.use(`${prefix}/customer/notifications`, customerNotificationRoutes.feed);
  app.use(`${prefix}/customer/devices`, customerNotificationRoutes.devices);

  // Phase 6 — driver app principal
  app.use(`${prefix}/driver/auth`, driverAuthRoutes);
  app.use(`${prefix}/driver/me`, driverMeRoutes);
  app.use(`${prefix}/driver/dashboard`, driverDashboardRoutes);
  app.use(`${prefix}/driver/trips`, driverTripRoutes);
  app.use(`${prefix}/driver/notifications`, driverNotificationRoutes.feed);
  app.use(`${prefix}/driver/devices`, driverNotificationRoutes.devices);

  // D-CARRIER-PORTAL-01 — transport company portal principal
  app.use(`${prefix}/carrier/auth`, carrierAuthRoutes);
  app.use(`${prefix}/carrier`, carrierPortalRoutes);

  // Stage 2 — admin principal
  app.use(`${prefix}/brokers`, brokersRoutes);
  app.use(`${prefix}/carriers`, carriersRoutes);
  app.use(`${prefix}/catalog`, catalogRoutes);
  app.use(`${prefix}/admin/bookings`, adminBookingRoutes);
  app.use(`${prefix}/admin/wallets`, adminTopUpRoutes);
  app.use(`${prefix}/admin/wallets`, adminWalletRoutes);
  app.use(`${prefix}/admin/commissions`, adminCommissionRoutes);
  app.use(`${prefix}/admin`, adminGeoRoutes);
  app.use(`${prefix}/admin`, adminFleetRoutes);
  app.use(`${prefix}/admin/settings`, adminSettingsRoutes);
  app.use(`${prefix}/admin/tracking`, adminTrackingRoutes);
  app.use(`${prefix}/admin/refunds`, adminRefundRoutes);
  app.use(`${prefix}/admin/carrier-settlements`, adminCarrierSettlementRoutes);
  app.use(`${prefix}/admin`, adminCrudRoutes);
  app.use(prefix, adminOrgDeleteRoutes);
  app.use(`${prefix}/admin/customers`, adminCustomersRoutes);
  app.use(`${prefix}/admin/coupons`, adminCouponsRoutes);
  app.use(`${prefix}/admin/content`, adminContentRoutes);
  app.use(`${prefix}/public/content`, publicContentRoutes);
  app.use(`${prefix}/public`, publicAppRoutes);
  app.use(`${prefix}/admin`, adminInsightsRoutes);
  app.use(`${prefix}/admin`, adminNetworkRoutes);

  try {
    const openapiPath = path.join(process.cwd(), 'docs', 'openapi.yaml');
    const doc = YAML.parse(readFileSync(openapiPath, 'utf8')) as object;
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(doc));
    app.get('/docs.json', (_req, res) => res.json(doc));
  } catch {
    logger.warn('OpenAPI document not loaded');
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
