import { randomUUID } from 'node:crypto';
import { IdentityType, ServiceClass, TripStatus, type Prisma } from '@prisma/client';
import { env } from '../config/env';
import { getPrisma } from '../infrastructure/database/prisma';
import { logger } from '../infrastructure/observability/logger';
import { customerCheckoutService } from '../modules/customer-app/customer-checkout.service';
import { customerTripsService } from '../modules/customer-app/customer-trips.service';
import { driverTripsService } from '../modules/driver-app/driver-trips.service';
import { networkService } from '../modules/network/network.service';
import { setPrincipalAuthzVersion } from '../shared/security/principal-authz-cache';
import { runtimeSettings } from '../shared/settings/runtime-settings';
import { normalizePhone } from '../shared/utils/phone';
import { buildNumberedLayout } from '../shared/utils/seat-layout';
import { calendarDateInZone, zonedDayRange } from '../shared/utils/timezone';

/**
 * Development/staging only — the "demo world" app testers use (D-DEMO-01).
 *
 * Four carriers, eleven buses with their drivers, and routes from Khartoum to Port Sudan, Atbara,
 * Wad Madani, Kosti, Kassala, Gedaref, El Obeid and Dongola. Every bus shuttles out and back on
 * its line around the clock (1 h turnaround, no departures 00:00–05:00 Sudan time), starting
 * ~45 minutes from now, so every driver always has a trip inside the boarding window. Trips
 * that departed hours ago and never ran (nobody booked) are cancelled so they do not block the
 * bus. Trips in the next 30 hours get demo passengers (online and cash) so manifests, scanning
 * and cash collection can be tried at once.
 *
 * Everything goes through the normal services (scheduling, holds, checkout, mock payment).
 * Runs from `npm run db:demo` and hourly in the server when DEMO_SCHEDULE_DAYS > 0.
 */

type CityCode = 'KRT' | 'PZU' | 'KSL' | 'ATB' | 'SHD' | 'MWE' | 'WDM' | 'GDR' | 'KST' | 'EBD' | 'DOG';

interface BusDef {
  plate: string;
  model: string;
  cls: ServiceClass;
  rows: number;
  amenities: string[];
  driver: { phone: string; name: string; code: string; license: string };
}

interface LineDef {
  out: string;
  back: string;
  from: CityCode;
  to: CityCode;
  durationMinutes: number;
  /** Intermediate stops on the way out: [city, offset from departure, dwell]. */
  stops: Array<[CityCode, number, number]>;
  priceMinor: number;
  buses: BusDef[];
}

interface CarrierDef {
  key: string;
  name: string;
  shortName: string;
  legalName: string;
  cashEnabled: boolean;
  manager: { phone: string; name: string };
  lines: LineDef[];
}

const VIP = ['wifi', 'ac', 'usb', 'snack', 'tv', 'vip_seats', 'luggage'];
const STD = ['ac', 'usb', 'luggage'];

const bus = (plate: string, model: string, cls: ServiceClass, driver: BusDef['driver']): BusDef => ({
  plate,
  model,
  cls,
  rows: cls === ServiceClass.VIP ? 7 : 10,
  amenities: cls === ServiceClass.VIP ? VIP : STD,
  driver,
});

export const DEMO_CARRIERS: CarrierDef[] = [
  {
    key: 'sudan_express',
    name: 'سودان إكسبريس',
    shortName: 'سودان إكسبريس',
    legalName: 'شركة سودان إكسبريس للنقل البري',
    cashEnabled: true,
    manager: { phone: '+249900000401', name: 'مدير سودان إكسبريس' },
    lines: [
      {
        out: 'KRT-PZU', back: 'PZU-KRT', from: 'KRT', to: 'PZU', durationMinutes: 720, priceMinor: 3_500_000,
        stops: [['SHD', 180, 15], ['ATB', 300, 30]],
        buses: [
          bus('خ ر ط 1234', 'Toyota Coaster', ServiceClass.VIP, { phone: '+249900000201', name: 'أحمد محمد سليمان', code: 'ZGD-0001', license: 'DL-7649' }),
          bus('خ ر ط 5678', 'Toyota Coaster', ServiceClass.VIP, { phone: '+249900000202', name: 'عثمان الطيب', code: 'ZGD-0002', license: 'DL-8812' }),
        ],
      },
      {
        out: 'KRT-ATB', back: 'ATB-KRT', from: 'KRT', to: 'ATB', durationMinutes: 300, priceMinor: 1_800_000,
        stops: [['SHD', 180, 15]],
        buses: [bus('خ ر ط 2468', 'Hyundai County', ServiceClass.STANDARD, { phone: '+249900000203', name: 'ياسر عبد الله', code: 'ZGD-0003', license: 'DL-5531' })],
      },
    ],
  },
  {
    key: 'nile_transport',
    name: 'النيل للنقل',
    shortName: 'النيل للنقل',
    legalName: 'شركة النيل للنقل والسياحة',
    cashEnabled: true,
    manager: { phone: '+249900000402', name: 'مدير النيل للنقل' },
    lines: [
      {
        out: 'KRT-WDM', back: 'WDM-KRT', from: 'KRT', to: 'WDM', durationMinutes: 180, priceMinor: 1_200_000, stops: [],
        buses: [
          bus('ج ز ر 3101', 'Toyota Coaster', ServiceClass.VIP, { phone: '+249900000204', name: 'محمد الأمين بابكر', code: 'ZGD-0004', license: 'DL-3101' }),
          bus('ج ز ر 3102', 'King Long', ServiceClass.STANDARD, { phone: '+249900000205', name: 'الطاهر حسن', code: 'ZGD-0005', license: 'DL-3102' }),
        ],
      },
      {
        out: 'KRT-KST', back: 'KST-KRT', from: 'KRT', to: 'KST', durationMinutes: 240, priceMinor: 1_500_000, stops: [],
        buses: [bus('ج ز ر 3103', 'Hyundai County', ServiceClass.STANDARD, { phone: '+249900000206', name: 'عبد الرحيم النور', code: 'ZGD-0006', license: 'DL-3103' })],
      },
    ],
  },
  {
    key: 'east_express',
    name: 'الشرق السريع',
    shortName: 'الشرق السريع',
    legalName: 'شركة الشرق السريع للنقل',
    cashEnabled: true,
    manager: { phone: '+249900000403', name: 'مدير الشرق السريع' },
    lines: [
      {
        out: 'KRT-KSL', back: 'KSL-KRT', from: 'KRT', to: 'KSL', durationMinutes: 480, priceMinor: 3_000_000,
        stops: [['WDM', 180, 20], ['GDR', 340, 20]],
        buses: [
          bus('ك س ل 4401', 'Mercedes Travego', ServiceClass.VIP, { phone: '+249900000207', name: 'آدم إسحاق', code: 'ZGD-0007', license: 'DL-4401' }),
          bus('ك س ل 4402', 'King Long', ServiceClass.STANDARD, { phone: '+249900000208', name: 'إبراهيم موسى', code: 'ZGD-0008', license: 'DL-4402' }),
        ],
      },
      {
        out: 'KRT-GDR', back: 'GDR-KRT', from: 'KRT', to: 'GDR', durationMinutes: 360, priceMinor: 2_500_000,
        stops: [['WDM', 180, 20]],
        buses: [bus('ك س ل 4403', 'Hyundai County', ServiceClass.STANDARD, { phone: '+249900000209', name: 'صلاح الدين عمر', code: 'ZGD-0009', license: 'DL-4403' })],
      },
    ],
  },
  {
    key: 'alburaq',
    name: 'البراق',
    shortName: 'البراق',
    legalName: 'شركة البراق للنقل البري',
    // Online-only carrier: lets testers see «الدفع نقدًا غير متاح».
    cashEnabled: false,
    manager: { phone: '+249900000404', name: 'مدير البراق' },
    lines: [
      {
        out: 'KRT-EBD', back: 'EBD-KRT', from: 'KRT', to: 'EBD', durationMinutes: 480, priceMinor: 3_200_000,
        stops: [['KST', 240, 20]],
        buses: [bus('ش م ل 5501', 'Mercedes Travego', ServiceClass.VIP, { phone: '+249900000210', name: 'حامد يوسف', code: 'ZGD-0010', license: 'DL-5501' })],
      },
      {
        out: 'KRT-DOG', back: 'DOG-KRT', from: 'KRT', to: 'DOG', durationMinutes: 450, priceMinor: 3_400_000,
        stops: [['MWE', 330, 20]],
        buses: [bus('ش م ل 5502', 'Toyota Coaster', ServiceClass.VIP, { phone: '+249900000211', name: 'مصطفى خالد', code: 'ZGD-0011', license: 'DL-5502' })],
      },
    ],
  },
];

/** Demo passengers who book the seeded seats (+249900000310 …). */
const DEMO_CUSTOMERS: Array<{ name: string; gender: 'MALE' | 'FEMALE' }> = [
  { name: 'محمد عبد الله أحمد', gender: 'MALE' },
  { name: 'فاطمة الزهراء علي', gender: 'FEMALE' },
  { name: 'عمر حسن إبراهيم', gender: 'MALE' },
  { name: 'آمنة محمد صالح', gender: 'FEMALE' },
  { name: 'خالد الطيب مصطفى', gender: 'MALE' },
  { name: 'مريم عثمان يوسف', gender: 'FEMALE' },
  { name: 'يوسف آدم موسى', gender: 'MALE' },
  { name: 'سارة النور بابكر', gender: 'FEMALE' },
  { name: 'أحمد إسماعيل حامد', gender: 'MALE' },
  { name: 'هبة عبد الرحمن', gender: 'FEMALE' },
  { name: 'الطاهر محمد الحسن', gender: 'MALE' },
  { name: 'نسرين عوض الكريم', gender: 'FEMALE' },
  { name: 'عبد الرحيم صديق', gender: 'MALE' },
  { name: 'رانيا الفاتح', gender: 'FEMALE' },
  { name: 'مصعب جعفر', gender: 'MALE' },
  { name: 'إيمان الصادق', gender: 'FEMALE' },
  { name: 'بكري عبد القادر', gender: 'MALE' },
  { name: 'سلمى حمد النيل', gender: 'FEMALE' },
  { name: 'معتز الأمين', gender: 'MALE' },
  { name: 'ندى كمال الدين', gender: 'FEMALE' },
];

const DEMO_OFFICE_NAME = 'مكتب زول قو - الخرطوم';
const MIN = 60_000;
const HOUR = 60 * MIN;
const TURNAROUND = HOUR;
const FIRST_DEPARTURE_AFTER = 45 * MIN;
const NIGHT_END_HOUR = 5; // no departures between 00:00 and 05:00 Sudan time
const SEED_WINDOW = 30 * HOUR;
const SEED_TRIPS_PER_RUN = 12;

const roundUp = (t: number, step = 30 * MIN) => Math.ceil(t / step) * step;
const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;

async function ensureCarrier(def: CarrierDef) {
  const prisma = getPrisma();
  const company = await prisma.transportCompany.upsert({
    where: { key: def.key },
    create: { key: def.key, name: def.name, shortName: def.shortName, legalName: def.legalName, cashEnabled: def.cashEnabled },
    update: { name: def.name, shortName: def.shortName, legalName: def.legalName, cashEnabled: def.cashEnabled },
  });
  const phone = normalizePhone(def.manager.phone);
  if (!(await prisma.carrierIdentity.findUnique({ where: { type_valueNormalized: { type: IdentityType.PHONE, valueNormalized: phone } } }))) {
    await prisma.carrierEmployee.create({
      data: {
        companyId: company.id,
        displayName: def.manager.name,
        role: 'MANAGER',
        canManageFleet: true,
        canManageSchedule: true,
        canViewFinance: true,
        canManageStaff: true,
        identities: { create: { type: IdentityType.PHONE, valueNormalized: phone, isPrimary: true, verifiedAt: new Date() } },
      },
    });
  }
  // The demo broker office sells every demo carrier.
  const office = await prisma.brokerOffice.findUnique({ where: { code: 'ZG-BRK-1' } });
  if (office) {
    await prisma.brokerCarrierAssignment.upsert({
      where: { officeId_companyId: { officeId: office.id, companyId: company.id } },
      create: { officeId: office.id, companyId: company.id, commissionPercent: 10 },
      update: {},
    });
  }
  return company;
}

async function ensureRoute(companyId: string, code: string, from: string, to: string, durationMinutes: number, stops: Array<[string, number, number]>) {
  const prisma = getPrisma();
  const route =
    (await prisma.route.findFirst({ where: { companyId, code }, include: { stops: true } })) ??
    (await prisma.route.create({ data: { companyId, code, originStationId: from, destinationStationId: to, durationMinutes }, include: { stops: true } }));
  if (route.stops.length === 0 && stops.length > 0) {
    await prisma.routeStop.createMany({
      data: stops.map(([stationId, offsetMinutes, dwellMinutes], i) => ({ routeId: route.id, stationId, sequence: i + 1, offsetMinutes, dwellMinutes })),
    });
  }
  return route;
}

async function ensureBus(companyId: string, def: BusDef) {
  const prisma = getPrisma();
  let vehicle = await prisma.vehicle.findUnique({ where: { plateNumber: def.plate } });
  if (!vehicle) {
    const layout = buildNumberedLayout({ rows: def.rows, womenOnlyLabels: ['11', '12'] });
    vehicle = await prisma.vehicle.create({
      data: { companyId, plateNumber: def.plate, model: def.model, capacity: layout.seats.length, serviceClass: def.cls, seatLayout: layout as unknown as Prisma.InputJsonValue },
    });
    const amenities = await prisma.amenity.findMany({ where: { code: { in: def.amenities } } });
    await prisma.vehicleAmenity.createMany({
      data: amenities.map((a) => ({ vehicleId: vehicle!.id, amenityId: a.id, value: a.code === 'luggage' ? (def.cls === ServiceClass.VIP ? '30' : '20') : null })),
      skipDuplicates: true,
    });
  }

  const phone = normalizePhone(def.driver.phone);
  const identity = await prisma.driverIdentity.findUnique({ where: { type_valueNormalized: { type: IdentityType.PHONE, valueNormalized: phone } } });
  let driver = identity ? await prisma.driver.findUniqueOrThrow({ where: { id: identity.driverId } }) : null;
  if (!driver) {
    driver = await prisma.driver.create({
      data: {
        companyId,
        driverCode: def.driver.code,
        displayName: def.driver.name,
        licenseNumber: def.driver.license,
        licenseExpiry: new Date('2028-12-31T00:00:00.000Z'),
        identities: { create: { type: IdentityType.PHONE, valueNormalized: phone, isPrimary: true, verifiedAt: new Date() } },
      },
    });
    await setPrincipalAuthzVersion('driver', driver.id, driver.authzVersion);
  }
  return { vehicle, driver };
}

/** Departure hour in Sudan time (fixed offset from PLATFORM_TIMEZONE's day start). */
function skipNight(t: number, tz: string): number {
  const dayStart = zonedDayRange(calendarDateInZone(new Date(t), tz), tz).from.getTime();
  return t - dayStart < NIGHT_END_HOUR * HOUR ? dayStart + NIGHT_END_HOUR * HOUR : t;
}

/**
 * Fills a bus's timeline from ~45 minutes from now to the horizon, alternating out and back,
 * around trips it already has. Returns how many trips were created.
 */
async function scheduleBus(bus: { vehicleId: string; driverId: string }, out: { id: string; durationMinutes: number }, back: { id: string }, priceMinor: number, horizon: number, adminId: string) {
  const prisma = getPrisma();
  const tz = env().PLATFORM_TIMEZONE;
  const durationMs = out.durationMinutes * MIN;
  const now = Date.now();
  const existing = await prisma.trip.findMany({
    where: {
      status: { not: TripStatus.CANCELLED },
      OR: [{ vehicleId: bus.vehicleId }, { driverId: bus.driverId }],
      departureAt: { lt: new Date(horizon) },
    },
    orderBy: { departureAt: 'asc' },
    select: { departureAt: true, arrivalAt: true, routeId: true },
  });
  const busy = existing.map((t) => ({ from: t.departureAt.getTime(), to: (t.arrivalAt?.getTime() ?? t.departureAt.getTime() + durationMs) + TURNAROUND, routeId: t.routeId }));
  let lastRoute = [...busy].reverse().find((b) => b.from <= now)?.routeId ?? back.id;
  let cursor = roundUp(now + FIRST_DEPARTURE_AFTER);
  let created = 0;

  while (cursor < horizon) {
    cursor = skipNight(cursor, tz);
    const end = cursor + durationMs + TURNAROUND;
    const clash = busy.find((b) => b.from < end && b.to > cursor);
    if (clash) {
      cursor = roundUp(Math.max(cursor + 30 * MIN, clash.to));
      lastRoute = clash.routeId ?? lastRoute;
      continue;
    }
    const route = lastRoute === out.id ? back : out;
    try {
      await networkService.scheduleTrips({
        routeId: route.id,
        vehicleId: bus.vehicleId,
        driverId: bus.driverId,
        departures: [new Date(cursor)],
        basePrice: priceMinor,
        actorAdminId: adminId,
      });
      busy.push({ from: cursor, to: end, routeId: route.id });
      lastRoute = route.id;
      created += 1;
      cursor = roundUp(end);
    } catch (err) {
      logger.debug({ err, route: route.id }, 'Demo trip not scheduled');
      cursor += 30 * MIN;
    }
  }
  return created;
}

async function ensureCustomer(phoneRaw: string, name: string) {
  const prisma = getPrisma();
  const phone = normalizePhone(phoneRaw);
  const identity = await prisma.customerIdentity.findUnique({ where: { type_valueNormalized: { type: IdentityType.PHONE, valueNormalized: phone } } });
  if (identity) return identity.customerId;
  const c = await prisma.customer.create({
    data: { displayName: name, identities: { create: { type: IdentityType.PHONE, valueNormalized: phone, isPrimary: true, verifiedAt: new Date() } } },
  });
  return c.id;
}

/** Books 30–55 % of the seats of upcoming demo trips that have no bookings yet. */
async function seedPassengers(companyIds: string[]): Promise<number> {
  const prisma = getPrisma();
  const now = Date.now();
  const customers = [];
  for (const [i, c] of DEMO_CUSTOMERS.entries()) {
    customers.push({ ...c, id: await ensureCustomer(`+2499000003${String(10 + i).padStart(2, '0')}`, c.name), phone: `+2499000003${String(10 + i).padStart(2, '0')}` });
  }
  const trips = await prisma.trip.findMany({
    where: {
      companyId: { in: companyIds },
      status: TripStatus.SCHEDULED,
      departureAt: { gt: new Date(now + 20 * MIN), lt: new Date(now + SEED_WINDOW) },
      bookings: { none: {} },
    },
    orderBy: { departureAt: 'asc' },
    take: SEED_TRIPS_PER_RUN,
    include: { company: { select: { cashEnabled: true } }, seats: { where: { status: 'FREE' }, orderBy: { sortOrder: 'asc' } } },
  });

  let bookings = 0;
  for (const trip of trips) {
    const free = [...trip.seats];
    const target = Math.floor(free.length * (0.3 + Math.random() * 0.25));
    let sold = 0;
    let guard = 0;
    while (sold < target && free.length > 0 && guard++ < 40) {
      const buyer = pick(customers);
      const count = Math.random() < 0.3 ? 2 : 1;
      // Women-only seats go to women only.
      const seats = free.filter((s) => !s.isWomenOnly || buyer.gender === 'FEMALE').slice(0, count);
      if (seats.length === 0) continue;
      const companion = count === 2 ? pick(DEMO_CUSTOMERS.filter((c) => !seats[1]?.isWomenOnly || c.gender === 'FEMALE')) : null;
      try {
        const hold = await customerTripsService.hold(buyer.id, trip.id, seats.map((s) => s.seatLabel));
        const input = {
          holdIds: hold.holds.map((h) => h.id),
          passengers: [
            { fullName: buyer.name, gender: buyer.gender, phone: buyer.phone },
            ...(companion && seats.length > 1 ? [{ fullName: companion.name, gender: companion.gender }] : []),
          ],
        };
        const wantCash = trip.company.cashEnabled && Math.random() < 0.4;
        let res;
        try {
          res = await customerCheckoutService.create(buyer.id, { ...input, paymentMethod: wantCash ? 'CASH_ON_BOARD' : 'ONLINE', idempotencyKey: randomUUID() });
        } catch {
          // Cash refused (limits, too close to departure): pay online instead.
          res = await customerCheckoutService.create(buyer.id, { ...input, paymentMethod: 'ONLINE', idempotencyKey: randomUUID() });
        }
        if (res.payment && res.payment.status === 'PENDING') await customerCheckoutService.mockConfirm(buyer.id, res.payment.intentId);
        for (const s of seats) free.splice(free.indexOf(s), 1);
        sold += seats.length;
        bookings += 1;
      } catch (err) {
        logger.debug({ err, trip: trip.id }, 'Demo booking skipped');
        for (const s of seats) free.splice(free.indexOf(s), 1);
      }
    }
  }
  return bookings;
}

const SIMULATE_TRIPS_PER_RUN = 40;
const LEFTOVER_AFTER = 6 * HOUR;

/** Boards one ticket, collecting the cash fare when the booking is pay-on-board. */
async function boardDemoTicket(driverId: string, tripId: string, ticketNumber: string) {
  try {
    await driverTripsService.board(driverId, tripId, { ticketNumber, method: 'MANUAL' });
  } catch (err) {
    const cash = (err as { details?: { cashToCollectMinor?: number } }).details?.cashToCollectMinor;
    if (!cash) throw err;
    await driverTripsService.board(driverId, tripId, { ticketNumber, method: 'MANUAL', cashCollectedMinor: cash });
  }
}

/**
 * Plays the driver for demo trips nobody ran, so they do not sit in «القادمة» forever and the
 * completed tab, reports and settlements have history: trips that sold seats and should have
 * arrived by now are boarded (every cash passenger, ~90% of the online ones — cash no-shows would
 * cost the demo customers their cash eligibility), departed and completed through the real driver
 * service. Trips a tester left BOARDING / IN_PROGRESS are completed 6 h after their arrival time.
 */
async function simulateMissedTrips(companyIds: string[]): Promise<number> {
  const prisma = getPrisma();
  const now = Date.now();
  const trips = await prisma.trip.findMany({
    where: {
      companyId: { in: companyIds },
      driverId: { not: null },
      OR: [
        { status: TripStatus.SCHEDULED, arrivalAt: { lt: new Date(now) } },
        { status: { in: [TripStatus.BOARDING, TripStatus.IN_PROGRESS] }, arrivalAt: { lt: new Date(now - LEFTOVER_AFTER) } },
      ],
    },
    orderBy: { departureAt: 'asc' },
    take: SIMULATE_TRIPS_PER_RUN,
    select: { id: true, driverId: true, status: true, departureAt: true, arrivalAt: true },
  });

  let done = 0;
  for (const trip of trips) {
    const driverId = trip.driverId!;
    try {
      if (trip.status === TripStatus.SCHEDULED) {
        await driverTripsService.setStatus(driverId, trip.id, TripStatus.BOARDING);
        const manifest = await driverTripsService.manifestOf({ id: trip.id, status: TripStatus.BOARDING });
        for (const p of manifest.passengers) {
          if (p.boardingStatus !== 'PENDING') continue;
          if (p.cashToCollectMinor === 0 && Math.random() < 0.1) continue; // an online no-show now and then
          await boardDemoTicket(driverId, trip.id, p.ticketNumber).catch((err) => logger.debug({ err, trip: trip.id }, 'Demo boarding skipped'));
        }
      }
      if (trip.status !== TripStatus.IN_PROGRESS) await driverTripsService.setStatus(driverId, trip.id, TripStatus.IN_PROGRESS);
      await driverTripsService.setStatus(driverId, trip.id, TripStatus.COMPLETED);
      // Real-looking timestamps instead of "just now".
      await prisma.trip.update({ where: { id: trip.id }, data: { startedAt: trip.departureAt, completedAt: trip.arrivalAt ?? trip.departureAt } });
      done += 1;
    } catch (err) {
      logger.warn({ err, trip: trip.id }, 'Demo trip simulation failed');
    }
  }
  return done;
}

/**
 * Builds/refreshes the demo world. Returns how many trips were created. `days` is the scheduling
 * horizon (capped at 7 days of rolling trips; the hourly refresh keeps it moving).
 */
export async function ensureDemoSchedule(days = 7): Promise<number> {
  const prisma = getPrisma();
  await runtimeSettings.reload();
  const admin = await prisma.adminUser.findFirst({ where: { isBootstrap: true }, select: { id: true } });
  const stations = await prisma.station.findMany({ include: { city: { select: { code: true } } }, orderBy: { createdAt: 'asc' } });
  const stationOf = new Map<string, string>();
  for (const s of stations) if (!stationOf.has(s.city.code)) stationOf.set(s.city.code, s.id);
  if (!admin || !stationOf.has('KRT') || !stationOf.has('PZU')) {
    logger.warn('Demo schedule skipped: run `npm run db:seed` first');
    return 0;
  }

  const now = Date.now();
  const horizon = now + Math.min(Math.max(days, 1), 7) * 24 * HOUR;
  const companyIds: string[] = [];
  let created = 0;
  for (const carrier of DEMO_CARRIERS) {
    const company = await ensureCarrier(carrier);
    companyIds.push(company.id);
    for (const line of carrier.lines) {
      const from = stationOf.get(line.from)!;
      const to = stationOf.get(line.to)!;
      const out = await ensureRoute(company.id, line.out, from, to, line.durationMinutes, line.stops.map(([c, o, d]) => [stationOf.get(c)!, o, d]));
      // The way back passes the same stops in reverse order.
      const backStops = [...line.stops].reverse().map(([c, o, d]) => [stationOf.get(c)!, line.durationMinutes - o - d, d] as [string, number, number]);
      const back = await ensureRoute(company.id, line.back, to, from, line.durationMinutes, backStops);
      for (const b of line.buses) {
        const { vehicle, driver } = await ensureBus(company.id, b);
        created += await scheduleBus({ vehicleId: vehicle.id, driverId: driver.id }, out, back, line.priceMinor, horizon, admin.id);
      }
    }
  }

  // The seeded demo office and its staff carry Arabic names on screens shown to the client.
  await prisma.brokerOffice.updateMany({ where: { code: 'ZG-BRK-1', name: 'ZoolGo Demo Broker Office' }, data: { name: DEMO_OFFICE_NAME } });
  await prisma.brokerEmployee.updateMany({ where: { displayName: 'Demo Broker Manager' }, data: { displayName: 'محمد عبد الله' } });
  await prisma.brokerEmployee.updateMany({ where: { displayName: 'Demo Broker Clerk' }, data: { displayName: 'سارة أحمد' } });

  // Trips that should have left hours ago, never started and sold nothing: free their bus.
  const stale = await prisma.trip.updateMany({
    where: { companyId: { in: companyIds }, status: TripStatus.SCHEDULED, departureAt: { lt: new Date(now - 2 * HOUR) }, bookings: { none: {} } },
    data: { status: TripStatus.CANCELLED },
  });
  const completed = await simulateMissedTrips(companyIds);
  const booked = await seedPassengers(companyIds);
  logger.info({ created, cancelledStale: stale.count, simulatedTrips: completed, demoBookings: booked }, 'Demo world refreshed');
  return created;
}
