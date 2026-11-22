import { TripStatus, type Prisma } from '@prisma/client';
import { getPrisma } from '../../infrastructure/database/prisma';
import { AppError } from '../../shared/errors/app-error';

const stationSelect = {
  id: true,
  nameAr: true,
  nameEn: true,
  latitude: true,
  longitude: true,
  city: { select: { id: true, code: true, nameAr: true, nameEn: true } },
} as const;

const liveInclude = {
  company: { select: { id: true, name: true, shortName: true } },
  originStation: { select: stationSelect },
  destinationStation: { select: stationSelect },
  stops: { orderBy: { sequence: 'asc' }, include: { station: { select: stationSelect } } },
  vehicle: { select: { id: true, plateNumber: true, model: true } },
  driver: { select: { id: true, displayName: true, driverCode: true } },
} satisfies Prisma.TripInclude;

type LiveTripRow = Prisma.TripGetPayload<{ include: typeof liveInclude }>;
type StationRow = NonNullable<LiveTripRow['originStation']>;

export const LIVE_STATUSES: TripStatus[] = [TripStatus.BOARDING, TripStatus.IN_PROGRESS];

const num = (d: { toString(): string } | null | undefined) => (d === null || d === undefined ? null : Number(d.toString()));

/** Great-circle distance in km. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function point(s: StationRow | null) {
  const lat = num(s?.latitude);
  const lng = num(s?.longitude);
  return lat !== null && lng !== null ? { lat, lng } : null;
}

/**
 * Live trip state (API_CONVENTIONS §12: polled). Progress and ETA come from the schedule shifted
 * by the actual start delay; distance from the last GPS fix (D-GPS-01) when stations have coordinates.
 */
export class TrackingService {
  findLiveTrip(tripId: string) {
    return getPrisma().trip.findUnique({ where: { id: tripId }, include: liveInclude });
  }

  async view(trip: LiveTripRow) {
    const last = await getPrisma().vehiclePosition.findFirst({ where: { tripId: trip.id }, orderBy: { recordedAt: 'desc' } });
    const now = Date.now();
    const scheduledArrival = (trip.arrivalAt ?? trip.departureAt).getTime();
    const delayMs = trip.startedAt ? Math.max(0, trip.startedAt.getTime() - trip.departureAt.getTime()) : Math.max(0, now - trip.departureAt.getTime());
    const etaMs = trip.status === TripStatus.COMPLETED ? trip.completedAt?.getTime() ?? scheduledArrival : scheduledArrival + delayMs;
    const durationMs = Math.max(1, scheduledArrival - trip.departureAt.getTime());
    const progress =
      trip.status === TripStatus.COMPLETED
        ? 100
        : trip.status === TripStatus.IN_PROGRESS && trip.startedAt
          ? Math.min(99, Math.max(0, Math.round(((now - trip.startedAt.getTime()) / durationMs) * 100)))
          : 0;

    const timeline = [
      { kind: 'ORIGIN' as const, station: trip.originStation, scheduledAt: trip.departureAt, actualAt: trip.startedAt },
      ...trip.stops.map((s) => ({
        kind: 'STOP' as const,
        stopId: s.id,
        station: s.station,
        scheduledAt: s.scheduledArrivalAt ?? s.scheduledDepartureAt,
        actualAt: s.actualArrivalAt,
      })),
      { kind: 'DESTINATION' as const, station: trip.destinationStation, scheduledAt: trip.arrivalAt, actualAt: trip.completedAt },
    ];
    const nextIdx =
      trip.status === TripStatus.COMPLETED ? -1 : trip.status === TripStatus.IN_PROGRESS ? timeline.findIndex((t, i) => i > 0 && !t.actualAt) : 0;

    const destination = point(trip.destinationStation);
    const position = last ? { lat: num(last.latitude)!, lng: num(last.longitude)! } : null;
    return {
      tripId: trip.id,
      tripNumber: trip.tripNumber,
      status: trip.status,
      carrier: { id: trip.company.id, name: trip.company.shortName ?? trip.company.name },
      vehicle: trip.vehicle,
      driver: trip.driver ? { id: trip.driver.id, displayName: trip.driver.displayName, driverCode: trip.driver.driverCode } : null,
      position: last
        ? { ...position!, speedKmh: last.speedKmh, heading: last.heading, recordedAt: last.recordedAt.toISOString(), ageSeconds: Math.round((now - last.recordedAt.getTime()) / 1000) }
        : null,
      progressPercent: progress,
      remainingKm: position && destination && trip.status === TripStatus.IN_PROGRESS ? Math.round(haversineKm(position, destination)) : null,
      etaAt: new Date(etaMs).toISOString(),
      delayMinutes: Math.round(delayMs / 60_000),
      nextStop:
        nextIdx >= 0 && timeline[nextIdx]?.station
          ? { kind: timeline[nextIdx]!.kind, nameAr: timeline[nextIdx]!.station!.nameAr, nameEn: timeline[nextIdx]!.station!.nameEn, city: timeline[nextIdx]!.station!.city }
          : null,
      timeline: timeline.map((t) => ({
        kind: t.kind,
        ...('stopId' in t ? { stopId: t.stopId } : {}),
        station: t.station ? { id: t.station.id, nameAr: t.station.nameAr, nameEn: t.station.nameEn, city: t.station.city, ...(point(t.station) ?? {}) } : null,
        scheduledAt: t.scheduledAt?.toISOString() ?? null,
        actualAt: t.actualAt?.toISOString() ?? null,
        passed: t.actualAt !== null,
      })),
      pollSeconds: 15,
    };
  }

  async viewById(tripId: string) {
    const trip = await this.findLiveTrip(tripId);
    if (!trip) throw AppError.notFound('Trip not found');
    return this.view(trip);
  }

  /** Admin live board: every trip boarding or on the road, with its latest fix. */
  async activeTrips() {
    const trips = await getPrisma().trip.findMany({ where: { status: { in: LIVE_STATUSES } }, include: liveInclude, orderBy: { departureAt: 'asc' }, take: 200 });
    return Promise.all(trips.map((t) => this.view(t)));
  }

  async trail(tripId: string, limit = 500) {
    const rows = await getPrisma().vehiclePosition.findMany({ where: { tripId }, orderBy: { recordedAt: 'desc' }, take: limit });
    return rows.reverse().map((p) => ({ lat: num(p.latitude), lng: num(p.longitude), speedKmh: p.speedKmh, recordedAt: p.recordedAt.toISOString() }));
  }
}

export const trackingService = new TrackingService();
