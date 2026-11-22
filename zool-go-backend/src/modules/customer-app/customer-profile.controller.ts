import type { Request, Response } from 'express';
import { successResponse } from '../../shared/http/success-response';
import { customerProfileService } from './customer-profile.service';

class CustomerProfileController {
  async me(req: Request, res: Response): Promise<Response> {
    const data = await customerProfileService.me(req.customerAuth!.customerId);
    return successResponse(res, { message: 'Profile retrieved', data, requestId: req.requestId });
  }

  async update(req: Request, res: Response): Promise<Response> {
    const data = await customerProfileService.update(req.customerAuth!.customerId, req.body);
    return successResponse(res, { message: 'Profile updated', data, requestId: req.requestId });
  }

  async preferences(req: Request, res: Response): Promise<Response> {
    const data = await customerProfileService.updatePreferences(req.customerAuth!.customerId, req.body);
    return successResponse(res, { message: 'Preferences updated', data, requestId: req.requestId });
  }

  async remove(req: Request, res: Response): Promise<Response> {
    const data = await customerProfileService.deleteAccount(req.customerAuth!.customerId, req.requestId);
    return successResponse(res, { message: 'Account deleted', data, requestId: req.requestId });
  }
}

export const customerProfileController = new CustomerProfileController();
