import {
  Prisma,
  TransportCompanyStatus,
  TripSeatStatus,
  TripStatus,
} from '@prisma/client';
import { getPrisma, type PrismaTx } from '../../infrastructure/database/prisma';
import { tripViewInclude } from './trip-view';

function client(tx?: PrismaTx) {
  return tx ?? getPrisma();
}

export const tripWithCompany = {
  company: true,
} satisfies Prisma.TripInclude;

export type TripWithCompany = Prisma.TripGetPayload<{ include: typeof tripWithCompany }>;

/** Admin list rows: enough to render the trips table without per-row detail requests. */
export const adminTripListInclude = {
  company: true,
  route: { select: { id: true, code: true } },
  vehicle: { select: { id: true, plateNumber: true, model: true } },
  driver: { select: { id: true, driverCode: true, displayName: true } },
} satisfies Prisma.TripInclude;

export type AdminTripListRow = Prisma.TripGetPayload<{ include: typeof adminTripListInclude }>;

/** Trips that can still be searched, held and booked (D-SUS-01: cancelled trips never). */
export const BOOKABLE_TRIP_STATUSES: TripStatus[] = [TripStatus.SCHEDULED, TripStatus.BOARDING];

export class CatalogRepository {
  findCompanyById(id: string) {
    return getPrisma().transportCompany.findUnique({ where: { id } });
  }

  async createTripWithSeats(
    data: {
      companyId: string;
      origin: string;
      destination: string;
      departureAt: Date;
      basePrice: number;
    },
    seatLabels: string[],
  ) {
    return getPrisma().$transaction(async (tx) => {
      const trip = await tx.trip.create({ data, include: tripWithCompany });
      await tx.tripSeat.createMany({
        data: seatLabels.map((seatLabel, index) => ({
          tripId: trip.id,
          seatLabel,
          sortOrder: index,
        })),
      });
      return trip;
    });
  }

  findTripById(tripId: string) {
    return getPrisma().trip.findUnique({ where: { id: tripId }, include: tripWithCompany });
  }

  updateTrip(
    tripId: string,
    data: {
      origin?: string;
      destination?: string;
      departureAt?: Date;
      basePrice?: number;
      isActive?: boolean;
    },
  ) {
    return getPrisma().trip.update({
      where: { id: tripId },
      data,
      include: tripWithCompany,
    });
  }

  listSeatLabels(tripId: string) {
    return getPrisma().tripSeat.findMany({
      where: { tripId },
      select: { seatLabel: true },
    });
  }

  async appendSeats(tripId: string, seatLabels: string[]): Promise<number> {
    if (seatLabels.length === 0) return 0;
    const max = await getPrisma().tripSeat.aggregate({
      where: { tripId },
      _max: { sortOrder: true },
    });
    const start = (max._max.sortOrder ?? -1) + 1;
    const result = await getPrisma().tripSeat.createMany({
      data: seatLabels.map((seatLabel, index) => ({
        tripId,
        seatLabel,
        sortOrder: start + index,
      })),
      skipDuplicates: true,
    });
    return result.count;
  }

  async lockFreeSeatsForAuto(tripId: string, seatCount: number, tx: PrismaTx) {
    const limit = Math.max(0, Math.trunc(seatCount));
    return tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM trip_seats
      WHERE trip_id = ${tripId} AND status = 'FREE'
      ORDER BY sort_order ASC, id ASC
      LIMIT ${Prisma.raw(String(limit))}
      FOR UPDATE
    `;
  }

  async listTripsAdmin(params: { skip: number; take: number; where: Prisma.TripWhereInput }) {
    const [items, total] = await Promise.all([
      getPrisma().trip.findMany({
        where: params.where,
        include: adminTripListInclude,
        orderBy: [{ departureAt: 'asc' }, { id: 'asc' }],
        skip: params.skip,
        take: params.take,
      }),
      getPrisma().trip.count({ where: params.where }),
    ]);
    return { items, total };
  }

  async listTrips(params: {
    skip: number;
    take: number;
    where: Prisma.TripWhereInput;
  }) {
    const [items, total] = await Promise.all([
      getPrisma().trip.findMany({
        where: params.where,
        include: tripWithCompany,
        orderBy: [{ departureAt: 'asc' }, { id: 'asc' }],
        skip: params.skip,
        take: params.take,
      }),
      getPrisma().trip.count({ where: params.where }),
    ]);
    return { items, total };
  }

  /** Broker search with the structured app view (stations, stops, amenities, layout). */
  async listTripViews(params: { skip: number; take: number; where: Prisma.TripWhereInput }) {
    const [items, total] = await Promise.all([
      getPrisma().trip.findMany({
        where: params.where,
        include: tripViewInclude,
        orderBy: [{ departureAt: 'asc' }, { id: 'asc' }],
        skip: params.skip,
        take: params.take,
      }),
      getPrisma().trip.count({ where: params.where }),
    ]);
    return { items, total };
  }

  findTripViewForBroker(tripId: string, officeId: string) {
    return getPrisma().trip.findFirst({
      where: {
        id: tripId,
        status: { in: BOOKABLE_TRIP_STATUSES },
        company: { status: TransportCompanyStatus.ACTIVE, brokerAssignments: { some: { officeId } } },
      },
      include: tripViewInclude,
    });
  }

  async seatCountsByTrip(tripIds: string[]) {
    if (tripIds.length === 0) return new Map<string, Record<TripSeatStatus, number>>();
    const rows = await getPrisma().tripSeat.groupBy({
      by: ['tripId', 'status'],
      where: { tripId: { in: tripIds } },
      _count: { _all: true },
    });
    const map = new Map<string, Record<TripSeatStatus, number>>();
    for (const row of rows) {
      const entry =
        map.get(row.tripId) ?? { [TripSeatStatus.FREE]: 0, [TripSeatStatus.HELD]: 0, [TripSeatStatus.SOLD]: 0 };
      entry[row.status] = row._count._all;
      map.set(row.tripId, entry);
    }
    return map;
  }

  assignmentsForOffice(officeId: string) {
    return getPrisma().brokerCarrierAssignment.findMany({ where: { officeId } });
  }

  findAssignment(officeId: string, companyId: string, tx?: PrismaTx) {
    return client(tx).brokerCarrierAssignment.findUnique({
      where: { officeId_companyId: { officeId, companyId } },
    });
  }

  findTripForBroker(tripId: string, officeId: string, tx?: PrismaTx) {
    return client(tx).trip.findFirst({
      where: {
        id: tripId,
        status: { in: BOOKABLE_TRIP_STATUSES },
        company: {
          status: TransportCompanyStatus.ACTIVE,
          brokerAssignments: { some: { officeId } },
        },
      },
      include: tripWithCompany,
    });
  }

  listSeatsWithHolds(tripId: string, tx?: PrismaTx) {
    return client(tx).tripSeat.findMany({
      where: { tripId },
      include: { hold: true },
    });
  }

  async releaseExpiredHolds(tripId: string | undefined, tx: PrismaTx): Promise<number> {
    const expired = await tx.seatHold.findMany({
      where: {
        expiresAt: { lte: new Date() },
        ...(tripId ? { tripSeat: { tripId } } : {}),
      },
      select: { id: true, tripSeatId: true },
    });
    if (expired.length === 0) return 0;

    await tx.tripSeat.updateMany({
      where: { id: { in: expired.map((h) => h.tripSeatId) }, status: TripSeatStatus.HELD },
      data: { status: TripSeatStatus.FREE },
    });
    await tx.seatHold.deleteMany({ where: { id: { in: expired.map((h) => h.id) } } });
    return expired.length;
  }

  findSeatsByIds(tripId: string, seatIds: string[], tx: PrismaTx) {
    return tx.tripSeat.findMany({ where: { tripId, id: { in: seatIds } } });
  }

  async markSeatsHeld(seatIds: string[], tx: PrismaTx): Promise<number> {
    const result = await tx.tripSeat.updateMany({
      where: { id: { in: seatIds }, status: TripSeatStatus.FREE },
      data: { status: TripSeatStatus.HELD },
    });
    return result.count;
  }

  createHold(
    data: { tripSeatId: string; officeId: string; employeeId: string; expiresAt: Date },
    tx: PrismaTx,
  ) {
    return tx.seatHold.create({ data });
  }

  findHoldWithSeat(holdId: string, tx?: PrismaTx) {
    return client(tx).seatHold.findUnique({
      where: { id: holdId },
      include: { tripSeat: true },
    });
  }

  async releaseHold(holdId: string, tripSeatId: string, tx: PrismaTx): Promise<void> {
    await tx.tripSeat.updateMany({
      where: { id: tripSeatId, status: TripSeatStatus.HELD },
      data: { status: TripSeatStatus.FREE },
    });
    await tx.seatHold.deleteMany({ where: { id: holdId } });
  }
}

export const catalogRepository = new CatalogRepository();
