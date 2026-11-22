import {
  IdentityType,
  type PrismaClient,
  type Prisma,
  ServiceClass,
} from '@prisma/client';
import { loadEnv } from '../src/config/env';
import { SYSTEM_SETTINGS } from '../src/shared/constants/system-settings';
import { normalizePhone } from '../src/shared/utils/phone';
import { buildNumberedLayout } from '../src/shared/utils/seat-layout';
import { zonedDayRange, calendarDateInZone } from '../src/shared/utils/timezone';

/**
 * Phase 2 reference + demo data (idempotent): Sudanese cities/stations, amenities, settings,
 * privacy page, one carrier fleet (vehicle, driver, route with stops), tomorrow's structured trips,
 * and a demo customer. Dev only — never run against production.
 */

const CITIES = [
  { code: 'KRT', nameAr: 'الخرطوم', nameEn: 'Khartoum', isPopular: false, lat: 15.5007, lng: 32.5599, station: { ar: 'الميناء البري', en: 'Al-Mina Al-Barri' } },
  { code: 'PZU', nameAr: 'بورتسودان', nameEn: 'Port Sudan', isPopular: true, lat: 19.6158, lng: 37.2164, station: { ar: 'موقف بورتسودان السفري', en: 'Port Sudan Bus Terminal' } },
  { code: 'KSL', nameAr: 'كسلا', nameEn: 'Kassala', isPopular: true, lat: 15.451, lng: 36.4, station: { ar: 'موقف كسلا السفري', en: 'Kassala Bus Terminal' } },
  { code: 'ATB', nameAr: 'عطبرة', nameEn: 'Atbara', isPopular: true, lat: 17.7022, lng: 33.9864, station: { ar: 'موقف عطبرة', en: 'Atbara Terminal' } },
  { code: 'SHD', nameAr: 'شندي', nameEn: 'Shendi', isPopular: false, lat: 16.6915, lng: 33.4341, station: { ar: 'موقف شندي', en: 'Shendi Terminal' } },
  { code: 'MWE', nameAr: 'مروي', nameEn: 'Merowe', isPopular: false, lat: 18.4833, lng: 31.8167, station: { ar: 'موقف مروي', en: 'Merowe Terminal' } },
  { code: 'WDM', nameAr: 'ود مدني', nameEn: 'Wad Madani', isPopular: true, lat: 14.4012, lng: 33.5199, station: { ar: 'موقف ود مدني السفري', en: 'Wad Madani Terminal' } },
  { code: 'GDR', nameAr: 'القضارف', nameEn: 'Gedaref', isPopular: false, lat: 14.035, lng: 35.3833, station: { ar: 'موقف القضارف', en: 'Gedaref Terminal' } },
  { code: 'KST', nameAr: 'كوستي', nameEn: 'Kosti', isPopular: false, lat: 13.1629, lng: 32.6635, station: { ar: 'موقف كوستي', en: 'Kosti Terminal' } },
  { code: 'EBD', nameAr: 'الأبيض', nameEn: 'El Obeid', isPopular: false, lat: 13.1843, lng: 30.2167, station: { ar: 'موقف الأبيض', en: 'El Obeid Terminal' } },
  { code: 'DOG', nameAr: 'دنقلا', nameEn: 'Dongola', isPopular: false, lat: 19.1781, lng: 30.4767, station: { ar: 'موقف دنقلا', en: 'Dongola Terminal' } },
] as const;

const AMENITIES = [
  { code: 'wifi', nameAr: 'واي فاي', nameEn: 'Wi-Fi', icon: 'wifi' },
  { code: 'usb', nameAr: 'شحن USB', nameEn: 'USB charging', icon: 'usb' },
  { code: 'ac', nameAr: 'تكييف', nameEn: 'Air conditioning', icon: 'ac_unit' },
  { code: 'snack', nameAr: 'وجبة خفيفة', nameEn: 'Snack', icon: 'restaurant' },
  { code: 'wc', nameAr: 'دورة مياه', nameEn: 'Toilet', icon: 'wc' },
  { code: 'tv', nameAr: 'شاشات', nameEn: 'Screens', icon: 'tv' },
  { code: 'vip_seats', nameAr: 'مقاعد VIP', nameEn: 'VIP seats', icon: 'event_seat' },
  { code: 'luggage', nameAr: 'أمتعة', nameEn: 'Luggage allowance', icon: 'luggage' },
] as const;

export async function seedPhase2(prisma: PrismaClient): Promise<void> {
  const env = loadEnv(process.env);

  // --- Settings (only fill missing keys; never overwrite admin edits)
  for (const def of SYSTEM_SETTINGS) {
    await prisma.systemSetting.upsert({
      where: { key: def.key },
      create: { key: def.key, value: def.defaultValue(env) as Prisma.InputJsonValue },
      update: {},
    });
  }

  // --- Cities + main station
  const stationByCity = new Map<string, string>();
  for (const [i, c] of CITIES.entries()) {
    const city = await prisma.city.upsert({
      where: { code: c.code },
      create: { code: c.code, nameAr: c.nameAr, nameEn: c.nameEn, isPopular: c.isPopular, sortOrder: i },
      update: {},
    });
    const existing = await prisma.station.findFirst({ where: { cityId: city.id, nameEn: c.station.en } });
    const station =
      existing ??
      (await prisma.station.create({ data: { cityId: city.id, nameAr: c.station.ar, nameEn: c.station.en } }));
    // Approximate city-centre coordinates so live tracking can draw stations and remaining km.
    if (station.latitude === null) {
      await prisma.station.update({ where: { id: station.id }, data: { latitude: c.lat, longitude: c.lng } });
    }
    stationByCity.set(c.code, station.id);
  }

  // --- Amenities
  for (const [i, a] of AMENITIES.entries()) {
    await prisma.amenity.upsert({ where: { code: a.code }, create: { ...a, sortOrder: i }, update: {} });
  }

  // --- Carrier profile, fleet, driver, route (on the Stage 2 demo carrier)
  const company = await prisma.transportCompany.update({
    where: { key: 'sudan_express' },
    data: { shortName: 'سودان إكسبريس', legalName: 'شركة سودان إكسبريس للنقل البري' },
  });

  const layout = buildNumberedLayout({ rows: 7, womenOnlyLabels: ['11', '12'] });
  const vehicle = await prisma.vehicle.upsert({
    where: { plateNumber: 'خ ر ط 1234' },
    create: {
      companyId: company.id,
      plateNumber: 'خ ر ط 1234',
      model: 'Toyota Coaster',
      capacity: layout.seats.length,
      serviceClass: ServiceClass.VIP,
      seatLayout: layout as unknown as Prisma.InputJsonValue,
    },
    update: {},
  });
  const amenityIds = await prisma.amenity.findMany({ where: { code: { in: ['wifi', 'ac', 'usb', 'luggage'] } } });
  for (const a of amenityIds) {
    await prisma.vehicleAmenity.upsert({
      where: { vehicleId_amenityId: { vehicleId: vehicle.id, amenityId: a.id } },
      create: { vehicleId: vehicle.id, amenityId: a.id, value: a.code === 'luggage' ? '30' : null },
      update: {},
    });
  }

  const driverPhone = normalizePhone('+249900000201');
  const driverIdentity = await prisma.driverIdentity.findUnique({
    where: { type_valueNormalized: { type: IdentityType.PHONE, valueNormalized: driverPhone } },
  });
  const driver =
    driverIdentity
      ? await prisma.driver.findUniqueOrThrow({ where: { id: driverIdentity.driverId } })
      : await prisma.driver.create({
          data: {
            companyId: company.id,
            driverCode: 'ZGD-0001',
            displayName: 'أحمد محمد سليمان',
            licenseNumber: 'DL-7649',
            licenseExpiry: new Date('2027-12-31T00:00:00.000Z'),
            identities: {
              create: { type: IdentityType.PHONE, valueNormalized: driverPhone, isPrimary: true, verifiedAt: new Date() },
            },
          },
        });

  const route = await prisma.route.upsert({
    where: { companyId_code: { companyId: company.id, code: 'KRT-PZU' } },
    create: {
      companyId: company.id,
      code: 'KRT-PZU',
      originStationId: stationByCity.get('KRT')!,
      destinationStationId: stationByCity.get('PZU')!,
      durationMinutes: 720,
      stops: {
        create: [
          { stationId: stationByCity.get('SHD')!, sequence: 1, offsetMinutes: 180, dwellMinutes: 15 },
          { stationId: stationByCity.get('ATB')!, sequence: 2, offsetMinutes: 300, dwellMinutes: 30 },
        ],
      },
    },
    update: {},
    include: { stops: true },
  });

  // --- Tomorrow's structured trips (Sudan calendar day), seats copied from the vehicle layout
  const tz = env.PLATFORM_TIMEZONE;
  const today = calendarDateInZone(new Date(), tz);
  const tomorrowStart = new Date(zonedDayRange(today, tz).to);
  const tomorrow = calendarDateInZone(tomorrowStart, tz);
  for (const [hour, suffix, price] of [
    [6, 'A', 3_500_000],
    [14, 'B', 3_200_000],
  ] as const) {
    const tripNumber = `KRT-PZU-${tomorrow.replace(/-/g, '')}-${suffix}`;
    if (await prisma.trip.findUnique({ where: { tripNumber } })) continue;
    const departureAt = new Date(zonedDayRange(tomorrow, tz).from.getTime() + hour * 3_600_000);
    // Never double-book the demo bus: skip when it already runs a trip in this window.
    const arrival = new Date(departureAt.getTime() + route.durationMinutes * 60_000);
    const busy = await prisma.trip.findFirst({
      where: { vehicleId: vehicle.id, status: { not: 'CANCELLED' }, departureAt: { lt: arrival }, arrivalAt: { gt: departureAt } },
      select: { id: true },
    });
    if (busy) continue;
    await prisma.trip.create({
      data: {
        tripNumber,
        companyId: company.id,
        routeId: route.id,
        origin: 'الخرطوم',
        destination: 'بورتسودان',
        originStationId: route.originStationId,
        destinationStationId: route.destinationStationId,
        departureAt,
        arrivalAt: new Date(departureAt.getTime() + route.durationMinutes * 60_000),
        basePrice: price,
        vehicleId: vehicle.id,
        driverId: driver.id,
        serviceClass: vehicle.serviceClass,
        seats: {
          create: layout.seats.map((s, i) => ({
            seatLabel: s.label,
            sortOrder: i,
            layoutRow: s.row,
            layoutColumn: s.column,
            isWomenOnly: s.isWomenOnly,
          })),
        },
        stops: {
          create: route.stops.map((s) => ({
            stationId: s.stationId,
            sequence: s.sequence,
            scheduledArrivalAt: new Date(departureAt.getTime() + s.offsetMinutes * 60_000),
            scheduledDepartureAt: new Date(departureAt.getTime() + (s.offsetMinutes + s.dwellMinutes) * 60_000),
          })),
        },
      },
    });
  }

  // --- Demo customer
  const customerPhone = normalizePhone('+249900000301');
  const customerIdentity = await prisma.customerIdentity.findUnique({
    where: { type_valueNormalized: { type: IdentityType.PHONE, valueNormalized: customerPhone } },
  });
  if (!customerIdentity) {
    await prisma.customer.create({
      data: {
        displayName: 'مروة عثمان',
        identities: {
          create: { type: IdentityType.PHONE, valueNormalized: customerPhone, isPrimary: true, verifiedAt: new Date() },
        },
      },
    });
  }

  // --- Privacy page placeholder (content owner replaces it from the admin dashboard)
  await prisma.contentPage.upsert({
    where: { slug: 'privacy' },
    create: {
      slug: 'privacy',
      titleAr: 'سياسة الأمان والخصوصية',
      titleEn: 'Privacy policy',
      sections: [
        {
          titleAr: 'مقدمة',
          titleEn: 'Introduction',
          bodyAr: 'نص تجريبي — يستبدله فريق المحتوى.',
          bodyEn: 'Placeholder text — to be replaced by the content team.',
        },
      ],
    },
    update: {},
  });

  // eslint-disable-next-line no-console
  console.log(
    `Phase 2 seed: ${CITIES.length} cities, route KRT-PZU, driver +249900000201, customer +249900000301, trips for ${tomorrow}`,
  );
}
