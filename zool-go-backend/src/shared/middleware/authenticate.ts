import type { NextFunction, Request, Response } from 'express';
import { AdminStatus } from '@prisma/client';
import { getPrisma } from '../../infrastructure/database/prisma';
import { AppError } from '../errors/app-error';
import { requireMatchingAuthzVersion, cachePermissions } from '../security/authz-cache';
import { verifyAccessToken } from '../security/tokens';
import type { PermissionKey } from '../constants/permissions';
import { isPermissionKey } from '../constants/permissions';
import { asyncHandler } from './async-handler';

async function loadEffectiveAuthz(adminId: string): Promise<{
  permissions: PermissionKey[];
  roles: Array<{ id: string; key: string; name: string }>;
}> {
  const admin = await getPrisma().adminUser.findUnique({
    where: { id: adminId },
    include: {
      userRoles: {
        where: { isActive: true },
        include: {
          role: {
            include: {
              rolePermissions: {
                include: { permission: true },
              },
            },
          },
        },
      },
    },
  });

  if (!admin) {
    throw AppError.unauthorized('Admin not found');
  }

  if (admin.status !== AdminStatus.ACTIVE) {
    throw AppError.unauthorized('Admin account is suspended');
  }

  const roles = admin.userRoles
    .filter((ur) => ur.role.isActive)
    .map((ur) => ({ id: ur.role.id, key: ur.role.key, name: ur.role.name }));

  const permissionSet = new Set<PermissionKey>();
  for (const ur of admin.userRoles) {
    if (!ur.role.isActive) continue;
    for (const rp of ur.role.rolePermissions) {
      if (isPermissionKey(rp.permission.key)) {
        permissionSet.add(rp.permission.key);
      }
    }
  }

  return {
    permissions: [...permissionSet],
    roles,
  };
}

export const authenticate = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    throw AppError.unauthorized('Missing bearer token');
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    throw AppError.unauthorized('Missing bearer token');
  }

  const payload = verifyAccessToken(token);
  await requireMatchingAuthzVersion(payload.sub, payload.av);

  const authz = await loadEffectiveAuthz(payload.sub);
  await cachePermissions(payload.sub, authz.permissions);

  req.auth = {
    adminId: payload.sub,
    authzVersion: payload.av,
    sessionId: payload.sid,
    permissions: authz.permissions,
    roles: authz.roles,
  };

  next();
});
