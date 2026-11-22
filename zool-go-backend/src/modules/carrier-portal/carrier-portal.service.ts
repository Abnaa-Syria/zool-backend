import { BookingStatus, CarrierEmployeeStatus, TripStatus, type Prisma } from '@prisma/client';
import { env } from '../../config/env';
import { getPrisma } from '../../infrastructure/database/prisma';
import { carrierPermissions } from '../../shared/constants/carrier-permissions';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import { setPrincipalAuthzVersion } from '../../shared/security/principal-authz-cache';
import { normalizePhone } from '../../shared/utils/phone';
import { calendarDateInZone, zonedDayRange } from '../../shared/utils/timezone';
import { auditService } from '../audit/audit.service';
import { carrierPortalRepository, type CarrierEmployeeRow } from './carrier-portal.repository';

export type CarrierScope = { companyId: string; employeeId: string; requestId?: string };

export function toEmployeeDto(e: CarrierEmployeeRow) {
  const flags = { canManageFleet: e.canManageFleet, canManageSchedule: e.canManageSchedule, canViewFinance: e.canViewFinance, canManageStaff: e.canManageStaff };
  return {
    id: e.id,
    displayName: e.displayName,
    phone: e.identities[0]?.valueNormalized ?? null,
    role: e.role,
    status: e.status,
    flags,
    permissions: carrierPermissions({ ...flags, role: e.role }),
    company: { id: e.company.id, name: e.company.shortName ?? e.company.name, legalName: e.company.name, logoUrl: e.company.logoUrl, status: e.company.status },
    lastLoginAt: e.lastLoginAt?.toISOString() ?? null,
    createdAt: e.createdAt.toISOString(),
  };
}

export type StaffFlags = { canManageFleet?: boolean; canManageSchedule?: boolean; canViewFinance?: boolean; canManageStaff?: boolean };

/** The actor fields shared services write to the audit log for carrier staff. */
export const carrierActor = (s: CarrierScope) => ({ actorType: 'CARRIER_EMPLOYEE', actorId: s.employeeId, ...(s.requestId ? { requestId: s.requestId } : {}) });

/** D-CARRIER-PORTAL-01: carrier staff accounts, profile and home KPIs. */
export class CarrierPortalService {
  async me(employeeId: string) {
    const e = await carrierPortalRepository.findEmployee(employeeId);
    if (!e || e.status !== CarrierEmployeeStatus.ACTIVE) throw AppError.unauthorized('Carrier account is not active');
    return toEmployeeDto(e);
  }

  /** Throws 404 unless the resource belongs to the caller's company. */
  async assertOwned(kind: 'vehicle' | 'driver' | 'route' | 'trip', id: string, companyId: string) {
    const owner =
      kind === 'vehicle'
        ? await carrierPortalRepository.vehicleCompany(id)
        : kind === 'driver'
          ? await carrierPortalRepository.driverCompany(id)
          : kind === 'route'
            ? await carrierPortalRepository.routeCompany(id)
            : await carrierPortalRepository.tripCompany(id);
    if (owner !== companyId) throw AppError.notFound(`${kind[0]!.toUpperCase()}${kind.slice(1)} not found`);
  }

  // ---------------------------------------------------------------- staff

  async listStaff(companyId: string) {
    return (await carrierPortalRepository.listEmployees(companyId)).map(toEmployeeDto);
  }

  /** Used by the carrier manager and by the platform admin (actorAdminId). */
  async createStaff(input: { companyId: string; displayName: string; phone: string; role?: 'MANAGER' | 'STAFF'; flags?: StaffFlags; actor: { actorAdminId?: string; actorType?: string; actorId?: string; requestId?: string } }) {
    const phone = normalizePhone(input.phone);
    if (await carrierPortalRepository.findIdentityByPhone(phone)) throw new AppError({ statusCode: 409, code: ErrorCodes.PHONE_ALREADY_REGISTERED, message: 'Phone identity already registered' });
    const role = input.role ?? 'STAFF';
    const created = await getPrisma().$transaction(async (tx) => {
      const e = await carrierPortalRepository.createEmployee(
        {
          companyId: input.companyId,
          displayName: input.displayName,
          role,
          phone,
          flags: {
            canManageFleet: role === 'MANAGER' || input.flags?.canManageFleet === true,
            canManageSchedule: role === 'MANAGER' || input.flags?.canManageSchedule === true,
            canViewFinance: role === 'MANAGER' || input.flags?.canViewFinance === true,
            canManageStaff: role === 'MANAGER' || input.flags?.canManageStaff === true,
          },
        },
        tx,
      );
      await auditService.record(
        { ...input.actor, action: 'carrier.staff.created', resourceType: 'carrier_employee', resourceId: e.id, metadata: { companyId: input.companyId, role } },
        tx,
      );
      return e;
    });
    await setPrincipalAuthzVersion('carrier', created.id, created.authzVersion);
    return toEmployeeDto(created);
  }

  /** Role/flag/status changes revoke the employee's sessions so new permissions apply at once. */
  async updateStaff(input: {
    companyId: string;
    employeeId: string;
    patch: { displayName?: string; role?: 'MANAGER' | 'STAFF'; status?: 'ACTIVE' | 'SUSPENDED'; flags?: StaffFlags };
    selfId?: string;
    actor: { actorAdminId?: string; actorType?: string; actorId?: string; requestId?: string };
  }) {
    const e = await carrierPortalRepository.findEmployee(input.employeeId);
    if (!e || e.companyId !== input.companyId) throw AppError.notFound('Employee not found');
    if (input.selfId === e.id && (input.patch.status === 'SUSPENDED' || input.patch.role === 'STAFF')) {
      throw AppError.conflict('You cannot suspend or demote yourself');
    }
    const demotingLastManager =
      e.role === 'MANAGER' && (input.patch.role === 'STAFF' || input.patch.status === 'SUSPENDED') && (await carrierPortalRepository.countManagers(e.companyId)) <= 1;
    if (demotingLastManager) throw new AppError({ statusCode: 409, code: ErrorCodes.LAST_MANAGER, message: 'The company needs at least one active manager' });

    const authChange = input.patch.role !== undefined || input.patch.status !== undefined || input.patch.flags !== undefined;
    const updated = await getPrisma().$transaction(async (tx) => {
      const row = await carrierPortalRepository.updateEmployee(
        e.id,
        {
          ...(input.patch.displayName ? { displayName: input.patch.displayName } : {}),
          ...(input.patch.role ? { role: input.patch.role } : {}),
          ...(input.patch.status ? { status: input.patch.status } : {}),
          ...(input.patch.flags ?? {}),
          ...(authChange ? { authzVersion: { increment: 1 } } : {}),
        },
        tx,
      );
      if (authChange) await carrierPortalRepository.revokeSessions(e.id, input.patch.status === 'SUSPENDED' ? 'suspended' : 'permissions_changed', tx);
      await auditService.record(
        { ...input.actor, action: 'carrier.staff.updated', resourceType: 'carrier_employee', resourceId: e.id, metadata: { companyId: e.companyId, ...input.patch } },
        tx,
      );
      return row;
    });
    if (authChange) await setPrincipalAuthzVersion('carrier', updated.id, updated.authzVersion);
    return toEmployeeDto(updated);
  }

  // ---------------------------------------------------------------- dashboard

  async dashboard(companyId: string) {
    const tz = env().PLATFORM_TIMEZONE;
    const today = calendarDateInZone(new Date(), tz);
    const { from, to } = zonedDayRange(today, tz);
    const prisma = getPrisma();
    const tripsToday: Prisma.TripWhereInput = { companyId, departureAt: { gte: from, lt: to }, status: { not: TripStatus.CANCELLED } };
    const [trips, live, soldToday, bookingsToday, upcoming, fleet, drivers] = await Promise.all([
      prisma.trip.count({ where: tripsToday }),
      prisma.trip.count({ where: { companyId, status: { in: [TripStatus.BOARDING, TripStatus.IN_PROGRESS] } } }),
      prisma.ticket.count({ where: { status: 'CONFIRMED', booking: { status: BookingStatus.CONFIRMED, trip: tripsToday } } }),
      prisma.booking.aggregate({ where: { status: BookingStatus.CONFIRMED, confirmedAt: { gte: from, lt: to }, trip: { companyId } }, _sum: { totalAmount: true }, _count: { _all: true } }),
      prisma.trip.findMany({
        where: { companyId, status: TripStatus.SCHEDULED, departureAt: { gt: new Date() } },
        select: { id: true, tripNumber: true, origin: true, destination: true, departureAt: true, _count: { select: { seats: true } }, seats: { where: { status: 'SOLD' }, select: { id: true } } },
        orderBy: { departureAt: 'asc' },
        take: 5,
      }),
      prisma.vehicle.groupBy({ by: ['status'], where: { companyId }, _count: { _all: true } }),
      prisma.driver.count({ where: { companyId, status: 'ACTIVE' } }),
    ]);
    return {
      date: today,
      kpis: {
        tripsToday: trips,
        liveTrips: live,
        seatsSoldForToday: soldToday,
        bookingsConfirmedToday: bookingsToday._count._all,
        salesConfirmedTodayMinor: bookingsToday._sum.totalAmount ?? 0,
        activeDrivers: drivers,
        vehicles: Object.fromEntries(fleet.map((v) => [v.status, v._count._all])),
      },
      nextTrips: upcoming.map((t) => ({
        id: t.id,
        tripNumber: t.tripNumber,
        origin: t.origin,
        destination: t.destination,
        departureAt: t.departureAt.toISOString(),
        seatsTotal: t._count.seats,
        seatsSold: t.seats.length,
      })),
      currency: 'SDG' as const,
    };
  }

  async brokers(companyId: string) {
    const rows = await carrierPortalRepository.assignedOffices(companyId);
    return rows.map((r) => ({ office: r.office, commissionPercent: Number(r.commissionPercent) }));
  }
}

export const carrierPortalService = new CarrierPortalService();
