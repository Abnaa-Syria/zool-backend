import { RefundStatus, type Prisma } from '@prisma/client';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getPrisma } from '../../infrastructure/database/prisma';
import { AppError } from '../../shared/errors/app-error';
import { successResponse } from '../../shared/http/success-response';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticate } from '../../shared/middleware/authenticate';
import { requirePermission } from '../../shared/middleware/require-permission';
import { validate } from '../../shared/middleware/validate';
import { paginationMeta, parsePagination } from '../../shared/utils/pagination';
import { paginationQuerySchema } from '../../shared/validation/common';
import { auditService } from '../audit/audit.service';
import { customerRefundsService } from '../customer-app/customer-cancellation.service';

const listQuery = paginationQuerySchema.extend({
  status: z.enum(['PENDING', 'SUCCEEDED', 'FAILED']).optional(),
  reason: z.enum(['CUSTOMER_CANCEL', 'CARRIER_CANCEL', 'CHANGE_DIFFERENCE', 'ADMIN']).optional(),
  q: z.string().trim().min(1).max(64).optional(),
});
const idParams = z.object({ id: z.string().min(1).max(64) });
const markBody = z.object({ reference: z.string().trim().min(2).max(191), note: z.string().trim().max(500).optional() }).strict();

const include = {
  booking: {
    select: {
      id: true,
      bookingRef: true,
      status: true,
      paymentMethod: true,
      totalAmount: true,
      customer: { select: { id: true, displayName: true, identities: { where: { type: 'PHONE' }, select: { valueNormalized: true }, take: 1 } } },
      trip: { select: { id: true, tripNumber: true, origin: true, destination: true, departureAt: true, company: { select: { id: true, name: true } } } },
    },
  },
  paymentIntent: { select: { id: true, provider: true, providerRef: true, amount: true } },
} satisfies Prisma.RefundInclude;

type Row = Prisma.RefundGetPayload<{ include: typeof include }>;

function toDto(r: Row) {
  return {
    id: r.id,
    amountMinor: r.amount,
    status: r.status,
    reason: r.reason,
    providerRef: r.providerRef,
    createdAt: r.createdAt.toISOString(),
    processedAt: r.processedAt?.toISOString() ?? null,
    booking: {
      id: r.booking.id,
      bookingRef: r.booking.bookingRef,
      status: r.booking.status,
      paymentMethod: r.booking.paymentMethod,
      totalAmountMinor: r.booking.totalAmount,
      trip: { ...r.booking.trip, departureAt: r.booking.trip.departureAt.toISOString() },
    },
    customer: r.booking.customer
      ? { id: r.booking.customer.id, displayName: r.booking.customer.displayName, phone: r.booking.customer.identities[0]?.valueNormalized ?? null }
      : null,
    payment: r.paymentIntent,
  };
}

/** Admin refunds queue (direct-customer refunds to the original payment method, D-REF-02). */
class RefundsController {
  async list(req: Request, res: Response): Promise<Response> {
    const q = req.query as { page?: number; pageSize?: number; status?: RefundStatus; reason?: Prisma.EnumRefundReasonFilter['equals']; q?: string };
    const { page, pageSize, skip, take } = parsePagination(q);
    const where: Prisma.RefundWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.reason ? { reason: q.reason } : {}),
      ...(q.q ? { OR: [{ booking: { bookingRef: { contains: q.q } } }, { providerRef: { contains: q.q } }, { id: q.q }] } : {}),
    };
    const [rows, total, pending] = await Promise.all([
      getPrisma().refund.findMany({ where, include, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take }),
      getPrisma().refund.count({ where }),
      getPrisma().refund.aggregate({ where: { status: RefundStatus.PENDING }, _sum: { amount: true }, _count: { _all: true } }),
    ]);
    return successResponse(res, {
      message: 'Refunds retrieved',
      data: rows.map(toDto),
      meta: { ...paginationMeta(page, pageSize, total), pendingCount: pending._count._all, pendingAmountMinor: pending._sum.amount ?? 0 },
      requestId: req.requestId,
    });
  }

  async get(req: Request, res: Response): Promise<Response> {
    const r = await getPrisma().refund.findUnique({ where: { id: req.params.id! }, include });
    if (!r) throw AppError.notFound('Refund not found');
    return successResponse(res, { message: 'Refund retrieved', data: toDto(r), requestId: req.requestId });
  }

  /** Re-sends a pending refund to the payment provider. */
  async retry(req: Request, res: Response): Promise<Response> {
    const r = await getPrisma().refund.findUnique({ where: { id: req.params.id! } });
    if (!r) throw AppError.notFound('Refund not found');
    if (r.status === RefundStatus.SUCCEEDED) throw AppError.conflict('Refund already completed');
    await customerRefundsService.process(r.id);
    await auditService.record({ actorAdminId: req.auth!.adminId, action: 'refund.retried', resourceType: 'refund', resourceId: r.id, requestId: req.requestId });
    return this.get(req, res);
  }

  /** Records a refund paid outside the provider (e.g. bank transfer) with its reference. */
  async markPaid(req: Request, res: Response): Promise<Response> {
    const updated = await getPrisma().refund.updateMany({
      where: { id: req.params.id!, status: { not: RefundStatus.SUCCEEDED } },
      data: { status: RefundStatus.SUCCEEDED, processedAt: new Date(), providerRef: `manual:${req.body.reference as string}`.slice(0, 191) },
    });
    if (updated.count === 0) throw AppError.conflict('Refund not found or already completed');
    await auditService.record({
      actorAdminId: req.auth!.adminId,
      action: 'refund.marked_paid',
      resourceType: 'refund',
      resourceId: req.params.id!,
      requestId: req.requestId,
      metadata: { reference: req.body.reference, note: req.body.note ?? null },
    });
    return this.get(req, res);
  }
}

const c = new RefundsController();

/** Mounted at `${API_PREFIX}/admin/refunds`. */
export const adminRefundRoutes = Router();
adminRefundRoutes.use(authenticate);
adminRefundRoutes.get('/', requirePermission('bookings.view'), validate({ query: listQuery }), asyncHandler((req, res) => c.list(req, res)));
adminRefundRoutes.get('/:id', requirePermission('bookings.view'), validate({ params: idParams }), asyncHandler((req, res) => c.get(req, res)));
adminRefundRoutes.post('/:id/retry', requirePermission('bookings.cancel'), validate({ params: idParams }), asyncHandler((req, res) => c.retry(req, res)));
adminRefundRoutes.post('/:id/mark-paid', requirePermission('bookings.cancel'), validate({ params: idParams, body: markBody }), asyncHandler((req, res) => c.markPaid(req, res)));
