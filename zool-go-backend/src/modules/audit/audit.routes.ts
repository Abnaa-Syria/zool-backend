import { Router } from 'express';
import { authenticate } from '../../shared/middleware/authenticate';
import { requirePermission } from '../../shared/middleware/require-permission';
import { validate } from '../../shared/middleware/validate';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { auditController } from './audit.controller';
import { listAuditQuerySchema } from './audit.validation';

export const auditRoutes = Router();

auditRoutes.get(
  '/',
  authenticate,
  requirePermission('audit.view'),
  validate({ query: listAuditQuerySchema }),
  asyncHandler((req, res) => auditController.list(req, res)),
);
