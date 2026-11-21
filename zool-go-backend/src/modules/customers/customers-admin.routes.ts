import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { successResponse } from '../../shared/http/success-response';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticate } from '../../shared/middleware/authenticate';
import { requirePermission } from '../../shared/middleware/require-permission';
import { validate } from '../../shared/middleware/validate';
import { paginationQuerySchema } from '../../shared/validation/common';
import { customersAdminService } from './customers-admin.service';

const listSchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(120).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DELETED']).optional(),
});
const idSchema = z.object({ id: z.string().min(1).max(64) });
const patchSchema = z
  .object({ status: z.enum(['ACTIVE', 'SUSPENDED']).optional(), resetCashNoShows: z.literal(true).optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });

class CustomersAdminController {
  async list(req: Request, res: Response): Promise<Response> {
    const r = await customersAdminService.list(req.query as Parameters<typeof customersAdminService.list>[0]);
    return successResponse(res, { message: 'Customers retrieved', data: r.items, meta: r.meta, requestId: req.requestId });
  }

  async get(req: Request, res: Response): Promise<Response> {
    return successResponse(res, { message: 'Customer retrieved', data: await customersAdminService.get(req.params.id!), requestId: req.requestId });
  }

  async update(req: Request, res: Response): Promise<Response> {
    const data = await customersAdminService.update({ customerId: req.params.id!, ...req.body, actorAdminId: req.auth!.adminId, requestId: req.requestId });
    return successResponse(res, { message: 'Customer updated', data, requestId: req.requestId });
  }
}

const controller = new CustomersAdminController();

/** Admin customer support. Mounted at `${API_PREFIX}/admin/customers`. */
export const adminCustomersRoutes = Router();
adminCustomersRoutes.use(authenticate);
adminCustomersRoutes.get('/', requirePermission('customers.view'), validate({ query: listSchema }), asyncHandler((req, res) => controller.list(req, res)));
adminCustomersRoutes.get('/:id', requirePermission('customers.view'), validate({ params: idSchema }), asyncHandler((req, res) => controller.get(req, res)));
adminCustomersRoutes.patch('/:id', requirePermission('customers.manage'), validate({ params: idSchema, body: patchSchema }), asyncHandler((req, res) => controller.update(req, res)));
