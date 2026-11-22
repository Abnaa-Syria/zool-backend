import { Prisma, TransportCompanyStatus, TripSeatStatus } from '@prisma/client';
import { getPrisma, type PrismaTx } from '../../infrastructure/database/prisma';
import { BOOKABLE_TRIP_STATUSES } from '../catalog/catalog.repository';
import { tripViewInclude } from '../catalog/trip-view';

/** Max trips considered for one route-day search (filtered/sorted in memory, then paged). */
export const SEARCH_SCAN_LIMIT = 300;

/** Sellable to customers: active carrier (D-SUS-01), bookable status, not departed. */
export function sellableTripWhere(extra: Prisma.TripWhereInput = {}): Prisma.TripWhereInput {
  return {
    isActive: true,
    status: { in: BOOKABLE_TRIP_STATUSES },
    departureAt: { gt: new Date() },
    company: { status: TransportCompanyStatus.ACTIVE },
    ...extra,
  };
}

export const customerTripsRepository = {
  searchRouteDay(params: { fromCityId: string; toCityId: string; from: Date; to: Date }) {
    const now = new Date();
    return getPrisma().trip.findMany({
      where: sellableTripWhere({
        departureAt: { gte: params.from > now ? params.from : now, lt: params.to },
        originStation: { cityId: params.fromCityId },
        destinationStation: { cityId: params.toCityId },
      }),
      include: tripViewInclude,
      orderBy: [{ departureAt: 'asc' }, { id: 'asc' }],
      take: SEARCH_SCAN_LIMIT,
    });
  },

  findSellableTrip(tripId: string, tx?: PrismaTx) {
    return (tx ?? getPrisma()).trip.findFirst({ where: sellableTripWhere({ id: tripId }), include: tripViewInclude });
  },

  /** Any trip (for showing a booked trip even after it departed or the carrier was suspended). */
  findTripView(tripId: string) {
    return getPrisma().trip.findUnique({ where: { id: tripId }, include: tripViewInclude });
  },

  listSeatsWithHolds(tripId: string, tx?: PrismaTx) {
    return (tx ?? getPrisma()).tripSeat.findMany({ where: { tripId }, include: { hold: true } });
  },

  findSeatsByLabels(tripId: string, labels: string[], tx: PrismaTx) {
    return tx.tripSeat.findMany({ where: { tripId, seatLabel: { in: labels } } });
  },

  async markSeatsHeld(seatIds: string[], tx: PrismaTx): Promise<number> {
    const r = await tx.tripSeat.updateMany({ where: { id: { in: seatIds }, status: TripSeatStatus.FREE }, data: { status: TripSeatStatus.HELD } });
    return r.count;
  },

  createHold(data: { tripSeatId: string; customerId: string; expiresAt: Date }, tx: PrismaTx) {
    return tx.seatHold.create({ data });
  },

  /** The customer's live holds on one trip (a new selection replaces them). */
  findCustomerHoldsOnTrip(customerId: string, tripId: string, tx: PrismaTx) {
    return tx.seatHold.findMany({ where: { customerId, tripSeat: { tripId } } });
  },

  findHold(holdId: string) {
    return getPrisma().seatHold.findUnique({ where: { id: holdId }, include: { tripSeat: true } });
  },

  async releaseHolds(holds: Array<{ id: string; tripSeatId: string }>, tx: PrismaTx) {
    if (holds.length === 0) return;
    await tx.tripSeat.updateMany({
      where: { id: { in: holds.map((h) => h.tripSeatId) }, status: TripSeatStatus.HELD },
      data: { status: TripSeatStatus.FREE },
    });
    await tx.seatHold.deleteMany({ where: { id: { in: holds.map((h) => h.id) } } });
  },

  upsertRecentSearch(data: { customerId: string; fromCityId: string; toCityId: string; travelDate: string; returnDate?: string; passengers: number }) {
    return getPrisma().recentSearch.upsert({
      where: { customerId_fromCityId_toCityId: { customerId: data.customerId, fromCityId: data.fromCityId, toCityId: data.toCityId } },
      create: { ...data, returnDate: data.returnDate ?? null },
      update: { travelDate: data.travelDate, returnDate: data.returnDate ?? null, passengers: data.passengers, searchedAt: new Date() },
    });
  },

  listRecentSearches(customerId: string, take: number) {
    return getPrisma().recentSearch.findMany({
      where: { customerId },
      include: {
        fromCity: { select: { id: true, code: true, nameAr: true, nameEn: true } },
        toCity: { select: { id: true, code: true, nameAr: true, nameEn: true } },
      },
      orderBy: { searchedAt: 'desc' },
      take,
    });
  },

  deleteRecentSearches(customerId: string) {
    return getPrisma().recentSearch.deleteMany({ where: { customerId } });
  },
};
