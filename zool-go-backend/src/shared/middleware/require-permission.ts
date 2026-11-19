import type { NextFunction, Request, Response } from 'express';
import { AuthenticationError, PermissionDeniedError } from '../errors/app-error';
import type { PermissionKey } from '../constants/permissions';

function ensureAuth(req: Request) {
  if (!req.auth) {
    throw new AuthenticationError({
      message: 'Authentication is required',
    });
  }
  return req.auth;
}

export function requirePermission(permission: PermissionKey) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const auth = ensureAuth(req);
      const permissions = auth.permissions ?? [];
      if (!permissions.includes(permission)) {
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

export function requireAnyPermission(...permissions: PermissionKey[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const auth = ensureAuth(req);
      const granted = auth.permissions ?? [];
      const ok = permissions.some((p) => granted.includes(p));
      if (!ok) {
        throw new PermissionDeniedError({
          message: 'You do not have permission to perform this action',
          details: { anyOf: permissions },
        });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireAllPermissions(...permissions: PermissionKey[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const auth = ensureAuth(req);
      const granted = auth.permissions ?? [];
      const missing = permissions.filter((p) => !granted.includes(p));
      if (missing.length > 0) {
        throw new PermissionDeniedError({
          message: 'You do not have permission to perform this action',
          details: { missing },
        });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
