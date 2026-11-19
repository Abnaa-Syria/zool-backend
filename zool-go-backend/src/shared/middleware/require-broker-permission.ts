import type { NextFunction, Request, Response } from 'express';
import { AuthenticationError, PermissionDeniedError } from '../errors/app-error';
import type { BrokerPermissionKey } from '../constants/broker-permissions';

export interface RequireBrokerPermissionOptions {
  /** Office managers pass even without the explicit flag (e.g. reports). */
  allowManager?: boolean;
}

export function requireBrokerPermission(
  permission: BrokerPermissionKey,
  options: RequireBrokerPermissionOptions = {},
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const auth = req.brokerAuth;
      if (!auth) {
        throw new AuthenticationError({ message: 'Authentication is required' });
      }
      const granted =
        auth.permissions.includes(permission) ||
        (options.allowManager === true && auth.role === 'MANAGER');
      if (!granted) {
        throw new PermissionDeniedError({
          message: 'You do not have permission to perform this action',
          details: { permission },
        });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
