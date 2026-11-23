import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { BookingStatus, TripStatus } from '@prisma/client';
import { env } from '../../config/env';
import { getPrisma } from '../../infrastructure/database/prisma';
import { AppError } from '../../shared/errors/app-error';
import { successResponse } from '../../shared/http/success-response';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticateCarrier, requireCarrierPermission } from '../../shared/middleware/authenticate-mobile';
import { validate } from '../../shared/middleware/validate';
import { paginationQuerySchema } from '../../shared/validation/common';
import { zonedDayRange } from '../../shared/utils/timezone';
import { bookingsService } from '../bookings/bookings.service';
import { catalogService } from '../catalog/catalog.service';
import { carrierSettlementsService } from '../carrier-settlements/carrier-settlements.service';
import { driverTripsService } from '../driver-app/driver-trips.service';
import { fleetService } from '../fleet/fleet.service';
import { createDriverSchema, createVehicleSchema, listDriversQuerySchema, listVehiclesQuerySchema, patchDriverSchema, patchVehicleSchema } from '../fleet/fleet.validation';
import { carrierAuthStore, createMobileAuthRoutes, MobileAuthController, MobileAuthEngine } from '../mobile-auth';
import { networkService } from '../network/network.service';
import { cancelTripSchema, createRouteSchema, listRoutesQuerySchema, patchAssignmentSchema, patchRouteSchema, scheduleTripsSchema } from '../network/network.validation';
import { trackingService } from '../tracking/tracking.service';
import { carrierActor, carrierPortalService, type CarrierScope } from './carrier-portal.service';

const idParams = z.object({ id: z.string().min(1).max(64) });
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** Sudan days, inclusive, at most 92 days (a quarter). */
const rangeQuery = z
  .object({ from: ymd, to: ymd })
  .refine((v) => v.from <= v.to, { message: 'from must be on or before to', path: ['from'] })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 <= 92, { message: 'At most 92 days', path: ['to'] });
const staffFlags = z
  .object({ canManageFleet: z.boolean().optional(), canManageSchedule: z.boolean().optional(), canViewFinance: z.boolean().optional(), canManageStaff: z.boolean().optional() })
  .strict();
const createStaffSchema = z
  .object({ displayName: z.string().trim().min(2).max(160), phone: z.string().trim().min(6).max(32), role: z.enum(['MANAGER', 'STAFF']).optional(), flags: staffFlags.optional() })
  .strict();
const patchStaffSchema = z
  .object({ displayName: z.string().trim().min(2).max(160).optional(), role: z.enum(['MANAGER', 'STAFF']).optional(), status: z.enum(['ACTIVE', 'SUSPENDED']).optional(), flags: staffFlags.optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
const tripsQuery = paginationQuerySchema.extend({
  date: ymd.optional(),
  dateFrom: ymd.optional(),
  dateTo: ymd.optional(),
  status: z.enum(['SCHEDULED', 'BOARDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
  routeId: z.string().max(64).optional(),
  vehicleId: z.string().max(64).optional(),
  driverId: z.string().max(64).optional(),
  q: z.string().trim().max(64).optional(),
});
const priceSchema = z.object({ basePriceMinor: z.number().int().positive().max(1_000_000_000) }).strict();
const bookingsQuery = paginationQuerySchema.extend({
  status: z.enum(['CONFIRMED', 'CANCELLED', 'PENDING_PAYMENT', 'CHANGED', 'EXPIRED']).optional(),
  officeId: z.string().max(64).optional(),
  from: z.string().max(32).optional(),
  to: z.string().max(32).optional(),
  q: z.string().trim().max(64).optional(),
});
const settlementsQuery = paginationQuerySchema.extend({ status: z.enum(['FINALIZED', 'PAID', 'CANCELLED']).optional() });

const scope = (req: Request): CarrierScope => ({ companyId: req.carrierAuth!.companyId, employeeId: req.carrierAuth!.employeeId, ...(req.requestId ? { requestId: req.requestId } : {}) });
const ok = (req: Request, res: Response, message: string, data: unknown, statusCode = 200, meta?: unknown) =>
  successResponse(res, { statusCode, message, data, ...(meta ? { meta: meta as Record<string, unknown> } : {}), requestId: req.requestId });

class CarrierPortalController {
  // ---- profile / home
  async me(req: Request, res: Response) {
    return ok(req, res, 'Profile', await carrierPortalService.me(req.carrierAuth!.employeeId));
  }
  async dashboard(req: Request, res: Response) {
    return ok(req, res, 'Dashboard', await carrierPortalService.dashboard(scope(req).companyId));
  }
  async brokers(req: Request, res: Response) {
    return ok(req, res, 'Broker offices', await carrierPortalService.brokers(scope(req).companyId));
  }

  // ---- staff
  async listStaff(req: Request, res: Response) {
    return ok(req, res, 'Staff', await carrierPortalService.listStaff(scope(req).companyId));
  }
  async createStaff(req: Request, res: Response) {
    const s = scope(req);
    return ok(req, res, 'Employee created', await carrierPortalService.createStaff({ companyId: s.companyId, ...req.body, actor: carrierActor(s) }), 201);
  }
  async updateStaff(req: Request, res: Response) {
    const s = scope(req);
    const data = await carrierPortalService.updateStaff({ companyId: s.companyId, employeeId: req.params.id!, patch: req.body, selfId: s.employeeId, actor: carrierActor(s) });
    return ok(req, res, 'Employee updated', data);
  }

  // ---- fleet
  async listVehicles(req: Request, res: Response) {
    const r = await fleetService.listVehicles({ ...(req.query as object), companyId: scope(req).companyId });
    return ok(req, res, 'Vehicles', r.items, 200, r.meta);
  }
  async getVehicle(req: Request, res: Response) {
    await carrierPortalService.assertOwned('vehicle', req.params.id!, scope(req).companyId);
    return ok(req, res, 'Vehicle', await fleetService.getVehicle(req.params.id!));
  }
  async createVehicle(req: Request, res: Response) {
    const s = scope(req);
    return ok(req, res, 'Vehicle created', await fleetService.createVehicle({ ...req.body, companyId: s.companyId, ...carrierActor(s) }), 201);
  }
  async updateVehicle(req: Request, res: Response) {
    const s = scope(req);
    await carrierPortalService.assertOwned('vehicle', req.params.id!, s.companyId);
    return ok(req, res, 'Vehicle updated', await fleetService.updateVehicle({ vehicleId: req.params.id!, patch: req.body, ...carrierActor(s) }));
  }
  async listDrivers(req: Request, res: Response) {
    const r = await fleetService.listDrivers({ ...(req.query as object), companyId: scope(req).companyId });
    return ok(req, res, 'Drivers', r.items, 200, r.meta);
  }
  async getDriver(req: Request, res: Response) {
    await carrierPortalService.assertOwned('driver', req.params.id!, scope(req).companyId);
    return ok(req, res, 'Driver', await fleetService.getDriver(req.params.id!));
  }
  async createDriver(req: Request, res: Response) {
    const s = scope(req);
    return ok(req, res, 'Driver created', await fleetService.createDriver({ ...req.body, companyId: s.companyId, ...carrierActor(s) }), 201);
  }
  async updateDriver(req: Request, res: Response) {
    const s = scope(req);
    await carrierPortalService.assertOwned('driver', req.params.id!, s.companyId);
    return ok(req, res, 'Driver updated', await fleetService.updateDriver({ driverId: req.params.id!, patch: req.body, ...carrierActor(s) }));
  }

  // ---- network & schedule
  async listRoutes(req: Request, res: Response) {
    const r = await networkService.listRoutes({ ...(req.query as object), companyId: scope(req).companyId });
    return ok(req, res, 'Routes', r.items, 200, r.meta);
  }
  async getRoute(req: Request, res: Response) {
    await carrierPortalService.assertOwned('route', req.params.id!, scope(req).companyId);
    return ok(req, res, 'Route', await networkService.getRoute(req.params.id!));
  }
  async createRoute(req: Request, res: Response) {
    const s = scope(req);
    return ok(req, res, 'Route created', await networkService.createRoute({ ...req.body, companyId: s.companyId, ...carrierActor(s) }), 201);
  }
  async updateRoute(req: Request, res: Response) {
    const s = scope(req);
    await carrierPortalService.assertOwned('route', req.params.id!, s.companyId);
    return ok(req, res, 'Route updated', await networkService.updateRoute({ routeId: req.params.id!, patch: req.body, ...carrierActor(s) }));
  }
  async listTrips(req: Request, res: Response) {
    const r = await catalogService.listTripsAdmin({ ...(req.query as { status?: TripStatus }), companyId: scope(req).companyId });
    return ok(req, res, 'Trips', r.items, 200, r.meta);
  }
  async getTrip(req: Request, res: Response) {
    await carrierPortalService.assertOwned('trip', req.params.id!, scope(req).companyId);
    return ok(req, res, 'Trip', await networkService.getTrip(req.params.id!));
  }
  async schedule(req: Request, res: Response) {
    const s = scope(req);
    await carrierPortalService.assertOwned('route', req.body.routeId as string, s.companyId);
    await carrierPortalService.assertOwned('vehicle', req.body.vehicleId as string, s.companyId);
    if (req.body.driverId) await carrierPortalService.assertOwned('driver', req.body.driverId as string, s.companyId);
    return ok(req, res, 'Trips scheduled', await networkService.scheduleTrips({ ...req.body, ...carrierActor(s) }), 201);
  }
  async assignment(req: Request, res: Response) {
    const s = scope(req);
    await carrierPortalService.assertOwned('trip', req.params.id!, s.companyId);
    if (req.body.vehicleId) await carrierPortalService.assertOwned('vehicle', req.body.vehicleId as string, s.companyId);
    if (req.body.driverId) await carrierPortalService.assertOwned('driver', req.body.driverId as string, s.companyId);
    return ok(req, res, 'Assignment updated', await networkService.updateAssignment({ tripId: req.params.id!, patch: req.body, ...carrierActor(s) }));
  }
  /** New price applies to new sales only; confirmed bookings keep what they paid. */
  async price(req: Request, res: Response) {
    const s = scope(req);
    await carrierPortalService.assertOwned('trip', req.params.id!, s.companyId);
    await catalogService.patchTrip({ tripId: req.params.id!, basePrice: req.body.basePriceMinor as number, ...carrierActor(s) });
    return ok(req, res, 'Price updated', await networkService.getTrip(req.params.id!));
  }
  async cancelTrip(req: Request, res: Response) {
    const s = scope(req);
    await carrierPortalService.assertOwned('trip', req.params.id!, s.companyId);
    return ok(req, res, 'Trip cancelled', await networkService.cancelTrip({ tripId: req.params.id!, reason: req.body.reason as string, ...carrierActor(s) }));
  }
  async manifest(req: Request, res: Response) {
    const s = scope(req);
    await carrierPortalService.assertOwned('trip', req.params.id!, s.companyId);
    const trip = await getPrisma().trip.findUniqueOrThrow({ where: { id: req.params.id! }, select: { id: true, status: true } });
    return ok(req, res, 'Manifest', await driverTripsService.manifestOf(trip));
  }

  // ---- bookings & tracking
  async bookings(req: Request, res: Response) {
    const r = await bookingsService.listAdmin({ ...(req.query as { status?: BookingStatus }), companyId: scope(req).companyId });
    return ok(req, res, 'Bookings', r.items, 200, r.meta);
  }
  async booking(req: Request, res: Response) {
    const b = await bookingsService.getAdminById(req.params.id!);
    const trip = await getPrisma().trip.findUnique({ where: { id: b.trip.id }, select: { companyId: true } });
    if (trip?.companyId !== scope(req).companyId) throw AppError.notFound('Booking not found');
    return ok(req, res, 'Booking', b);
  }
  async staffMember(req: Request, res: Response) {
    const all = await carrierPortalService.listStaff(scope(req).companyId);
    const e = all.find((x) => x.id === req.params.id);
    if (!e) throw AppError.notFound('Employee not found');
    return ok(req, res, 'Employee', e);
  }
  async live(req: Request, res: Response) {
    const all = await trackingService.activeTrips();
    const mine = all.filter((t) => t.carrier.id === scope(req).companyId);
    return ok(req, res, 'Live trips', mine, 200, { total: mine.length });
  }
  async trackTrip(req: Request, res: Response) {
    await carrierPortalService.assertOwned('trip', req.params.id!, scope(req).companyId);
    const [live, trail] = await Promise.all([trackingService.viewById(req.params.id!), trackingService.trail(req.params.id!)]);
    return ok(req, res, 'Trip tracking', { ...live, trail });
  }

  // ---- finance
  async amenities(req: Request, res: Response) {
    const rows = await getPrisma().amenity.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }], select: { code: true, nameAr: true, nameEn: true, icon: true } });
    return ok(req, res, 'Amenities', rows);
  }
  async statement(req: Request, res: Response) {
    const q = req.query as { from: string; to: string };
    return ok(req, res, 'Statement', await carrierSettlementsService.preview(scope(req).companyId, q.from, q.to));
  }
  async cashByDriver(req: Request, res: Response) {
    const q = req.query as { from: string; to: string };
    const tz = env().PLATFORM_TIMEZONE;
    const rows = await getPrisma().cashCollection.groupBy({
      by: ['driverId'],
      where: { trip: { companyId: scope(req).companyId }, collectedAt: { gte: zonedDayRange(q.from, tz).from, lt: zonedDayRange(q.to, tz).to } },
      _sum: { amount: true },
      _count: { _all: true },
    });
    const drivers = await getPrisma().driver.findMany({ where: { id: { in: rows.map((r) => r.driverId) } }, select: { id: true, displayName: true, driverCode: true } });
    const data = rows
      .map((r) => ({ driver: drivers.find((d) => d.id === r.driverId) ?? { id: r.driverId }, tickets: r._count._all, collectedMinor: r._sum.amount ?? 0 }))
      .sort((a, b) => b.collectedMinor - a.collectedMinor);
    return ok(req, res, 'Cash by driver', data, 200, { totalMinor: data.reduce((n, d) => n + d.collectedMinor, 0) });
  }
  /** Carriers see statements once the platform finalized them (drafts can still change). */
  async settlements(req: Request, res: Response) {
    const q = req.query as { status?: 'FINALIZED' | 'PAID' | 'CANCELLED' };
    const r = await carrierSettlementsService.list({ ...q, companyId: scope(req).companyId, visibleToCarrier: true });
    return ok(req, res, 'Settlements', r.items, 200, r.meta);
  }
  async settlement(req: Request, res: Response) {
    return ok(req, res, 'Settlement', await carrierSettlementsService.get(req.params.id!, scope(req).companyId));
  }
}

const c = new CarrierPortalController();
const h = (fn: (req: Request, res: Response) => Promise<Response>) => asyncHandler((req, res) => fn.call(c, req, res));

/** Mounted at `${API_PREFIX}/carrier/auth` (web portal: HttpOnly refresh cookie; mobile clients: body token). */
export const carrierAuthRoutes = createMobileAuthRoutes(
  new MobileAuthController(new MobileAuthEngine(carrierAuthStore), { key: 'employee', load: (id) => carrierPortalService.me(id) }, undefined, {
    name: env().CARRIER_REFRESH_COOKIE_NAME,
    path: env().CARRIER_REFRESH_COOKIE_PATH,
  }),
);
carrierAuthRoutes.get('/me', authenticateCarrier, h(c.me));

const fleet = requireCarrierPermission('carrier.fleet');
const sched = requireCarrierPermission('carrier.schedule');
const fin = requireCarrierPermission('carrier.finance');
const staff = requireCarrierPermission('carrier.staff');

/** Mounted at `${API_PREFIX}/carrier` — everything scoped to the employee's company. */
export const carrierPortalRoutes = Router();
carrierPortalRoutes.use(authenticateCarrier);
carrierPortalRoutes.get('/dashboard', h(c.dashboard));
carrierPortalRoutes.get('/brokers', h(c.brokers));
carrierPortalRoutes.get('/amenities', h(c.amenities));

carrierPortalRoutes.get('/staff', staff, h(c.listStaff));
carrierPortalRoutes.get('/staff/:id', staff, validate({ params: idParams }), h(c.staffMember));
carrierPortalRoutes.post('/staff', staff, validate({ body: createStaffSchema }), h(c.createStaff));
carrierPortalRoutes.patch('/staff/:id', staff, validate({ params: idParams, body: patchStaffSchema }), h(c.updateStaff));

carrierPortalRoutes.get('/vehicles', validate({ query: listVehiclesQuerySchema }), h(c.listVehicles));
carrierPortalRoutes.post('/vehicles', fleet, validate({ body: createVehicleSchema.omit({ companyId: true }) }), h(c.createVehicle));
carrierPortalRoutes.get('/vehicles/:id', validate({ params: idParams }), h(c.getVehicle));
carrierPortalRoutes.patch('/vehicles/:id', fleet, validate({ params: idParams, body: patchVehicleSchema }), h(c.updateVehicle));
carrierPortalRoutes.get('/drivers', validate({ query: listDriversQuerySchema }), h(c.listDrivers));
carrierPortalRoutes.post('/drivers', fleet, validate({ body: createDriverSchema.omit({ companyId: true }) }), h(c.createDriver));
carrierPortalRoutes.get('/drivers/:id', validate({ params: idParams }), h(c.getDriver));
carrierPortalRoutes.patch('/drivers/:id', fleet, validate({ params: idParams, body: patchDriverSchema }), h(c.updateDriver));

carrierPortalRoutes.get('/routes', validate({ query: listRoutesQuerySchema }), h(c.listRoutes));
carrierPortalRoutes.post('/routes', sched, validate({ body: createRouteSchema.omit({ companyId: true }) }), h(c.createRoute));
carrierPortalRoutes.get('/routes/:id', validate({ params: idParams }), h(c.getRoute));
carrierPortalRoutes.patch('/routes/:id', sched, validate({ params: idParams, body: patchRouteSchema }), h(c.updateRoute));

carrierPortalRoutes.get('/trips', validate({ query: tripsQuery }), h(c.listTrips));
carrierPortalRoutes.post('/trips/schedule', sched, validate({ body: scheduleTripsSchema }), h(c.schedule));
carrierPortalRoutes.get('/trips/:id', validate({ params: idParams }), h(c.getTrip));
carrierPortalRoutes.patch('/trips/:id/assignment', sched, validate({ params: idParams, body: patchAssignmentSchema }), h(c.assignment));
carrierPortalRoutes.patch('/trips/:id/price', sched, validate({ params: idParams, body: priceSchema }), h(c.price));
carrierPortalRoutes.post('/trips/:id/cancel', sched, validate({ params: idParams, body: cancelTripSchema }), h(c.cancelTrip));
carrierPortalRoutes.get('/trips/:id/manifest', validate({ params: idParams }), h(c.manifest));

carrierPortalRoutes.get('/bookings', validate({ query: bookingsQuery }), h(c.bookings));
carrierPortalRoutes.get('/bookings/:id', validate({ params: idParams }), h(c.booking));
carrierPortalRoutes.get('/tracking/live', h(c.live));
carrierPortalRoutes.get('/tracking/trips/:id', validate({ params: idParams }), h(c.trackTrip));

carrierPortalRoutes.get('/reports/statement', fin, validate({ query: rangeQuery }), h(c.statement));
carrierPortalRoutes.get('/reports/cash-by-driver', fin, validate({ query: rangeQuery }), h(c.cashByDriver));
carrierPortalRoutes.get('/settlements', fin, validate({ query: settlementsQuery }), h(c.settlements));
carrierPortalRoutes.get('/settlements/:id', fin, validate({ params: idParams }), h(c.settlement));
