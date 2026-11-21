import { Prisma, TripSeatStatus, type TripSeat, type SeatHold } from '@prisma/client';
import { env } from '../../config/env';
import { getPrisma } from '../../infrastructure/database/prisma';
import { AppError } from '../../shared/errors/app-error';
import { computeCommission, compareSeatLabels, decimalToNumber } from '../../shared/utils/money';
import { paginationMeta, parsePagination } from '../../shared/utils/pagination';
import { zonedDayRange } from '../../shared/utils/timezone';
import { auditService } from '../audit/audit.service';
import { CatalogErrors } from './catalog.errors';
import {
  catalogRepository,
  type TripWithCompany,
} from './catalog.repository';

type SeatCounts = Record<TripSeatStatus, number>;

const EMPTY_COUNTS: SeatCounts = { FREE: 0, HELD: 0, SOLD: 0 };

/** Date-only filters are Sudan calendar days, not UTC days. */
function platformDay(ymd: string): { from: Date; to: Date } {
  return zonedDayRange(ymd, env().PLATFORM_TIMEZONE);
}

function seatSummary(counts: SeatCounts | undefined) {
  const c = counts ?? EMPTY_COUNTS;
  return {
    total: c.FREE + c.HELD + c.SOLD,
    free: c.FREE,
    held: c.HELD,
    sold: c.SOLD,
  };
}

function toAdminTripDto(trip: TripWithCompany, counts: SeatCounts | undefined) {
  return {
    id: trip.id,
    company: { id: trip.company.id, key: trip.company.key, name: trip.company.name },
    origin: trip.origin,
    destination: trip.destination,
    departureAt: trip.departureAt.toISOString(),
    basePrice: trip.basePrice,
    isActive: trip.isActive,
    seats: seatSummary(counts),
    createdAt: trip.createdAt.toISOString(),
  };
}

function toBrokerTripDto(
  trip: TripWithCompany,
  counts: SeatCounts | undefined,
  commissionPercent: number,
) {
  const seats = seatSummary(counts);
  return {
    id: trip.id,
    company: { id: trip.company.id, key: trip.company.key, name: trip.company.name },
    origin: trip.origin,
    destination: trip.destination,
    departureAt: trip.departureAt.toISOString(),
    basePrice: trip.basePrice,
    commissionPercent,
    expectedCommissionPerSeat: computeCommission(trip.basePrice, commissionPercent),
    availability: {
      free: seats.free,
      held: seats.held,
      sold: seats.sold,
      total: seats.total,
    },
    seatsFree: seats.free,
    seatsTotal: seats.total,
  };
}

export class CatalogService {
  // ---- admin ----

  async createTrip(input: {
    companyId: string;
    origin: string;
    destination: string;
    departureAt: Date;
    basePrice: number;
    seatLabels: string[];
    actorAdminId: string;
    requestId?: string;
  }) {
    const company = await catalogRepository.findCompanyById(input.companyId);
    if (!company) throw AppError.validation('Transport company does not exist');
    if (input.departureAt.getTime() <= Date.now()) {
      throw AppError.validation('departureAt must be in the future');
    }

    const trip = await catalogRepository.createTripWithSeats(
      {
        companyId: input.companyId,
        origin: input.origin,
        destination: input.destination,
        departureAt: input.departureAt,
        basePrice: input.basePrice,
      },
      input.seatLabels,
    );

    await auditService.record({
      actorAdminId: input.actorAdminId,
      action: 'catalog.trip.created',
      resourceType: 'trip',
      resourceId: trip.id,
      requestId: input.requestId,
      metadata: { companyId: input.companyId, seats: input.seatLabels.length },
    });

    const counts = await catalogRepository.seatCountsByTrip([trip.id]);
    return toAdminTripDto(trip, counts.get(trip.id));
  }

  async listTripsAdmin(query: {
    page?: number;
    pageSize?: number;
    companyId?: string;
    origin?: string;
    destination?: string;
    date?: string;
  }) {
    const { page, pageSize, skip, take } = parsePagination(query);
    const where: Prisma.TripWhereInput = {
      ...(query.companyId ? { companyId: query.companyId } : {}),
      ...(query.origin ? { origin: { contains: query.origin } } : {}),
      ...(query.destination ? { destination: { contains: query.destination } } : {}),
      ...(query.date
        ? (() => {
            const { from, to } = platformDay(query.date);
            return { departureAt: { gte: from, lt: to } };
          })()
        : {}),
    };
    const { items, total } = await catalogRepository.listTrips({ skip, take, where });
    const counts = await catalogRepository.seatCountsByTrip(items.map((t) => t.id));
    return {
      items: items.map((t) => toAdminTripDto(t, counts.get(t.id))),
      meta: paginationMeta(page, pageSize, total),
    };
  }

  async patchTrip(input: {
    tripId: string;
    origin?: string;
    destination?: string;
    departureAt?: Date;
    basePrice?: number;
    isActive?: boolean;
    actorAdminId: string;
    requestId?: string;
  }) {
    const existing = await catalogRepository.findTripById(input.tripId);
    if (!existing) throw CatalogErrors.tripNotFound();

    if (input.departureAt && input.departureAt.getTime() <= Date.now()) {
      throw AppError.validation('departureAt must be in the future');
    }

    const trip = await catalogRepository.updateTrip(input.tripId, {
      ...(input.origin !== undefined ? { origin: input.origin } : {}),
      ...(input.destination !== undefined ? { destination: input.destination } : {}),
      ...(input.departureAt !== undefined ? { departureAt: input.departureAt } : {}),
      ...(input.basePrice !== undefined ? { basePrice: input.basePrice } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    });

    await auditService.record({
      actorAdminId: input.actorAdminId,
      action: 'catalog.trip.updated',
      resourceType: 'trip',
      resourceId: trip.id,
      requestId: input.requestId,
      metadata: {
        origin: input.origin,
        destination: input.destination,
        departureAt: input.departureAt?.toISOString(),
        basePrice: input.basePrice,
        isActive: input.isActive,
      },
    });

    const counts = await catalogRepository.seatCountsByTrip([trip.id]);
    return toAdminTripDto(trip, counts.get(trip.id));
  }

  async appendSeats(input: {
    tripId: string;
    seatLabels: string[];
    actorAdminId: string;
    requestId?: string;
  }) {
    const existing = await catalogRepository.findTripById(input.tripId);
    if (!existing) throw CatalogErrors.tripNotFound();

    const current = await catalogRepository.listSeatLabels(input.tripId);
    const existingLabels = new Set(current.map((s) => s.seatLabel.toLowerCase()));
    const toAdd = input.seatLabels.filter((l) => !existingLabels.has(l.toLowerCase()));
    const added = await catalogRepository.appendSeats(input.tripId, toAdd);

    await auditService.record({
      actorAdminId: input.actorAdminId,
      action: 'catalog.trip.seats_appended',
      resourceType: 'trip',
      resourceId: input.tripId,
      requestId: input.requestId,
      metadata: { requested: input.seatLabels.length, added, skipped: input.seatLabels.length - added },
    });

    const counts = await catalogRepository.seatCountsByTrip([input.tripId]);
    const trip = await catalogRepository.findTripById(input.tripId);
    if (!trip) throw CatalogErrors.tripNotFound();
    return {
      trip: toAdminTripDto(trip, counts.get(trip.id)),
      added,
      skipped: input.seatLabels.length - added,
      seatLabelsAdded: toAdd,
    };
  }

  // ---- hold lifecycle ----

  /** Frees seats whose hold has expired. Safe to call at any time. */
  async releaseExpiredHolds(tripId?: string): Promise<number> {
    return getPrisma().$transaction((tx) => catalogRepository.releaseExpiredHolds(tripId, tx));
  }

  // ---- broker ----

  async searchTripsForBroker(
    officeId: string,
    query: {
      page?: number;
      pageSize?: number;
      origin?: string;
      destination?: string;
      date?: string;
      dateFrom?: string;
      dateTo?: string;
    },
  ) {
    await this.releaseExpiredHolds();

    const { page, pageSize, skip, take } = parsePagination(query);
    const now = new Date();
    let departureAt: Prisma.DateTimeFilter = { gte: now };

    if (query.dateFrom || query.dateTo) {
      const rangeFrom = query.dateFrom ? platformDay(query.dateFrom).from : now;
      const rangeTo = query.dateTo
        ? platformDay(query.dateTo).to
        : new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
      departureAt = {
        gte: rangeFrom > now ? rangeFrom : now,
        lt: rangeTo,
      };
    } else if (query.date) {
      const { from, to } = platformDay(query.date);
      departureAt = { gte: from > now ? from : now, lt: to };
    }

    const where: Prisma.TripWhereInput = {
      isActive: true,
      departureAt,
      company: {
        status: 'ACTIVE',
        brokerAssignments: { some: { officeId } },
      },
      ...(query.origin ? { origin: { contains: query.origin } } : {}),
      ...(query.destination ? { destination: { contains: query.destination } } : {}),
    };

    const { items, total } = await catalogRepository.listTrips({ skip, take, where });
    const [counts, assignments] = await Promise.all([
      catalogRepository.seatCountsByTrip(items.map((t) => t.id)),
      catalogRepository.assignmentsForOffice(officeId),
    ]);
    const percentByCompany = new Map(
      assignments.map((a) => [a.companyId, decimalToNumber(a.commissionPercent)]),
    );

    return {
      items: items.map((t) =>
        toBrokerTripDto(t, counts.get(t.id), percentByCompany.get(t.companyId) ?? 0),
      ),
      meta: paginationMeta(page, pageSize, total),
    };
  }

  /**
   * Admin trip detail: any trip, no carrier-assignment scope.
   * Reuses expired-hold normalization from broker GET (frees expired holds, does not
   * invent new seat state). Seat DTOs omit hold tokens and holder identity.
   */
  async getTripForAdmin(tripId: string) {
    await this.releaseExpiredHolds(tripId);

    const trip = await catalogRepository.findTripById(tripId);
    if (!trip) throw CatalogErrors.tripNotFound();

    const seats = await catalogRepository.listSeatsWithHolds(trip.id);
    seats.sort((a, b) => compareSeatLabels(a.seatLabel, b.seatLabel));

    const counts: SeatCounts = { FREE: 0, HELD: 0, SOLD: 0 };
    for (const seat of seats) counts[seat.status] += 1;

    return {
      ...toAdminTripDto(trip, counts),
      availability: {
        free: counts.FREE,
        held: counts.HELD,
        sold: counts.SOLD,
        total: counts.FREE + counts.HELD + counts.SOLD,
      },
      seats: seats.map((seat) => ({
        id: seat.id,
        label: seat.seatLabel,
        status: seat.status,
      })),
    };
  }

  async getTripForBroker(input: { tripId: string; officeId: string; employeeId: string }) {
    await this.releaseExpiredHolds(input.tripId);

    const trip = await catalogRepository.findTripForBroker(input.tripId, input.officeId);
    if (!trip) throw CatalogErrors.tripNotFound();

    const assignment = await catalogRepository.findAssignment(input.officeId, trip.companyId);
    const percent = assignment ? decimalToNumber(assignment.commissionPercent) : 0;

    const seats = await catalogRepository.listSeatsWithHolds(trip.id);
    seats.sort((a, b) => compareSeatLabels(a.seatLabel, b.seatLabel));

    const counts: SeatCounts = { FREE: 0, HELD: 0, SOLD: 0 };
    for (const seat of seats) counts[seat.status] += 1;

    return {
      ...toBrokerTripDto(trip, counts, percent),
      seats: seats.map((seat) => this.toSeatDto(seat, input.employeeId)),
    };
  }

  private toSeatDto(seat: TripSeat & { hold: SeatHold | null }, employeeId: string) {
    const heldByMe = seat.status === TripSeatStatus.HELD && seat.hold?.employeeId === employeeId;
    if (!heldByMe || !seat.hold) {
      return {
        id: seat.id,
        label: seat.seatLabel,
        status: seat.status,
        heldByMe: false,
      };
    }
    const remainingSeconds = Math.max(
      0,
      Math.floor((seat.hold.expiresAt.getTime() - Date.now()) / 1000),
    );
    return {
      id: seat.id,
      label: seat.seatLabel,
      status: seat.status,
      heldByMe: true,
      holdId: seat.hold.id,
      holdExpiresAt: seat.hold.expiresAt.toISOString(),
      remainingSeconds,
    };
  }

  async createHolds(input: {
    tripId: string;
    officeId: string;
    employeeId: string;
    mode?: 'MANUAL' | 'AUTO';
    seatIds?: string[];
    seatCount?: number;
    requestId?: string;
  }) {
    const mode = input.mode ?? (input.seatCount && !input.seatIds ? 'AUTO' : 'MANUAL');
    const ttlMs = env().SEAT_HOLD_TTL_SECONDS * 1000;

    const holds = await getPrisma().$transaction(async (tx) => {
      await catalogRepository.releaseExpiredHolds(input.tripId, tx);

      const trip = await catalogRepository.findTripForBroker(input.tripId, input.officeId, tx);
      if (!trip) throw CatalogErrors.tripNotFound();
      if (!trip.isActive || trip.departureAt.getTime() <= Date.now()) {
        throw CatalogErrors.tripNotBookable();
      }

      let seatIds: string[];
      if (mode === 'AUTO') {
        const count = input.seatCount ?? 0;
        const locked = await catalogRepository.lockFreeSeatsForAuto(trip.id, count, tx);
        seatIds = locked.map((row) => row.id);
        if (seatIds.length !== count) {
          throw CatalogErrors.seatUnavailable({ requested: count, free: seatIds.length });
        }
      } else {
        const requested = input.seatIds ?? [];
        const uniqueSeatIds = [...new Set(requested)];
        if (uniqueSeatIds.length !== requested.length) {
          throw AppError.validation('Duplicate seatIds');
        }
        seatIds = uniqueSeatIds;
      }

      const seats = await catalogRepository.findSeatsByIds(trip.id, seatIds, tx);
      if (seats.length !== seatIds.length) throw CatalogErrors.seatNotFound();

      const updated = await catalogRepository.markSeatsHeld(seatIds, tx);
      if (updated !== seatIds.length) {
        throw CatalogErrors.seatUnavailable({
          unavailableSeatIds: seats.filter((s) => s.status !== TripSeatStatus.FREE).map((s) => s.id),
        });
      }

      const expiresAt = new Date(Date.now() + ttlMs);
      const created = [];
      for (const seat of seats) {
        const hold = await catalogRepository.createHold(
          {
            tripSeatId: seat.id,
            officeId: input.officeId,
            employeeId: input.employeeId,
            expiresAt,
          },
          tx,
        );
        created.push({ hold, seat });
      }
      return created;
    });

    const expiresAt = holds[0]?.hold.expiresAt ?? new Date();
    const remainingSeconds = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
    return {
      tripId: input.tripId,
      expiresAt: expiresAt.toISOString(),
      remainingSeconds,
      holds: holds
        .sort((a, b) => compareSeatLabels(a.seat.seatLabel, b.seat.seatLabel))
        .map(({ hold, seat }) => ({
          id: hold.id,
          seatId: seat.id,
          seatLabel: seat.seatLabel,
          expiresAt: hold.expiresAt.toISOString(),
          remainingSeconds: Math.max(
            0,
            Math.floor((hold.expiresAt.getTime() - Date.now()) / 1000),
          ),
        })),
    };
  }

  async releaseHold(input: {
    holdId: string;
    officeId: string;
    employeeId: string;
    role: 'MANAGER' | 'CLERK';
  }) {
    const hold = await catalogRepository.findHoldWithSeat(input.holdId);
    if (!hold || hold.officeId !== input.officeId) throw CatalogErrors.holdNotFound();
    if (hold.employeeId !== input.employeeId && input.role !== 'MANAGER') {
      throw AppError.forbidden('Only the hold owner or an office manager can release this hold');
    }

    await getPrisma().$transaction((tx) =>
      catalogRepository.releaseHold(hold.id, hold.tripSeatId, tx),
    );

    return { holdId: hold.id, seatId: hold.tripSeatId, released: true };
  }
}

export const catalogService = new CatalogService();
