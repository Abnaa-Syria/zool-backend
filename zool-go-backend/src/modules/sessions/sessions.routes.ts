import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticate } from '../../shared/middleware/authenticate';
import { requirePermission } from '../../shared/middleware/require-permission';
import { validate } from '../../shared/middleware/validate';
import { sessionsController } from './sessions.controller';

export const sessionsRoutes = Router();

sessionsRoutes.use(authenticate);

sessionsRoutes.get(
  '/',
  requirePermission('sessions.view'),
  validate({
    query: z.object({
      page: z.coerce.number().int().positive().optional(),
      pageSize: z.coerce.number().int().positive().max(100).optional(),
      adminId: z.string().min(1).optional(),
    }),
  }),
  asyncHandler((req, res) => sessionsController.list(req, res)),
);

sessionsRoutes.delete(
  '/:sessionId',
  requirePermission('sessions.revoke'),
  validate({ params: z.object({ sessionId: z.string().min(1) }) }),
  asyncHandler((req, res) => sessionsController.revoke(req, res)),
);
