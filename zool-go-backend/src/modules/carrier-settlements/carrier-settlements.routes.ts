import { Router, type Request, type Response } from 'express';
import type { CarrierSettlementStatus } from '@prisma/client';
import { z } from 'zod';
import { successResponse } from '../../shared/http/success-response';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticate } from '../../shared/middleware/authenticate';
import { requirePermission } from '../../shared/middleware/require-permission';
import { validate } from '../../shared/middleware/validate';
import { paginationQuerySchema } from '../../shared/validation/common';
import { carrierSettlementsService } from './carrier-settlements.service';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const idParams = z.object({ id: z.string().min(1).max(64) });
const listQuery = paginationQuerySchema.extend({ companyId: z.string().max(64).optional(), status: z.enum(['DRAFT', 'FINALIZED', 'PAID', 'CANCELLED']).optional() });
const previewQuery = z.object({ companyId: z.string().min(1).max(64), from: ymd, to: ymd });
const createBody = z.object({ companyId: z.string().min(1).max(64), fromDate: ymd, toDate: ymd, notes: z.string().trim().max(1000).optional() }).strict();
const paidBody = z.object({ reference: z.string().trim().min(2).max(191) }).strict();

const ok = (req: Request, res: Response, message: string, data: unknown, statusCode = 200) => successResponse(res, { statusCode, message, data, requestId: req.requestId });

/** D-REV-02 admin carrier settlements. Mounted at `${API_PREFIX}/admin/carrier-settlements`. */
export const adminCarrierSettlementRoutes = Router();
adminCarrierSettlementRoutes.use(authenticate);
adminCarrierSettlementRoutes.get('/', requirePermission('carriers.view'), validate({ query: listQuery }), asyncHandler(async (req, res) => {
  const r = await carrierSettlementsService.list(req.query as { companyId?: string; status?: CarrierSettlementStatus });
  return successResponse(res, { message: 'Settlements', data: r.items, meta: r.meta, requestId: req.requestId });
}));
adminCarrierSettlementRoutes.get('/preview', requirePermission('carriers.view'), validate({ query: previewQuery }), asyncHandler(async (req, res) => {
  const q = req.query as { companyId: string; from: string; to: string };
  return ok(req, res, 'Statement preview', await carrierSettlementsService.preview(q.companyId, q.from, q.to));
}));
adminCarrierSettlementRoutes.post('/', requirePermission('carriers.manage'), validate({ body: createBody }), asyncHandler(async (req, res) =>
  ok(req, res, 'Settlement drafted', await carrierSettlementsService.create({ ...req.body, actorAdminId: req.auth!.adminId, requestId: req.requestId }), 201)));
adminCarrierSettlementRoutes.get('/:id', requirePermission('carriers.view'), validate({ params: idParams }), asyncHandler(async (req, res) =>
  ok(req, res, 'Settlement', await carrierSettlementsService.get(req.params.id!))));
adminCarrierSettlementRoutes.post('/:id/recalculate', requirePermission('carriers.manage'), validate({ params: idParams }), asyncHandler(async (req, res) =>
  ok(req, res, 'Settlement recalculated', await carrierSettlementsService.recalculate(req.params.id!, req.auth!.adminId, req.requestId))));
adminCarrierSettlementRoutes.post('/:id/finalize', requirePermission('carriers.manage'), validate({ params: idParams }), asyncHandler(async (req, res) =>
  ok(req, res, 'Settlement finalized', await carrierSettlementsService.transition(req.params.id!, 'FINALIZED', { actorAdminId: req.auth!.adminId, requestId: req.requestId }))));
adminCarrierSettlementRoutes.post('/:id/mark-paid', requirePermission('carriers.manage'), validate({ params: idParams, body: paidBody }), asyncHandler(async (req, res) =>
  ok(req, res, 'Settlement paid', await carrierSettlementsService.transition(req.params.id!, 'PAID', { actorAdminId: req.auth!.adminId, reference: req.body.reference, requestId: req.requestId }))));
adminCarrierSettlementRoutes.post('/:id/cancel', requirePermission('carriers.manage'), validate({ params: idParams }), asyncHandler(async (req, res) =>
  ok(req, res, 'Settlement cancelled', await carrierSettlementsService.transition(req.params.id!, 'CANCELLED', { actorAdminId: req.auth!.adminId, requestId: req.requestId }))));
