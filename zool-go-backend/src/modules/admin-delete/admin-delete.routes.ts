import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../shared/errors/app-error';
import { successResponse } from '../../shared/http/success-response';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticate } from '../../shared/middleware/authenticate';
import { requirePermission } from '../../shared/middleware/require-permission';
import { validate } from '../../shared/middleware/validate';
import type { PermissionKey } from '../../shared/constants/permissions';
import { contentService } from '../content/content.service';
import { couponsRepository } from '../coupons/coupons.repository';
import { toCouponDto } from '../coupons/coupons.service';
import { geoRepository } from '../geo/geo.repository';
import { toAmenityDto, toCityDto, toStationDto } from '../geo/geo.service';
import { adminDeleteService, type DeletableEntity } from './admin-delete.service';

const id = z.object({ id: z.string().min(1).max(64) });
const slug = z.object({ slug: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/) });
const officeStaff = z.object({ officeId: z.string().min(1).max(64), employeeId: z.string().min(1).max(64) });
const companyStaff = z.object({ companyId: z.string().min(1).max(64), employeeId: z.string().min(1).max(64) });
const company = z.object({ companyId: z.string().min(1).max(64) });
const office = z.object({ officeId: z.string().min(1).max(64) });

const actor = (req: Request) => ({ actorAdminId: req.auth!.adminId, ...(req.requestId ? { requestId: req.requestId } : {}) });
const done = (req: Request, res: Response, data: unknown) => successResponse(res, { message: 'Deleted', data, requestId: req.requestId });
const del = (entity: DeletableEntity, param: string) =>
  asyncHandler(async (req: Request, res: Response) => done(req, res, await adminDeleteService.delete(entity, req.params[param]!, actor(req))));

/**
 * Admin detail reads and deletes that complete CRUD for the master data. Mounted twice:
 * at `${API_PREFIX}/admin` (adminCrudRoutes) and at `${API_PREFIX}` (carrier/broker paths).
 */
export const adminCrudRoutes = Router();
adminCrudRoutes.use(authenticate);

const route = (perm: PermissionKey) => requirePermission(perm);

// Reads that were missing
adminCrudRoutes.get('/cities/:id', route('geo.view'), validate({ params: id }), asyncHandler(async (req, res) => {
  const c = await geoRepository.findCityById(req.params.id!);
  if (!c) throw AppError.notFound('City not found');
  return successResponse(res, { message: 'City', data: toCityDto(c), requestId: req.requestId });
}));
adminCrudRoutes.get('/stations/:id', route('geo.view'), validate({ params: id }), asyncHandler(async (req, res) => {
  const s = await geoRepository.findStationById(req.params.id!);
  if (!s) throw AppError.notFound('Station not found');
  return successResponse(res, { message: 'Station', data: toStationDto(s), requestId: req.requestId });
}));
adminCrudRoutes.get('/amenities/:id', route('geo.view'), validate({ params: id }), asyncHandler(async (req, res) => {
  const a = await geoRepository.findAmenityById(req.params.id!);
  if (!a) throw AppError.notFound('Amenity not found');
  return successResponse(res, { message: 'Amenity', data: toAmenityDto(a), requestId: req.requestId });
}));
adminCrudRoutes.get('/coupons/:id', route('coupons.view'), validate({ params: id }), asyncHandler(async (req, res) => {
  const c = await couponsRepository.findById(req.params.id!);
  if (!c) throw AppError.notFound('Coupon not found');
  return successResponse(res, { message: 'Coupon', data: toCouponDto(c), requestId: req.requestId });
}));
adminCrudRoutes.get('/content/:slug', route('content.manage'), validate({ params: slug }), asyncHandler(async (req, res) =>
  successResponse(res, { message: 'Content page', data: await contentService.get(req.params.slug!), requestId: req.requestId })));

// Deletes (409 ENTITY_IN_USE when something depends on the record)
adminCrudRoutes.delete('/cities/:id', route('geo.manage'), validate({ params: id }), del('city', 'id'));
adminCrudRoutes.delete('/stations/:id', route('geo.manage'), validate({ params: id }), del('station', 'id'));
adminCrudRoutes.delete('/amenities/:id', route('geo.manage'), validate({ params: id }), del('amenity', 'id'));
adminCrudRoutes.delete('/vehicles/:id', route('fleet.manage'), validate({ params: id }), del('vehicle', 'id'));
adminCrudRoutes.delete('/drivers/:id', route('fleet.manage'), validate({ params: id }), del('driver', 'id'));
adminCrudRoutes.delete('/routes/:id', route('catalog.manage'), validate({ params: id }), del('route', 'id'));
adminCrudRoutes.delete('/coupons/:id', route('coupons.manage'), validate({ params: id }), del('coupon', 'id'));
adminCrudRoutes.delete('/content/:slug', route('content.manage'), validate({ params: slug }), del('content', 'slug'));
adminCrudRoutes.delete('/customers/:id', route('customers.manage'), validate({ params: id }), asyncHandler(async (req, res) =>
  done(req, res, await adminDeleteService.deleteCustomer(req.params.id!, actor(req)))));

/** Mounted at `${API_PREFIX}` — carrier and broker office deletes (+ their staff). */
export const adminOrgDeleteRoutes = Router();
adminOrgDeleteRoutes.delete('/carriers/:companyId', authenticate, route('carriers.manage'), validate({ params: company }), del('carrier', 'companyId'));
adminOrgDeleteRoutes.delete('/brokers/:officeId', authenticate, route('brokers.manage'), validate({ params: office }), del('brokerOffice', 'officeId'));
adminOrgDeleteRoutes.delete('/brokers/:officeId/staff/:employeeId', authenticate, route('brokers.manage'), validate({ params: officeStaff }), asyncHandler(async (req, res) =>
  done(req, res, await adminDeleteService.delete('brokerEmployee', req.params.employeeId!, actor(req), { parent: 'office', parentId: req.params.officeId! }))));
adminOrgDeleteRoutes.delete('/carriers/:companyId/staff/:employeeId', authenticate, route('carriers.manage'), validate({ params: companyStaff }), asyncHandler(async (req, res) =>
  done(req, res, await adminDeleteService.delete('carrierEmployee', req.params.employeeId!, actor(req), { parent: 'company', parentId: req.params.companyId! }))));
