import { env } from '../../config/env';
import { getPrisma } from '../../infrastructure/database/prisma';
import { AppError } from '../../shared/errors/app-error';
import { assertNotInMaintenance, runtimeSettings } from '../../shared/settings/runtime-settings';
import { compareSeatLabels } from '../../shared/utils/money';
import { paginationMeta, parsePagination } from '../../shared/utils/pagination';
import { zonedDayRange } from '../../shared/utils/timezone';
import { catalogRepository } from '../catalog/catalog.repository';
import { CatalogErrors } from '../catalog/catalog.errors';
import { catalogService } from '../catalog/catalog.service';
import { amenitiesView, durationMinutes, toSeatMapView, toTripCardView, toTripDetailView, type TripViewRow } from '../catalog/trip-view';
import { customerTripsRepository } from './customer-trips.repository';

export type TripSort = 'recommended' | 'departureAt' | 'priceMinor' | 'durationMinutes';

export interface TripSearchQuery {
  fromCityId: string;
  toCityId: string;
  date: string;
  returnDate?: string;
  passengers?: number;
  sort?: TripSort;
  carrierId?: string[];
  amenity?: string[];
  serviceClass?: 'STANDARD' | 'VIP';
  departureFrom?: string;
  departureTo?: string;
  priceMaxMinor?: number;
  page?: number;
  pageSize?: number;
}

export const MAX_SEATS_PER_HOLD = 10;

const DEPARTURE_WINDOWS = [
  { key: 'MORNING', from: '05:00', to: '12:00' },
  { key: 'AFTERNOON', from: '12:00', to: '17:00' },
  { key: 'EVENING', from: '17:00', to: '21:00' },
  { key: 'NIGHT', from: '21:00', to: '05:00' },
] as const;

function localTime(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: env().PLATFORM_TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false })
    .format(d)
    .replace(/^24/, '00');
}

/** Inclusive start, exclusive end; windows may wrap midnight (from > to). */
function inWindow(hhmm: string, from?: string, to?: string): boolean {
  if (!from && !to) return true;
  const f = from ?? '00:00';
  const t = to ?? '24:00';
  return f <= t ? hhmm >= f && hhmm < t : hhmm >= f || hhmm < t;
}

export class CustomerTripsService {
  /** Trips of one route on one Sudan day with seat counts; the base of search and filters. */
  private async routeDay(q: TripSearchQuery) {
    if (q.fromCityId === q.toCityId) throw AppError.validation('From and to cities must differ', { field: 'toCityId' });
    const { from, to } = zonedDayRange(q.date, env().PLATFORM_TIMEZONE);
    await catalogService.releaseExpiredHolds();
    const trips = await customerTripsRepository.searchRouteDay({ fromCityId: q.fromCityId, toCityId: q.toCityId, from, to });
    const counts = await catalogRepository.seatCountsByTrip(trips.map((t) => t.id));
    const passengers = q.passengers ?? 1;
    return trips
      .map((t) => ({ trip: t, counts: counts.get(t.id) }))
      .filter((r) => (r.counts?.FREE ?? 0) >= passengers);
  }

  private applyFilters<T extends { trip: TripViewRow }>(rows: T[], q: TripSearchQuery): T[] {
    return rows.filter(({ trip }) => {
      if (q.carrierId?.length && !q.carrierId.includes(trip.companyId)) return false;
      if (q.serviceClass && trip.serviceClass !== q.serviceClass) return false;
      if (q.priceMaxMinor !== undefined && trip.basePrice > q.priceMaxMinor) return false;
      if (!inWindow(localTime(trip.departureAt), q.departureFrom, q.departureTo)) return false;
      if (q.amenity?.length) {
        const codes = new Set(amenitiesView(trip).map((a) => a.code));
        if (!q.amenity.every((a) => codes.has(a))) return false;
      }
      return true;
    });
  }

  async search(customerId: string, q: TripSearchQuery) {
    const rows = this.applyFilters(await this.routeDay(q), q);
    const sort = q.sort ?? 'recommended';
    const key = (t: TripViewRow): number =>
      sort === 'priceMinor' ? t.basePrice : sort === 'durationMinutes' ? durationMinutes(t) ?? Number.MAX_SAFE_INTEGER : t.departureAt.getTime();
    rows.sort((a, b) => {
      if (sort === 'recommended') {
        // Highest-rated carriers first within the day, then earliest departure.
        const r = b.trip.company.ratingAvgX100 - a.trip.company.ratingAvgX100;
        if (r !== 0) return r;
      }
      return key(a.trip) - key(b.trip) || a.trip.departureAt.getTime() - b.trip.departureAt.getTime();
    });

    const { page, pageSize, skip, take } = parsePagination(q);
    const items = rows.slice(skip, skip + take).map((r) => toTripCardView(r.trip, r.counts));

    // Saved server-side so recent searches survive a reinstall (best effort).
    await customerTripsRepository
      .upsertRecentSearch({
        customerId,
        fromCityId: q.fromCityId,
        toCityId: q.toCityId,
        travelDate: q.date,
        ...(q.returnDate ? { returnDate: q.returnDate } : {}),
        passengers: q.passengers ?? 1,
      })
      .catch(() => undefined);

    return { items, meta: paginationMeta(page, pageSize, rows.length) };
  }

  /** Filter-sheet data computed from the unfiltered results of the same route/day. */
  async filters(q: TripSearchQuery) {
    const rows = await this.routeDay(q);
    const carriers = new Map<string, { id: string; name: string; logoUrl: string | null; tripsCount: number }>();
    const amenities = new Map<string, { code: string; nameAr: string; nameEn: string; icon: string }>();
    const classes = new Set<string>();
    const windows = Object.fromEntries(DEPARTURE_WINDOWS.map((w) => [w.key, 0])) as Record<string, number>;
    let min = Number.MAX_SAFE_INTEGER;
    let max = 0;
    for (const { trip } of rows) {
      const c = carriers.get(trip.companyId);
      if (c) c.tripsCount += 1;
      else carriers.set(trip.companyId, { id: trip.companyId, name: trip.company.shortName ?? trip.company.name, logoUrl: trip.company.logoUrl, tripsCount: 1 });
      for (const a of amenitiesView(trip)) amenities.set(a.code, { code: a.code, nameAr: a.nameAr, nameEn: a.nameEn, icon: a.icon });
      classes.add(trip.serviceClass);
      min = Math.min(min, trip.basePrice);
      max = Math.max(max, trip.basePrice);
      const hhmm = localTime(trip.departureAt);
      const w = DEPARTURE_WINDOWS.find((x) => inWindow(hhmm, x.from, x.to));
      if (w) windows[w.key]! += 1;
    }
    return {
      total: rows.length,
      carriers: [...carriers.values()].sort((a, b) => a.name.localeCompare(b.name)),
      priceRange: rows.length ? { minMinor: min, maxMinor: max } : null,
      amenities: [...amenities.values()].sort((a, b) => a.code.localeCompare(b.code)),
      serviceClasses: [...classes].sort(),
      departureWindows: DEPARTURE_WINDOWS.map((w) => ({ key: w.key, from: w.from, to: w.to, tripsCount: windows[w.key] })),
    };
  }

  async detail(tripId: string) {
    await catalogService.releaseExpiredHolds(tripId);
    const trip = await customerTripsRepository.findSellableTrip(tripId);
    if (!trip) throw CatalogErrors.tripNotFound();
    const counts = await catalogRepository.seatCountsByTrip([trip.id]);
    return { ...toTripDetailView(trip, counts.get(trip.id)), cashAvailable: runtimeSettings.boolean('cash.enabled') && trip.company.cashEnabled };
  }

  async seats(customerId: string, tripId: string) {
    await catalogService.releaseExpiredHolds(tripId);
    const trip = await customerTripsRepository.findSellableTrip(tripId);
    if (!trip) throw CatalogErrors.tripNotFound();
    const seats = await customerTripsRepository.listSeatsWithHolds(trip.id);
    return toSeatMapView(trip, seats, (h) => h.customerId === customerId);
  }

  /**
   * Holds the selected seats for this customer. A new selection on the same trip replaces the
   * previous one, so one customer never blocks more than one selection per trip.
   */
  async hold(customerId: string, tripId: string, seatLabels: string[]) {
    assertNotInMaintenance();
    const labels = [...new Set(seatLabels.map((l) => l.trim()))];
    if (labels.length !== seatLabels.length) throw AppError.validation('Duplicate seat labels', { field: 'seatLabels' });
    const ttlMs = runtimeSettings.number('booking.seatHoldTtlSeconds') * 1000;

    const created = await getPrisma().$transaction(async (tx) => {
      await catalogRepository.releaseExpiredHolds(tripId, tx);
      const trip = await customerTripsRepository.findSellableTrip(tripId, tx);
      if (!trip) throw CatalogErrors.tripNotFound();

      await customerTripsRepository.releaseHolds(await customerTripsRepository.findCustomerHoldsOnTrip(customerId, tripId, tx), tx);

      const seats = await customerTripsRepository.findSeatsByLabels(trip.id, labels, tx);
      if (seats.length !== labels.length) throw CatalogErrors.seatNotFound();
      const updated = await customerTripsRepository.markSeatsHeld(seats.map((s) => s.id), tx);
      if (updated !== seats.length) {
        throw CatalogErrors.seatUnavailable({ unavailableSeatLabels: seats.filter((s) => s.status !== 'FREE').map((s) => s.seatLabel) });
      }
      const expiresAt = new Date(Date.now() + ttlMs);
      const out = [];
      for (const seat of seats) {
        const hold = await customerTripsRepository.createHold({ tripSeatId: seat.id, customerId, expiresAt }, tx);
        out.push({ hold, seat });
      }
      return out;
    });

    const expiresAt = created[0]!.hold.expiresAt;
    return {
      tripId,
      expiresAt: expiresAt.toISOString(),
      remainingSeconds: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)),
      holds: created
        .sort((a, b) => compareSeatLabels(a.seat.seatLabel, b.seat.seatLabel))
        .map(({ hold, seat }) => ({ id: hold.id, seatLabel: seat.seatLabel, isWomenOnly: seat.isWomenOnly })),
    };
  }

  async releaseHold(customerId: string, holdId: string) {
    const hold = await customerTripsRepository.findHold(holdId);
    if (!hold || hold.customerId !== customerId) throw CatalogErrors.holdNotFound();
    await getPrisma().$transaction((tx) => customerTripsRepository.releaseHolds([hold], tx));
    return { holdId, released: true };
  }

  async recentSearches(customerId: string) {
    const rows = await customerTripsRepository.listRecentSearches(customerId, 10);
    return rows.map((r) => ({
      id: r.id,
      fromCity: r.fromCity,
      toCity: r.toCity,
      travelDate: r.travelDate,
      returnDate: r.returnDate,
      passengers: r.passengers,
      searchedAt: r.searchedAt.toISOString(),
    }));
  }

  async clearRecentSearches(customerId: string) {
    await customerTripsRepository.deleteRecentSearches(customerId);
    return { cleared: true };
  }
}

export const customerTripsService = new CustomerTripsService();
