import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { RateLimitError } from '../../shared/errors/app-error';
import { successResponse } from '../../shared/http/success-response';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { validate } from '../../shared/middleware/validate';
import { publicAppService } from './public-app.service';

const citiesQuerySchema = z.object({ q: z.string().trim().max(60).optional() });

class PublicAppController {
  async appConfig(req: Request, res: Response): Promise<Response> {
    return successResponse(res, { message: 'App config retrieved', data: publicAppService.appConfig(), requestId: req.requestId });
  }

  async cities(req: Request, res: Response): Promise<Response> {
    const data = await publicAppService.cities(req.query.q as string | undefined);
    return successResponse(res, { message: 'Cities retrieved', data, requestId: req.requestId });
  }

  async popular(req: Request, res: Response): Promise<Response> {
    const data = await publicAppService.popularDestinations();
    return successResponse(res, { message: 'Popular destinations retrieved', data, requestId: req.requestId });
  }
}

const controller = new PublicAppController();

/** No-login endpoints for the apps. Mounted at `${API_PREFIX}/public`. */
export const publicAppRoutes = Router();
publicAppRoutes.use(
  rateLimit({
    windowMs: 60_000,
    max: 240,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new RateLimitError({ message: 'Too many requests' })),
  }),
);
publicAppRoutes.get('/app-config', asyncHandler((req, res) => controller.appConfig(req, res)));
publicAppRoutes.get('/cities', validate({ query: citiesQuerySchema }), asyncHandler((req, res) => controller.cities(req, res)));
publicAppRoutes.get('/destinations/popular', asyncHandler((req, res) => controller.popular(req, res)));
