import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticate } from '../../shared/middleware/authenticate';
import { requirePermission } from '../../shared/middleware/require-permission';
import { permissionsController } from './permissions.controller';

export const permissionsRoutes = Router();

permissionsRoutes.get(
  '/',
  authenticate,
  requirePermission('permissions.view'),
  asyncHandler((req, res) => permissionsController.list(req, res)),
);
