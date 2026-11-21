import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticate } from '../../shared/middleware/authenticate';
import { requirePermission } from '../../shared/middleware/require-permission';
import { validate } from '../../shared/middleware/validate';
import { settingsController } from './settings.controller';

const patchSettingsSchema = z
  .object({ values: z.record(z.string().min(1).max(96), z.union([z.number(), z.boolean(), z.string().max(255)])) })
  .strict();

/** D-SET-02 runtime settings. Mounted at `${API_PREFIX}/admin/settings`. */
export const adminSettingsRoutes = Router();

adminSettingsRoutes.use(authenticate);
adminSettingsRoutes.get('/', requirePermission('settings.view'), asyncHandler((req, res) => settingsController.list(req, res)));
adminSettingsRoutes.patch(
  '/',
  requirePermission('settings.manage'),
  validate({ body: patchSettingsSchema }),
  asyncHandler((req, res) => settingsController.update(req, res)),
);
