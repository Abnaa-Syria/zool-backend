import { BookingStatus, TripSeatStatus, TripStatus, type Prisma } from '@prisma/client';
import { getPrisma, type PrismaTx } from '../../infrastructure/database/prisma';

function client(tx?: PrismaTx) {
  return tx ?? getPrisma();
}

const stationSelect = { id: true, nameAr: true, nameEn: true, city: { select: { id: true, code: true, nameAr: true, nameEn: true } } } as const;

export const routeInclude = {
  company: { select: { id: true, key: true, name: true } },
  originStation: { select: stationSelect },
  destinationStation: { select: stationSelect },
  stops: { orderBy: { sequence: 'asc' }, include: { station: { select: stationSelect } } },
} satisfies Prisma.RouteInclude;

export const tripInclude = {
  company: { select: { id: true, key: true, name: true } },
  route: { select: { id: true, code: true } },
  originStation: { select: stationSelect },
  destinationStation: { select: stationSelect },
  vehicle: { select: { id: true, plateNumber: true, model: true, capacity: true, seatLayout: true } },
  driver: { select: { id: true, driverCode: true, displayName: true } },
  stops: { orderBy: { sequence: 'asc' }, include: { station: { select: stationSelect } } },
  seats: { orderBy: { sortOrder: 'asc' }, select: { seatLabel: true, status: true, layoutRow: true, layoutColumn: true, isWomenOnly: true } },
} satisfies Prisma.TripInclude;

export type RouteRow = Prisma.RouteGetPayload<{ include: typeof routeInclude }>;
export type TripRow = Prisma.TripGetPayload<{ include: typeof tripInclude }>;

/** Trips whose time window overlaps [from, to) — used to stop double-booking a driver or bus. */
const ACTIVE_TRIP_STATUSES = [TripStatus.SCHEDULED, TripStatus.BOARDING, TripStatus.IN_PROGRESS];

export class NetworkRepository {
  findStations(ids: string[]) {
    return getPrisma().station.findMany({ where: { id: { in: ids } }, include: { city: true } });
  }

  findCompany(id: string) {
    return getPrisma().transportCompany.findUnique({ where: { id }, select: { id: true, status: true } });
  }

  // ---- Routes
  async listRoutes(params: { skip: number; take: number; companyId?: string; stationId?: string; isActive?: boolean }) {
    const where: Prisma.RouteWhereInput = {
      ...(params.companyId ? { companyId: params.companyId } : {}),
      ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
      ...(params.stationId
        ? { OR: [{ originStationId: params.stationId }, { destinationStationId: params.stationId }, { stops: { some: { stationId: params.stationId } } }] }
        : {}),
    };
    const [items, total] = await Promise.all([
      getPrisma().route.findMany({ where, include: routeInclude, orderBy: { createdAt: 'desc' }, skip: params.skip, take: params.take }),
      getPrisma().route.count({ where }),
    ]);
    return { items, total };
  }

  findRouteById(id: string) {
    return getPrisma().route.findUnique({ where: { id }, include: routeInclude });
  }

  createRoute(data: Prisma.RouteUncheckedCreateInput, tx?: PrismaTx) {
    return client(tx).route.create({ data, include: routeInclude });
  }

  updateRoute(id: string, data: Prisma.RouteUncheckedUpdateInput, tx?: PrismaTx) {
    return client(tx).route.update({ where: { id }, data, include: routeInclude });
  }

  async replaceRouteStops(routeId: string, stops: Array<{ stationId: string; offsetMinutes: number; dwellMinutes: number }>, tx: PrismaTx) {
    await tx.routeStop.deleteMany({ where: { routeId } });
    if (stops.length > 0) {
      await tx.routeStop.createMany({ data: stops.map((s, i) => ({ routeId, sequence: i + 1, ...s })) });
    }
  }

  // ---- Assignment helpers
  findVehicle(id: string) {
    return getPrisma().vehicle.findUnique({ where: { id } });
  }

  findDriver(id: string) {
    return getPrisma().driver.findUnique({ where: { id } });
  }

  overlappingTrips(params: { vehicleId?: string; driverId?: string; from: Date; to: Date; excludeTripId?: string }, tx?: PrismaTx) {
    return client(tx).trip.findMany({
      where: {
        status: { in: ACTIVE_TRIP_STATUSES },
        ...(params.vehicleId ? { vehicleId: params.vehicleId } : {}),
        ...(params.driverId ? { driverId: params.driverId } : {}),
        ...(params.excludeTripId ? { id: { not: params.excludeTripId } } : {}),
        departureAt: { lt: params.to },
        OR: [{ arrivalAt: { gt: params.from } }, { arrivalAt: null, departureAt: { gte: params.from } }],
      },
      select: { id: true, tripNumber: true, departureAt: true, arrivalAt: true },
      take: 5,
    });
  }

  tripNumberExists(tripNumber: string, tx?: PrismaTx) {
    return client(tx).trip.findUnique({ where: { tripNumber }, select: { id: true } });
  }

  createTrip(data: Prisma.TripUncheckedCreateInput, tx: PrismaTx) {
    return tx.trip.create({ data, select: { id: true } });
  }

  findTripById(id: string, tx?: PrismaTx) {
    return client(tx).trip.findUnique({ where: { id }, include: tripInclude });
  }

  countNonFreeSeats(tripId: string, tx?: PrismaTx) {
    return client(tx).tripSeat.count({ where: { tripId, status: { not: TripSeatStatus.FREE } } });
  }

  async replaceTripSeats(
    tripId: string,
    seats: Array<{ seatLabel: string; sortOrder: number; layoutRow: number; layoutColumn: number; isWomenOnly: boolean }>,
    tx: PrismaTx,
  ) {
    await tx.tripSeat.deleteMany({ where: { tripId } });
    await tx.tripSeat.createMany({ data: seats.map((s) => ({ tripId, ...s })) });
  }

  async releaseTripHolds(tripId: string, tx: PrismaTx) {
    const holds = await tx.seatHold.findMany({ where: { tripSeat: { tripId } }, select: { id: true, tripSeatId: true } });
    if (holds.length === 0) return 0;
    await tx.seatHold.deleteMany({ where: { id: { in: holds.map((h) => h.id) } } });
    await tx.tripSeat.updateMany({ where: { id: { in: holds.map((h) => h.tripSeatId) }, status: TripSeatStatus.HELD }, data: { status: TripSeatStatus.FREE } });
    return holds.length;
  }

  confirmedBookings(tripId: string) {
    return getPrisma().booking.findMany({
      // Unpaid online checkouts are cancelled too (their payment window is voided).
      where: { tripId, status: { in: [BookingStatus.CONFIRMED, BookingStatus.PENDING_PAYMENT] } },
      select: { id: true, officeId: true, channel: true, customerId: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  updateTrip(id: string, data: Prisma.TripUncheckedUpdateInput, tx: PrismaTx) {
    return tx.trip.update({ where: { id }, data, select: { id: true } });
  }
}

export const networkRepository = new NetworkRepository();
