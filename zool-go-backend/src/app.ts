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
import { brokerReportsRoutes } from './modules/reports';
import { adminGeoRoutes } from './modules/geo';
import { adminFleetRoutes } from './modules/fleet';
import { adminNetworkRoutes } from './modules/network';

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
  app.use(`${prefix}/broker/commissions`, brokerCommissionRoutes);
  app.use(`${prefix}/broker/reports`, brokerReportsRoutes);

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
