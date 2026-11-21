import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { RateLimitError } from '../../shared/errors/app-error';
import { z } from 'zod';
import { successResponse } from '../../shared/http/success-response';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticate } from '../../shared/middleware/authenticate';
import { requirePermission } from '../../shared/middleware/require-permission';
import { validate } from '../../shared/middleware/validate';
import { contentService } from './content.service';

const slugSchema = z.object({ slug: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/) });
const sectionSchema = z
  .object({
    titleAr: z.string().trim().min(1).max(200),
    titleEn: z.string().trim().min(1).max(200),
    bodyAr: z.string().trim().min(1).max(20_000),
    bodyEn: z.string().trim().min(1).max(20_000),
  })
  .strict();
const upsertSchema = z
  .object({
    titleAr: z.string().trim().min(2).max(160),
    titleEn: z.string().trim().min(2).max(160),
    sections: z.array(sectionSchema).min(1).max(50),
  })
  .strict();

class ContentController {
  async list(req: Request, res: Response): Promise<Response> {
    return successResponse(res, { message: 'Content pages retrieved', data: await contentService.list(), requestId: req.requestId });
  }

  async get(req: Request, res: Response): Promise<Response> {
    return successResponse(res, { message: 'Content page retrieved', data: await contentService.get(req.params.slug!), requestId: req.requestId });
  }

  async upsert(req: Request, res: Response): Promise<Response> {
    const data = await contentService.upsert({ slug: req.params.slug!, ...req.body, actorAdminId: req.auth!.adminId, requestId: req.requestId });
    return successResponse(res, { message: 'Content page published', data, requestId: req.requestId });
  }
}

const controller = new ContentController();

/** Admin content pages. Mounted at `${API_PREFIX}/admin/content`. */
export const adminContentRoutes = Router();
adminContentRoutes.use(authenticate);
adminContentRoutes.get('/', requirePermission('content.manage'), asyncHandler((req, res) => controller.list(req, res)));
adminContentRoutes.put('/:slug', requirePermission('content.manage'), validate({ params: slugSchema, body: upsertSchema }), asyncHandler((req, res) => controller.upsert(req, res)));

/** Public (no login) content for the apps. Mounted at `${API_PREFIX}/public/content`. */
export const publicContentRoutes = Router();
publicContentRoutes.use(
  rateLimit({
    windowMs: 60_000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new RateLimitError({ message: 'Too many requests' })),
  }),
);
publicContentRoutes.get('/:slug', validate({ params: slugSchema }), asyncHandler((req, res) => controller.get(req, res)));
