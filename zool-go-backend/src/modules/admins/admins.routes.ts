import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticate } from '../../shared/middleware/authenticate';
import { requirePermission } from '../../shared/middleware/require-permission';
import { validate } from '../../shared/middleware/validate';
import { adminsController } from './admins.controller';
import {
  adminIdParamsSchema,
  createAdminSchema,
  listAdminsQuerySchema,
  setAdminRolesSchema,
  updateAdminProfileSchema,
  updateAdminStatusSchema,
} from './admins.validation';

export const adminsRoutes = Router();

adminsRoutes.use(authenticate);

adminsRoutes.get(
  '/',
  requirePermission('admins.view'),
  validate({ query: listAdminsQuerySchema }),
  asyncHandler((req, res) => adminsController.list(req, res)),
);

adminsRoutes.post(
  '/',
  requirePermission('admins.create'),
  validate({ body: createAdminSchema }),
  asyncHandler((req, res) => adminsController.create(req, res)),
);

adminsRoutes.get(
  '/:adminId',
  requirePermission('admins.view'),
  validate({ params: adminIdParamsSchema }),
  asyncHandler((req, res) => adminsController.get(req, res)),
);

adminsRoutes.patch(
  '/:adminId/status',
  requirePermission('admins.suspend'),
  validate({ params: adminIdParamsSchema, body: updateAdminStatusSchema }),
  asyncHandler((req, res) => adminsController.updateStatus(req, res)),
);

adminsRoutes.patch(
  '/:adminId',
  requirePermission('admins.update'),
  validate({ params: adminIdParamsSchema, body: updateAdminProfileSchema }),
  asyncHandler((req, res) => adminsController.updateProfile(req, res)),
);

adminsRoutes.post(
  '/:adminId/sessions/revoke-all',
  requirePermission('sessions.revoke'),
  validate({ params: adminIdParamsSchema }),
  asyncHandler((req, res) => adminsController.revokeAllSessions(req, res)),
);

adminsRoutes.put(
  '/:adminId/roles',
  requirePermission('roles.assign'),
  validate({ params: adminIdParamsSchema, body: setAdminRolesSchema }),
  asyncHandler((req, res) => adminsController.setRoles(req, res)),
);
