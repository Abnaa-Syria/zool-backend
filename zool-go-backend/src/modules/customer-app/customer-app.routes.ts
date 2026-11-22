import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticateCustomer } from '../../shared/middleware/authenticate-mobile';
import { validate } from '../../shared/middleware/validate';
import { createMobileAuthRoutes, customerAuthStore, MobileAuthController, MobileAuthEngine } from '../mobile-auth';
import { customerProfileController } from './customer-profile.controller';
import { customerProfileService } from './customer-profile.service';
import { updateCustomerMeSchema, updateCustomerPreferencesSchema } from './customer-profile.validation';

/** Mounted at `${API_PREFIX}/customer/auth`. Verify creates the account on first login. */
export const customerAuthRoutes = createMobileAuthRoutes(
  new MobileAuthController(
    new MobileAuthEngine(customerAuthStore),
    { key: 'customer', load: (id) => customerProfileService.summary(id) },
    'isNewCustomer',
  ),
);

/** Mounted at `${API_PREFIX}/customer/me`. */
export const customerMeRoutes = Router();
customerMeRoutes.use(authenticateCustomer);
customerMeRoutes.get('/', asyncHandler((req, res) => customerProfileController.me(req, res)));
customerMeRoutes.patch('/', validate({ body: updateCustomerMeSchema }), asyncHandler((req, res) => customerProfileController.update(req, res)));
customerMeRoutes.patch(
  '/preferences',
  validate({ body: updateCustomerPreferencesSchema }),
  asyncHandler((req, res) => customerProfileController.preferences(req, res)),
);
customerMeRoutes.delete('/', asyncHandler((req, res) => customerProfileController.remove(req, res)));
