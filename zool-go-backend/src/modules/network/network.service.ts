import { DriverStatus, TransportCompanyStatus, TripStatus, VehicleStatus, type ServiceClass } from '@prisma/client';
import { env } from '../../config/env';
import { getPrisma } from '../../infrastructure/database/prisma';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import { paginationMeta, parsePagination } from '../../shared/utils/pagination';
import { seatLayoutSchema } from '../../shared/utils/seat-layout';
import { calendarDateInZone } from '../../shared/utils/timezone';
import { auditService } from '../audit/audit.service';
import { bookingsService } from '../bookings';
import { notificationsService } from '../notifications';
import { networkRepository, type RouteRow, type TripRow } from './network.repository';
import type { CreateRouteInput, PatchAssignmentInput, PatchRouteInput, ScheduleTripsInput } from './network.validation';

type Actor = { actorAdminId: string; requestId?: string };

const conflict = (code: string, message: string, details?: unknown) =>
  new AppError({ statusCode: 409, code, message, details });

type StationLite = RouteRow['originStation'];
const stationDto = (s: StationLite) => ({ id: s.id, nameAr: s.nameAr, nameEn: s.nameEn, city: s.city });

export function toRouteDto(r: RouteRow) {
  return {
    id: r.id,
    code: r.code,
    company: r.company,
    originStation: stationDto(r.originStation),
    destinationStation: stationDto(r.destinationStation),
    durationMinutes: r.durationMinutes,
    isActive: r.isActive,
    stops: r.stops.map((s) => ({
      sequence: s.sequence,
      station: stationDto(s.station),
      offsetMinutes: s.offsetMinutes,
      dwellMinutes: s.dwellMinutes,
    })),
    createdAt: r.createdAt.toISOString(),
  };
}

export function toScheduledTripDto(t: TripRow) {
  const counts = { FREE: 0, HELD: 0, SOLD: 0 } as Record<string, number>;
  for (const s of t.seats) counts[s.status] = (counts[s.status] ?? 0) + 1;
  return {
    id: t.id,
    tripNumber: t.tripNumber,
    status: t.status,
    company: t.company,
    route: t.route,
    origin: t.origin,
    destination: t.destination,
    originStation: t.originStation ? stationDto(t.originStation) : null,
    destinationStation: t.destinationStation ? stationDto(t.destinationStation) : null,
    departureAt: t.departureAt.toISOString(),
    arrivalAt: t.arrivalAt?.toISOString() ?? null,
    durationMinutes: t.arrivalAt ? Math.round((t.arrivalAt.getTime() - t.departureAt.getTime()) / 60_000) : null,
    basePriceMinor: t.basePrice,
    currency: 'SDG' as const,
    serviceClass: t.serviceClass,
    isActive: t.isActive,
    vehicle: t.vehicle
      ? {
          id: t.vehicle.id,
          plateNumber: t.vehicle.plateNumber,
          model: t.vehicle.model,
          capacity: t.vehicle.capacity,
          aisleAfterColumn: seatLayoutSchema.safeParse(t.vehicle.seatLayout).data?.aisleAfterColumn ?? null,
        }
      : null,
    driver: t.driver,
    stops: t.stops.map((s) => ({
      sequence: s.sequence,
      station: stationDto(s.station),
      scheduledArrivalAt: s.scheduledArrivalAt?.toISOString() ?? null,
      scheduledDepartureAt: s.scheduledDepartureAt?.toISOString() ?? null,
      actualArrivalAt: s.actualArrivalAt?.toISOString() ?? null,
    })),
    seatCounts: { total: t.seats.length, free: counts.FREE ?? 0, held: counts.HELD ?? 0, sold: counts.SOLD ?? 0 },
    seats: t.seats,
  };
}

export class NetworkService {
  // ---------------- Routes
  private async validateStations(ids: string[]) {
    const unique = [...new Set(ids)];
    const stations = await networkRepository.findStations(unique);
    const missing = unique.filter((id) => !stations.some((s) => s.id === id));
    if (missing.length > 0) throw AppError.validation('Unknown stations', { field: 'stations', missing });
    const inactive = stations.filter((s) => !s.isActive).map((s) => s.id);
    if (inactive.length > 0) throw AppError.validation('Inactive stations cannot be used on a route', { field: 'stations', inactive });
  }

  private normalizeStops(
    stops: CreateRouteInput['stops'],
    durationMinutes: number,
    endpoints: { originStationId: string; destinationStationId: string },
  ) {
    const list = (stops ?? []).map((s) => ({ stationId: s.stationId, offsetMinutes: s.offsetMinutes, dwellMinutes: s.dwellMinutes ?? 0 }));
    let last = 0;
    for (const s of list) {
      if (s.offsetMinutes <= last) throw AppError.validation('Stop offsets must be strictly increasing', { field: 'stops' });
      if (s.offsetMinutes + s.dwellMinutes >= durationMinutes) {
        throw AppError.validation('Every stop must be before the route arrival time', { field: 'stops' });
      }
      if (s.stationId === endpoints.originStationId || s.stationId === endpoints.destinationStationId) {
        throw AppError.validation('Stops must not repeat the origin or destination station', { field: 'stops' });
      }
      last = s.offsetMinutes + s.dwellMinutes;
    }
    return list;
  }

  async listRoutes(query: { page?: number; pageSize?: number; companyId?: string; stationId?: string; isActive?: boolean }) {
    const { page, pageSize, skip, take } = parsePagination(query);
    const { items, total } = await networkRepository.listRoutes({ skip, take, ...query });
    return { items: items.map(toRouteDto), meta: paginationMeta(page, pageSize, total) };
  }

  async getRoute(id: string) {
    const r = await networkRepository.findRouteById(id);
    if (!r) throw AppError.notFound('Route not found');
    return toRouteDto(r);
  }

  async createRoute(input: CreateRouteInput & Actor) {
    if (!(await networkRepository.findCompany(input.companyId))) throw AppError.notFound('Transport company not found');
    if (input.originStationId === input.destinationStationId) {
      throw AppError.validation('Origin and destination must differ', { field: 'destinationStationId' });
    }
    const stops = this.normalizeStops(input.stops, input.durationMinutes, input);
    await this.validateStations([input.originStationId, input.destinationStationId, ...stops.map((s) => s.stationId)]);
    try {
      const id = await getPrisma().$transaction(async (tx) => {
        const route = await networkRepository.createRoute(
          {
            companyId: input.companyId,
            code: input.code ?? null,
            originStationId: input.originStationId,
            destinationStationId: input.destinationStationId,
            durationMinutes: input.durationMinutes,
          },
          tx,
        );
        await networkRepository.replaceRouteStops(route.id, stops, tx);
        await auditService.record(
          { actorAdminId: input.actorAdminId, action: 'route.created', resourceType: 'route', resourceId: route.id, requestId: input.requestId, metadata: { code: input.code ?? null, stops: stops.length } },
          tx,
        );
        return route.id;
      });
      return this.getRoute(id);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'P2002') {
        throw AppError.conflict('Route code already exists for this carrier');
      }
      throw error;
    }
  }

  async updateRoute(input: { routeId: string; patch: PatchRouteInput } & Actor) {
    const existing = await networkRepository.findRouteById(input.routeId);
    if (!existing) throw AppError.notFound('Route not found');
    const duration = input.patch.durationMinutes ?? existing.durationMinutes;
    const stops =
      input.patch.stops !== undefined
        ? this.normalizeStops(input.patch.stops, duration, existing)
        : this.normalizeStops(
            existing.stops.map((s) => ({ stationId: s.station.id, offsetMinutes: s.offsetMinutes, dwellMinutes: s.dwellMinutes })),
            duration,
            existing,
          );
    if (input.patch.stops !== undefined) await this.validateStations(stops.map((s) => s.stationId));
    await getPrisma().$transaction(async (tx) => {
      await networkRepository.updateRoute(
        input.routeId,
        {
          ...(input.patch.durationMinutes !== undefined ? { durationMinutes: input.patch.durationMinutes } : {}),
          ...(input.patch.isActive !== undefined ? { isActive: input.patch.isActive } : {}),
        },
        tx,
      );
      if (input.patch.stops !== undefined) await networkRepository.replaceRouteStops(input.routeId, stops, tx);
      await auditService.record(
        { actorAdminId: input.actorAdminId, action: 'route.updated', resourceType: 'route', resourceId: input.routeId, requestId: input.requestId, metadata: { fields: Object.keys(input.patch) } },
        tx,
      );
    });
    return this.getRoute(input.routeId);
  }

  // ---------------- Scheduling
  private async loadAssignment(companyId: string, vehicleId?: string, driverId?: string | null) {
    const vehicle = vehicleId ? await networkRepository.findVehicle(vehicleId) : null;
    if (vehicleId && !vehicle) throw AppError.notFound('Vehicle not found');
    if (vehicle && vehicle.companyId !== companyId) throw conflict(ErrorCodes.ASSIGNMENT_MISMATCH, 'Vehicle belongs to another carrier');
    if (vehicle && vehicle.status !== VehicleStatus.ACTIVE) throw conflict(ErrorCodes.ASSIGNMENT_MISMATCH, 'Vehicle is not active');

    const driver = driverId ? await networkRepository.findDriver(driverId) : null;
    if (driverId && !driver) throw AppError.notFound('Driver not found');
    if (driver && driver.companyId !== companyId) throw conflict(ErrorCodes.ASSIGNMENT_MISMATCH, 'Driver belongs to another carrier');
    if (driver && driver.status !== DriverStatus.ACTIVE) throw conflict(ErrorCodes.ASSIGNMENT_MISMATCH, 'Driver is suspended');
    return { vehicle, driver };
  }

  private async assertFree(params: { vehicleId?: string; driverId?: string | null; from: Date; to: Date; excludeTripId?: string }) {
    if (params.vehicleId) {
      const busy = await networkRepository.overlappingTrips({ vehicleId: params.vehicleId, from: params.from, to: params.to, excludeTripId: params.excludeTripId });
      if (busy.length > 0) throw conflict(ErrorCodes.VEHICLE_BUSY, 'Vehicle already assigned to an overlapping trip', { trips: busy });
    }
    if (params.driverId) {
      const busy = await networkRepository.overlappingTrips({ driverId: params.driverId, from: params.from, to: params.to, excludeTripId: params.excludeTripId });
      if (busy.length > 0) throw conflict(ErrorCodes.DRIVER_BUSY, 'Driver already assigned to an overlapping trip', { trips: busy });
    }
  }

  private async nextTripNumber(base: string): Promise<string> {
    if (!(await networkRepository.tripNumberExists(base))) return base;
    for (let i = 2; i < 100; i += 1) {
      const candidate = `${base}-${i}`;
      if (!(await networkRepository.tripNumberExists(candidate))) return candidate;
    }
    throw AppError.internal('Could not allocate a trip number');
  }

  /** Creates structured trips from a route: stations, stops with times, seats from the vehicle layout. */
  async scheduleTrips(input: ScheduleTripsInput & Actor) {
    const route = await networkRepository.findRouteById(input.routeId);
    if (!route) throw AppError.notFound('Route not found');
    if (!route.isActive) throw AppError.validation('Route is inactive', { field: 'routeId' });
    const company = await networkRepository.findCompany(route.company.id);
    if (company?.status !== TransportCompanyStatus.ACTIVE) throw conflict(ErrorCodes.ASSIGNMENT_MISMATCH, 'Carrier is suspended');

    const { vehicle, driver } = await this.loadAssignment(route.company.id, input.vehicleId, input.driverId);
    const layout = seatLayoutSchema.parse(vehicle!.seatLayout);
    const durationMs = route.durationMinutes * 60_000;
    const now = Date.now();

    const departures = [...input.departures].sort((a, b) => a.getTime() - b.getTime());
    for (const [i, d] of departures.entries()) {
      if (d.getTime() <= now) throw AppError.validation('Departures must be in the future', { field: `departures.${i}` });
      if (i > 0 && d.getTime() < departures[i - 1]!.getTime() + durationMs) {
        throw conflict(ErrorCodes.VEHICLE_BUSY, 'Two departures in this request overlap for the same vehicle', { departure: d.toISOString() });
      }
      await this.assertFree({ vehicleId: vehicle!.id, driverId: driver?.id, from: d, to: new Date(d.getTime() + durationMs) });
    }

    const tz = env().PLATFORM_TIMEZONE;
    const routeCode = route.code ?? 'TRP';
    const tripIds: string[] = [];
    await getPrisma().$transaction(async (tx) => {
      for (const departureAt of departures) {
        const local = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(departureAt).replace(':', '');
        const tripNumber = await this.nextTripNumber(`${routeCode}-${calendarDateInZone(departureAt, tz).replace(/-/g, '')}-${local}`);
        const trip = await networkRepository.createTrip(
          {
            tripNumber,
            companyId: route.company.id,
            routeId: route.id,
            origin: route.originStation.city.nameAr,
            destination: route.destinationStation.city.nameAr,
            originStationId: route.originStation.id,
            destinationStationId: route.destinationStation.id,
            departureAt,
            arrivalAt: new Date(departureAt.getTime() + durationMs),
            basePrice: input.basePrice,
            vehicleId: vehicle!.id,
            driverId: driver?.id ?? null,
            serviceClass: (input.serviceClass as ServiceClass | undefined) ?? vehicle!.serviceClass,
            seats: {
              create: layout.seats.map((s, i) => ({ seatLabel: s.label, sortOrder: i, layoutRow: s.row, layoutColumn: s.column, isWomenOnly: s.isWomenOnly })),
            },
            stops: {
              create: route.stops.map((s) => ({
                stationId: s.station.id,
                sequence: s.sequence,
                scheduledArrivalAt: new Date(departureAt.getTime() + s.offsetMinutes * 60_000),
                scheduledDepartureAt: new Date(departureAt.getTime() + (s.offsetMinutes + s.dwellMinutes) * 60_000),
              })),
            },
          },
          tx,
        );
        tripIds.push(trip.id);
      }
      await auditService.record(
        {
          actorAdminId: input.actorAdminId,
          action: 'trips.scheduled',
          resourceType: 'route',
          resourceId: route.id,
          requestId: input.requestId,
          metadata: { count: tripIds.length, vehicleId: vehicle!.id, driverId: driver?.id ?? null },
        },
        tx,
      );
    });

    const trips = await Promise.all(tripIds.map((id) => networkRepository.findTripById(id)));
    return trips.map((t) => toScheduledTripDto(t!));
  }

  /**
   * D-SUS-01: cancel a trip that has not departed. The trip is marked CANCELLED first (no new
   * sales), holds are released, then every confirmed booking is refunded in full with no fee
   * through the existing idempotent cancellation path. Safe to re-run: already-refunded
   * bookings are skipped, so a partial failure is completed by calling this again.
   */
  async cancelTrip(input: { tripId: string; reason: string } & Actor) {
    const trip = await networkRepository.findTripById(input.tripId);
    if (!trip) throw AppError.notFound('Trip not found');
    if (trip.status === TripStatus.IN_PROGRESS || trip.status === TripStatus.COMPLETED) {
      throw conflict(ErrorCodes.TRIP_NOT_CANCELLABLE, 'Departed trips cannot be cancelled', { status: trip.status });
    }

    if (trip.status !== TripStatus.CANCELLED) {
      await getPrisma().$transaction(async (tx) => {
        await networkRepository.updateTrip(trip.id, { status: TripStatus.CANCELLED, cancelledAt: new Date(), isActive: false }, tx);
        await networkRepository.releaseTripHolds(trip.id, tx);
        await auditService.record(
          { actorAdminId: input.actorAdminId, action: 'trip.cancelled', resourceType: 'trip', resourceId: trip.id, requestId: input.requestId, metadata: { reason: input.reason } },
          tx,
        );
      });
    }

    const bookings = await networkRepository.confirmedBookings(trip.id);
    const refunded: Array<{ bookingId: string; refundedAmountMinor: number }> = [];
    const failed: Array<{ bookingId: string; code: string; message: string }> = [];
    const officesNotified = new Set<string>();

    for (const b of bookings) {
      try {
        const result = await bookingsService.cancelByAdmin({
          bookingId: b.id,
          reason: `trip_cancelled: ${input.reason}`,
          actorAdminId: input.actorAdminId,
          requestId: input.requestId,
        });
        refunded.push({ bookingId: b.id, refundedAmountMinor: result.refundedAmountMinor });
        if (b.officeId && !officesNotified.has(b.officeId)) officesNotified.add(b.officeId);
      } catch (error) {
        failed.push({
          bookingId: b.id,
          code: error instanceof AppError ? error.code : 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    for (const officeId of officesNotified) {
      const managers = await notificationsService.officeManagers(officeId);
      await notificationsService.notify(managers, {
        type: 'TRIP_CANCELLED',
        title: 'تم إلغاء رحلة',
        body: `أُلغيت الرحلة ${trip.tripNumber ?? `${trip.origin} - ${trip.destination}`} واسترُدّ المبلغ كاملًا إلى المحفظة.`,
        data: { tripId: trip.id },
      });
    }

    return {
      trip: await this.getTrip(trip.id),
      refundedBookings: refunded.length,
      refundedAmountMinor: refunded.reduce((n, r) => n + r.refundedAmountMinor, 0),
      failed,
    };
  }

  async getTrip(id: string) {
    const t = await networkRepository.findTripById(id);
    if (!t) throw AppError.notFound('Trip not found');
    return toScheduledTripDto(t);
  }

  /**
   * Re-assign driver (any time before completion) or vehicle (only while SCHEDULED and no seat
   * is held or sold — the seat map is rebuilt from the new layout).
   */
  async updateAssignment(input: { tripId: string; patch: PatchAssignmentInput } & Actor) {
    const trip = await networkRepository.findTripById(input.tripId);
    if (!trip) throw AppError.notFound('Trip not found');
    if (trip.status === TripStatus.COMPLETED || trip.status === TripStatus.CANCELLED) {
      throw conflict(ErrorCodes.ASSIGNMENT_MISMATCH, `Trip is ${trip.status}`);
    }
    const { vehicle, driver } = await this.loadAssignment(trip.company.id, input.patch.vehicleId, input.patch.driverId);
    const to = trip.arrivalAt ?? new Date(trip.departureAt.getTime() + 60_000);
    await this.assertFree({
      vehicleId: vehicle?.id,
      driverId: driver?.id,
      from: trip.departureAt,
      to,
      excludeTripId: trip.id,
    });

    await getPrisma().$transaction(async (tx) => {
      if (vehicle && vehicle.id !== trip.vehicle?.id) {
        if (trip.status !== TripStatus.SCHEDULED) throw conflict(ErrorCodes.TRIP_SEATS_TAKEN, 'Vehicle can only change before boarding');
        const taken = await networkRepository.countNonFreeSeats(trip.id, tx);
        if (taken > 0) throw conflict(ErrorCodes.TRIP_SEATS_TAKEN, 'Seats are already held or sold on this trip', { taken });
        const layout = seatLayoutSchema.parse(vehicle.seatLayout);
        await networkRepository.replaceTripSeats(
          trip.id,
          layout.seats.map((s, i) => ({ seatLabel: s.label, sortOrder: i, layoutRow: s.row, layoutColumn: s.column, isWomenOnly: s.isWomenOnly })),
          tx,
        );
      }
      await networkRepository.updateTrip(
        trip.id,
        {
          ...(vehicle ? { vehicleId: vehicle.id } : {}),
          ...(input.patch.driverId !== undefined ? { driverId: driver?.id ?? null } : {}),
        },
        tx,
      );
      await auditService.record(
        {
          actorAdminId: input.actorAdminId,
          action: 'trip.assignment_updated',
          resourceType: 'trip',
          resourceId: trip.id,
          requestId: input.requestId,
          metadata: { vehicleId: vehicle?.id ?? trip.vehicle?.id ?? null, driverId: input.patch.driverId === undefined ? trip.driver?.id ?? null : driver?.id ?? null },
        },
        tx,
      );
    });
    return this.getTrip(trip.id);
  }
}

export const networkService = new NetworkService();
