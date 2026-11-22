import { IdentityType, ServiceClass, type Prisma } from '@prisma/client';
import { env } from '../config/env';
import { getPrisma } from '../infrastructure/database/prisma';
import { logger } from '../infrastructure/observability/logger';
import { networkService } from '../modules/network/network.service';
import { setPrincipalAuthzVersion } from '../shared/security/principal-authz-cache';
import { normalizePhone } from '../shared/utils/phone';
import { buildNumberedLayout } from '../shared/utils/seat-layout';
import { calendarDateInZone, zonedDayRange } from '../shared/utils/timezone';

/**
 * Development/staging only: keeps the demo carrier ("sudan_express", from `npm run db:seed`)
 * running every day so app developers always have bookable trips.
 *
 * Two buses shuttle between Khartoum and Port Sudan at 07:00 Sudan time: bus 1 goes north on odd
 * days, bus 2 on even days, and each comes back the next day — so both directions run daily.
 * Trips are created through the normal scheduling service (same checks as the admin dashboard).
 */
const DEMO = {
  carrierKey: 'sudan_express',
  buses: [
    { plate: 'خ ر ط 1234', driverPhone: '+249900000201' },
    { plate: 'خ ر ط 5678', driverPhone: '+249900000202', driverName: 'عثمان الطيب', driverCode: 'ZGD-0002' },
  ],
  priceMinor: 3_500_000,
  departureHour: 7,
} as const;

async function ensureBus(companyId: string, plate: string, template: { seatLayout: Prisma.JsonValue; capacity: number }) {
  return (
    (await getPrisma().vehicle.findUnique({ where: { plateNumber: plate } })) ??
    getPrisma().vehicle.create({
      data: { companyId, plateNumber: plate, model: 'Toyota Coaster', capacity: template.capacity, serviceClass: ServiceClass.STANDARD, seatLayout: template.seatLayout as Prisma.InputJsonValue },
    })
  );
}

async function ensureDriver(companyId: string, phone: string, name: string, code: string) {
  const p = normalizePhone(phone);
  const identity = await getPrisma().driverIdentity.findUnique({ where: { type_valueNormalized: { type: IdentityType.PHONE, valueNormalized: p } } });
  if (identity) return getPrisma().driver.findUniqueOrThrow({ where: { id: identity.driverId } });
  const d = await getPrisma().driver.create({
    data: { companyId, driverCode: code, displayName: name, licenseExpiry: new Date('2028-12-31T00:00:00.000Z'), identities: { create: { type: IdentityType.PHONE, valueNormalized: p, isPrimary: true, verifiedAt: new Date() } } },
  });
  await setPrincipalAuthzVersion('driver', d.id, d.authzVersion);
  return d;
}

/** Creates the missing demo trips for the next `days` Sudan days. Returns how many were created. */
export async function ensureDemoSchedule(days = 14): Promise<number> {
  const prisma = getPrisma();
  const company = await prisma.transportCompany.findUnique({ where: { key: DEMO.carrierKey } });
  const admin = await prisma.adminUser.findFirst({ where: { isBootstrap: true }, select: { id: true } });
  const outRoute = company && (await prisma.route.findFirst({ where: { companyId: company.id, code: 'KRT-PZU' } }));
  if (!company || !admin || !outRoute) {
    logger.warn('Demo schedule skipped: run `npm run db:seed` first');
    return 0;
  }
  const backRoute =
    (await prisma.route.findFirst({ where: { companyId: company.id, code: 'PZU-KRT' } })) ??
    (await prisma.route.create({
      data: { companyId: company.id, code: 'PZU-KRT', originStationId: outRoute.destinationStationId, destinationStationId: outRoute.originStationId, durationMinutes: outRoute.durationMinutes },
    }));

  const first = await prisma.vehicle.findUnique({ where: { plateNumber: DEMO.buses[0].plate } });
  const template = first ?? { seatLayout: buildNumberedLayout({ rows: 7, womenOnlyLabels: ['11', '12'] }) as unknown as Prisma.JsonValue, capacity: 28 };
  const buses = [];
  for (const b of DEMO.buses) {
    const vehicle = await ensureBus(company.id, b.plate, template);
    const driver = await ensureDriver(company.id, b.driverPhone, 'driverName' in b ? b.driverName : 'سائق تجريبي', 'driverCode' in b ? b.driverCode : 'ZGD-0001');
    buses.push({ vehicle, driver });
  }

  const tz = env().PLATFORM_TIMEZONE;
  const today = calendarDateInZone(new Date(), tz);
  let created = 0;
  for (let i = 1; i <= days; i++) {
    const day = calendarDateInZone(new Date(zonedDayRange(today, tz).from.getTime() + i * 86_400_000 + 3_600_000), tz);
    const departure = new Date(zonedDayRange(day, tz).from.getTime() + DEMO.departureHour * 3_600_000);
    for (const [b, bus] of buses.entries()) {
      // Bus 1 goes north on odd day offsets, bus 2 on even ones; each returns the next day.
      const route = (i + b) % 2 === 1 ? outRoute : backRoute;
      const exists = await prisma.trip.findFirst({ where: { routeId: route.id, departureAt: departure, status: { not: 'CANCELLED' } }, select: { id: true } });
      if (exists) continue;
      try {
        await networkService.scheduleTrips({
          routeId: route.id,
          vehicleId: bus.vehicle.id,
          driverId: bus.driver.id,
          departures: [departure],
          basePrice: DEMO.priceMinor,
          actorAdminId: admin.id,
        });
        created += 1;
      } catch (err) {
        logger.debug({ err, day, route: route.code }, 'Demo trip not scheduled (bus or driver busy)');
      }
    }
  }
  return created;
}
