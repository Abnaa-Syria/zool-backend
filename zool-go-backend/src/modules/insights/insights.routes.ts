import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticate } from '../../shared/middleware/authenticate';
import { requirePermission } from '../../shared/middleware/require-permission';
import { validate } from '../../shared/middleware/validate';
import { insightsController } from './insights.controller';

const bound = z.string().trim().min(10).max(40);
const rangeQuery = z
  .object({
    from: bound.optional(),
    to: bound.optional(),
    officeId: z.string().min(1).max(64).optional(),
    companyId: z.string().min(1).max(64).optional(),
  })
  .strict();

/** Admin overview + reports (REQ-ADM-09/10). Mounted at `${API_PREFIX}/admin`. */
export const adminInsightsRoutes = Router();

adminInsightsRoutes.use(authenticate);

adminInsightsRoutes.get('/overview', requirePermission('bookings.view'), validate({ query: rangeQuery.pick({ from: true, to: true }) }), asyncHandler((req, res) => insightsController.overview(req, res)));
adminInsightsRoutes.get('/reports/summary', requirePermission('reports.view'), validate({ query: rangeQuery }), asyncHandler((req, res) => insightsController.summary(req, res)));
adminInsightsRoutes.get('/reports/by-office', requirePermission('reports.view'), validate({ query: rangeQuery.omit({ officeId: true }) }), asyncHandler((req, res) => insightsController.byOffice(req, res)));
adminInsightsRoutes.get('/reports/by-carrier', requirePermission('reports.view'), validate({ query: rangeQuery.omit({ companyId: true }) }), asyncHandler((req, res) => insightsController.byCarrier(req, res)));
