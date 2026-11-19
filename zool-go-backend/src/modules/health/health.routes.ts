import { Router } from 'express';
import { env } from '../../config/env';
import { prismaHealthCheck } from '../../infrastructure/database/prisma';
import { redisHealthCheck } from '../../infrastructure/redis/redis';
import { successResponse } from '../../shared/http/success-response';
import { asyncHandler } from '../../shared/middleware/async-handler';

export const healthRoutes = Router();

healthRoutes.get(
  '/health',
  asyncHandler(async (req, res) => {
    return successResponse(res, {
      statusCode: 200,
      message: 'Service is healthy',
      data: {
        status: 'ok',
        service: env().APP_NAME,
        timestamp: new Date().toISOString(),
      },
      requestId: req.requestId,
    });
  }),
);

healthRoutes.get(
  '/ready',
  asyncHandler(async (req, res) => {
    const [dbOk, redisOk] = await Promise.all([prismaHealthCheck(), redisHealthCheck()]);
    const ready = dbOk && redisOk;
    return successResponse(res, {
      statusCode: ready ? 200 : 503,
      message: ready ? 'Service is ready' : 'Service is not ready',
      data: {
        status: ready ? 'ready' : 'not_ready',
        checks: {
          mysql: dbOk ? 'up' : 'down',
          redis: redisOk ? 'up' : 'down',
        },
        timestamp: new Date().toISOString(),
      },
      requestId: req.requestId,
    });
  }),
);
