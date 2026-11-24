import { TripSeatStatus, type Prisma, type SeatHold, type TripSeat } from '@prisma/client';
import { compareSeatLabels } from '../../shared/utils/money';
import { seatLayoutSchema } from '../../shared/utils/seat-layout';

/**
 * Presentation of a structured trip for the apps (customer and broker): carrier card, stations,
 * times, stops, amenities and the seat map. One shape for every channel so the apps share UI.
 */
const stationSelect = {
  id: true,
  nameAr: true,
  nameEn: true,
  city: { select: { id: true, code: true, nameAr: true, nameEn: true } },
} as const;

export const tripViewInclude = {
  company: {
    select: { id: true, key: true, name: true, shortName: true, legalName: true, logoUrl: true, ratingAvgX100: true, ratingCount: true, cashEnabled: true, status: true },
  },
  originStation: { select: stationSelect },
  destinationStation: { select: stationSelect },
  vehicle: {
    select: {
      id: true,
      model: true,
      seatLayout: true,
      amenities: { include: { amenity: true } },
    },
  },
  stops: { orderBy: { sequence: 'asc' }, include: { station: { select: stationSelect } } },
} satisfies Prisma.TripInclude;

export type TripViewRow = Prisma.TripGetPayload<{ include: typeof tripViewInclude }>;

export type SeatCounts = Record<TripSeatStatus, number>;

type StationRow = NonNullable<TripViewRow['originStation']>;

function station(s: StationRow | null, fallbackCity: string) {
  if (!s) return { station: null, city: { id: null, code: null, nameAr: fallbackCity, nameEn: fallbackCity } };
  return { station: { id: s.id, nameAr: s.nameAr, nameEn: s.nameEn }, city: s.city };
}

export function carrierView(c: TripViewRow['company']) {
  return {
    id: c.id,
    name: c.shortName ?? c.name,
    legalName: c.legalName ?? c.name,
    logoUrl: c.logoUrl,
    rating: { average: c.ratingCount > 0 ? c.ratingAvgX100 / 100 : null, count: c.ratingCount },
  };
}

export function amenitiesView(t: TripViewRow) {
  return (t.vehicle?.amenities ?? [])
    .map((a) => ({ code: a.amenity.code, nameAr: a.amenity.nameAr, nameEn: a.amenity.nameEn, icon: a.amenity.icon, value: a.value, sortOrder: a.amenity.sortOrder }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))
    .map(({ sortOrder: _s, ...rest }) => rest);
}

export function durationMinutes(t: { departureAt: Date; arrivalAt: Date | null }): number | null {
  return t.arrivalAt ? Math.round((t.arrivalAt.getTime() - t.departureAt.getTime()) / 60_000) : null;
}

/** Result-card fields (search lists). */
export function toTripCardView(t: TripViewRow, counts: SeatCounts | undefined) {
  const c = counts ?? { FREE: 0, HELD: 0, SOLD: 0 };
  return {
    id: t.id,
    tripNumber: t.tripNumber,
    status: t.status,
    carrier: carrierView(t.company),
    serviceClass: t.serviceClass,
    departureAt: t.departureAt.toISOString(),
    arrivalAt: t.arrivalAt?.toISOString() ?? null,
    durationMinutes: durationMinutes(t),
    origin: station(t.originStation, t.origin),
    destination: station(t.destinationStation, t.destination),
    isDirect: t.stops.length === 0,
    stopsCount: t.stops.length,
    seatsAvailable: c.FREE,
    seatsTotal: c.FREE + c.HELD + c.SOLD,
    amenities: amenitiesView(t).map((a) => a.code),
    priceMinor: t.basePrice,
    currency: 'SDG' as const,
  };
}

/** Trip detail: card + ordered stops timeline + full amenities + vehicle model. */
export function toTripDetailView(t: TripViewRow, counts: SeatCounts | undefined) {
  const origin = station(t.originStation, t.origin);
  const destination = station(t.destinationStation, t.destination);
  return {
    ...toTripCardView(t, counts),
    amenities: amenitiesView(t),
    vehicleModel: t.vehicle?.model ?? null,
    stops: [
      { sequence: 0, kind: 'ORIGIN' as const, ...origin, scheduledAt: t.departureAt.toISOString() },
      ...t.stops.map((s) => ({
        /** Intermediate stop id (driver «وصلت المحطة»: POST /driver/trips/:id/stops/:stopId). */
        id: s.id,
        sequence: s.sequence,
        kind: 'STOP' as const,
        station: { id: s.station.id, nameAr: s.station.nameAr, nameEn: s.station.nameEn },
        city: s.station.city,
        scheduledAt: (s.scheduledArrivalAt ?? s.scheduledDepartureAt)?.toISOString() ?? null,
        arrivedAt: s.actualArrivalAt?.toISOString() ?? null,
        departedAt: s.actualDepartureAt?.toISOString() ?? null,
      })),
      { sequence: t.stops.length + 1, kind: 'DESTINATION' as const, ...destination, scheduledAt: t.arrivalAt?.toISOString() ?? null },
    ],
  };
}

export type SeatWithHold = TripSeat & { hold: SeatHold | null };

/**
 * Seat map: grid from the vehicle layout plus each seat's state. `isMine(hold)` marks seats the
 * caller holds (customer or broker employee) so the app can restore a selection.
 */
export function toSeatMapView(t: TripViewRow, seats: SeatWithHold[], isMine: (hold: SeatHold) => boolean) {
  const parsed = t.vehicle ? seatLayoutSchema.safeParse(t.vehicle.seatLayout) : null;
  const layout = parsed?.success
    ? { rows: parsed.data.rows, columns: parsed.data.columns, aisleAfterColumn: parsed.data.aisleAfterColumn, driverSide: parsed.data.driverSide }
    : null;
  const sorted = [...seats].sort((a, b) => a.sortOrder - b.sortOrder || compareSeatLabels(a.seatLabel, b.seatLabel));
  const now = Date.now();
  return {
    tripId: t.id,
    layout,
    seats: sorted.map((s) => {
      const mine = s.status === TripSeatStatus.HELD && s.hold !== null && isMine(s.hold);
      return {
        id: s.id,
        label: s.seatLabel,
        row: s.layoutRow,
        column: s.layoutColumn,
        isWomenOnly: s.isWomenOnly,
        state: s.status === TripSeatStatus.FREE ? 'AVAILABLE' : s.status === TripSeatStatus.HELD ? 'HELD' : 'SOLD',
        heldByMe: mine,
        ...(mine ? { holdId: s.hold!.id, holdExpiresAt: s.hold!.expiresAt.toISOString(), remainingSeconds: Math.max(0, Math.floor((s.hold!.expiresAt.getTime() - now) / 1000)) } : {}),
      };
    }),
  };
}
