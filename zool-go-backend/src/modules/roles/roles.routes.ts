import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticate } from '../../shared/middleware/authenticate';
import { requirePermission } from '../../shared/middleware/require-permission';
import { validate } from '../../shared/middleware/validate';
import { rolesController } from './roles.controller';
import {
  createRoleSchema,
  roleIdParamsSchema,
  setRolePermissionsSchema,
  updateRoleSchema,
} from './roles.validation';

export const rolesRoutes = Router();

rolesRoutes.use(authenticate);

rolesRoutes.get(
  '/',
  requirePermission('roles.view'),
  asyncHandler((req, res) => rolesController.list(req, res)),
);

rolesRoutes.post(
  '/',
  requirePermission('roles.create'),
  validate({ body: createRoleSchema }),
  asyncHandler((req, res) => rolesController.create(req, res)),
);

rolesRoutes.get(
  '/:roleId',
  requirePermission('roles.view'),
  validate({ params: roleIdParamsSchema }),
  asyncHandler((req, res) => rolesController.get(req, res)),
);

rolesRoutes.patch(
  '/:roleId',
  requirePermission('roles.update'),
  validate({ params: roleIdParamsSchema, body: updateRoleSchema }),
  asyncHandler((req, res) => rolesController.update(req, res)),
);

rolesRoutes.put(
  '/:roleId/permissions',
  requirePermission('permissions.assign'),
  validate({ params: roleIdParamsSchema, body: setRolePermissionsSchema }),
  asyncHandler((req, res) => rolesController.setPermissions(req, res)),
);

rolesRoutes.delete(
  '/:roleId',
  requirePermission('roles.delete'),
  validate({ params: roleIdParamsSchema }),
  asyncHandler((req, res) => rolesController.remove(req, res)),
);
