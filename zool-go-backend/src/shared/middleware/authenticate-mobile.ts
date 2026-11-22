import type { NextFunction, Request, Response } from 'express';
import { CarrierEmployeeStatus, CustomerStatus, DriverStatus } from '@prisma/client';
import { carrierPermissions, type CarrierPermission } from '../constants/carrier-permissions';
import { getPrisma } from '../../infrastructure/database/prisma';
import { AppError } from '../errors/app-error';
import { verifyMobileAccessToken } from '../security/mobile-tokens';
import { requireMatchingPrincipalAuthzVersion } from '../security/principal-authz-cache';
import { asyncHandler } from './async-handler';

function bearer(req: Request): string {
  const header = req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw AppError.unauthorized('Missing bearer token');
  return token;
}

/** Customer app principal. Sets `req.customerAuth`. */
export const authenticateCustomer = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const payload = verifyMobileAccessToken('customer', bearer(req));
  await requireMatchingPrincipalAuthzVersion('customer', payload.sub, payload.av);
  const customer = await getPrisma().customer.findUnique({
    where: { id: payload.sub },
    select: { id: true, status: true },
  });
  if (!customer || customer.status !== CustomerStatus.ACTIVE) {
    throw AppError.unauthorized('Customer account is not active');
  }
  req.customerAuth = { customerId: customer.id, sessionId: payload.sid, authzVersion: payload.av };
  next();
});

/**
 * Driver app principal. Sets `req.driverAuth`. A suspended carrier does not lock its drivers out
 * (D-SUS-01 §4: trips already running continue); a suspended driver is locked out.
 */
export const authenticateDriver = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const payload = verifyMobileAccessToken('driver', bearer(req));
  await requireMatchingPrincipalAuthzVersion('driver', payload.sub, payload.av);
  const driver = await getPrisma().driver.findUnique({
    where: { id: payload.sub },
    select: { id: true, status: true, companyId: true },
  });
  if (!driver || driver.status !== DriverStatus.ACTIVE) {
    throw AppError.unauthorized('Driver account is not active');
  }
  req.driverAuth = { driverId: driver.id, companyId: driver.companyId, sessionId: payload.sid, authzVersion: payload.av };
  next();
});

/** Carrier portal staff (D-CARRIER-PORTAL-01). Sets `req.carrierAuth` scoped to one company. */
export const authenticateCarrier = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const payload = verifyMobileAccessToken('carrier', bearer(req));
  await requireMatchingPrincipalAuthzVersion('carrier', payload.sub, payload.av);
  const e = await getPrisma().carrierEmployee.findUnique({ where: { id: payload.sub } });
  if (!e || e.status !== CarrierEmployeeStatus.ACTIVE) throw AppError.unauthorized('Carrier account is not active');
  req.carrierAuth = {
    employeeId: e.id,
    companyId: e.companyId,
    role: e.role,
    permissions: carrierPermissions(e),
    sessionId: payload.sid,
    authzVersion: payload.av,
  };
  next();
});

export function requireCarrierPermission(permission: CarrierPermission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.carrierAuth?.permissions.includes(permission)) {
      next(AppError.forbidden('Missing carrier permission', { permission }));
      return;
    }
    next();
  };
}
