import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { successResponse } from '../../shared/http/success-response';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticate } from '../../shared/middleware/authenticate';
import { requirePermission } from '../../shared/middleware/require-permission';
import { validate } from '../../shared/middleware/validate';
import { paginationQuerySchema } from '../../shared/validation/common';
import { couponsService } from './coupons.service';

const listSchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(32).optional(),
  isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});
const idSchema = z.object({ id: z.string().min(1).max(64) });
const createSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,32}$/),
    discountType: z.enum(['PERCENT', 'FIXED']),
    /** PERCENT: basis points (2500 = 25%); FIXED: minor units */
    value: z.number().int().positive().max(1_000_000_000),
    maxDiscountAmountMinor: z.number().int().positive().optional(),
    minSubtotalAmountMinor: z.number().int().positive().optional(),
    companyId: z.string().min(1).max(64).optional(),
    validFrom: z.coerce.date(),
    validTo: z.coerce.date(),
    maxRedemptions: z.number().int().positive().optional(),
    perCustomerLimit: z.number().int().min(1).max(100).optional(),
  })
  .strict();
const patchSchema = z
  .object({
    isActive: z.boolean().optional(),
    validTo: z.coerce.date().optional(),
    maxRedemptions: z.number().int().positive().nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });

class CouponsController {
  async list(req: Request, res: Response): Promise<Response> {
    const r = await couponsService.list(req.query as Parameters<typeof couponsService.list>[0]);
    return successResponse(res, { message: 'Coupons retrieved', data: r.items, meta: r.meta, requestId: req.requestId });
  }

  async create(req: Request, res: Response): Promise<Response> {
    const data = await couponsService.create({ ...req.body, actorAdminId: req.auth!.adminId, requestId: req.requestId });
    return successResponse(res, { statusCode: 201, message: 'Coupon created', data, requestId: req.requestId });
  }

  async update(req: Request, res: Response): Promise<Response> {
    const data = await couponsService.update({ couponId: req.params.id!, patch: req.body, actorAdminId: req.auth!.adminId, requestId: req.requestId });
    return successResponse(res, { message: 'Coupon updated', data, requestId: req.requestId });
  }
}

const controller = new CouponsController();

/** Admin coupons. Mounted at `${API_PREFIX}/admin/coupons`. */
export const adminCouponsRoutes = Router();
adminCouponsRoutes.use(authenticate);
adminCouponsRoutes.get('/', requirePermission('coupons.view'), validate({ query: listSchema }), asyncHandler((req, res) => controller.list(req, res)));
adminCouponsRoutes.post('/', requirePermission('coupons.manage'), validate({ body: createSchema }), asyncHandler((req, res) => controller.create(req, res)));
adminCouponsRoutes.patch('/:id', requirePermission('coupons.manage'), validate({ params: idSchema, body: patchSchema }), asyncHandler((req, res) => controller.update(req, res)));
