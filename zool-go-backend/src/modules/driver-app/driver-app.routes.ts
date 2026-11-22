import { Router, type Request, type Response } from 'express';
import { successResponse } from '../../shared/http/success-response';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticateDriver } from '../../shared/middleware/authenticate-mobile';
import { createMobileAuthRoutes, driverAuthStore, MobileAuthController, MobileAuthEngine } from '../mobile-auth';
import { driverProfileService } from './driver-profile.service';

/** Mounted at `${API_PREFIX}/driver/auth`. Only drivers created by an admin can log in. */
export const driverAuthRoutes = createMobileAuthRoutes(
  new MobileAuthController(new MobileAuthEngine(driverAuthStore), {
    key: 'driver',
    load: (id) => driverProfileService.me(id),
  }),
);

class DriverProfileController {
  async me(req: Request, res: Response): Promise<Response> {
    const data = await driverProfileService.me(req.driverAuth!.driverId);
    return successResponse(res, { message: 'Profile retrieved', data, requestId: req.requestId });
  }
}
const profileController = new DriverProfileController();

/** Mounted at `${API_PREFIX}/driver/me`. */
export const driverMeRoutes = Router();
driverMeRoutes.use(authenticateDriver);
driverMeRoutes.get('/', asyncHandler((req, res) => profileController.me(req, res)));
