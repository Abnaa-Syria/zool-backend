import { expect } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getPrisma } from '../../src/infrastructure/database/prisma';
import { buildNumberedLayout } from '../../src/shared/utils/seat-layout';

export const DAY = 24 * 60 * 60 * 1000;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Sudan calendar date (UTC+2) of a timestamp, as YYYY-MM-DD. */
export function sudanDate(d: Date): string {
  return new Date(d.getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** A Sudan local wall-clock time `daysAhead` days from today (UTC+2, no DST). */
export function sudanAt(daysAhead: number, hhmm: string): Date {
  const today = sudanDate(new Date());
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const base = Date.parse(`${today}T00:00:00.000Z`) + daysAhead * DAY;
  return new Date(base + (h - 2) * 60 * 60 * 1000 + m * 60 * 1000);
}

/**
 * Structured network for app tests: carrier, KRT → (SHD stop) → PZU route and back, a 28-seat
 * bus (women-only 11, 12; wifi + ac), a second bus, and a driver who can log in (+249900000201).
 */
export async function seedNetwork(app: Express, adminToken: string) {
  const prisma = getPrisma();
  const company = await prisma.transportCompany.create({
    data: { key: 'sudan_express', name: 'Sudan Express Co.', shortName: 'Sudan Express', ratingAvgX100: 450, ratingCount: 10 },
  });
  const mk = async (code: string, ar: string, en: string) => {
    const city = await prisma.city.create({ data: { code, nameAr: ar, nameEn: en, isPopular: code === 'PZU' } });
    const station = await prisma.station.create({ data: { cityId: city.id, nameAr: `موقف ${ar}`, nameEn: `${en} Terminal` } });
    return { cityId: city.id, stationId: station.id };
  };
  const krt = await mk('KRT', 'الخرطوم', 'Khartoum');
  const shd = await mk('SHD', 'شندي', 'Shendi');
  const pzu = await mk('PZU', 'بورتسودان', 'Port Sudan');

  const wifi = await prisma.amenity.create({ data: { code: 'wifi', nameAr: 'واي فاي', nameEn: 'Wi-Fi', icon: 'wifi', sortOrder: 1 } });
  const ac = await prisma.amenity.create({ data: { code: 'ac', nameAr: 'تكييف', nameEn: 'A/C', icon: 'ac_unit', sortOrder: 2 } });
  const bus = await prisma.vehicle.create({
    data: {
      companyId: company.id,
      plateNumber: 'KRT 1',
      model: 'Coaster',
      capacity: 28,
      seatLayout: buildNumberedLayout({ rows: 7, womenOnlyLabels: ['11', '12'] }),
      amenities: { create: [{ amenityId: wifi.id }, { amenityId: ac.id }] },
    },
  });
  const bus2 = await prisma.vehicle.create({
    data: { companyId: company.id, plateNumber: 'KRT 2', model: 'Hiace', capacity: 12, serviceClass: 'VIP', seatLayout: buildNumberedLayout({ rows: 3 }) },
  });

  const driver = await request(app)
    .post('/api/v1/admin/drivers')
    .set(auth(adminToken))
    .send({ companyId: company.id, displayName: 'Osman Driver', phone: '+249900000201', licenseExpiry: '2099-12-31' });
  expect(driver.status).toBe(201);

  const route = async (from: typeof krt, to: typeof krt, code: string, stops: unknown[]) => {
    const res = await request(app)
      .post('/api/v1/admin/routes')
      .set(auth(adminToken))
      .send({ companyId: company.id, code, originStationId: from.stationId, destinationStationId: to.stationId, durationMinutes: 600, stops });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  };
  const outRoute = await route(krt, pzu, 'krt-pzu', [{ stationId: shd.stationId, offsetMinutes: 180, dwellMinutes: 15 }]);
  const backRoute = await route(pzu, krt, 'pzu-krt', []);

  /** Schedules one trip and returns its id. */
  async function schedule(opts: { departure: Date; priceMinor: number; back?: boolean; vip?: boolean; withDriver?: boolean }) {
    const res = await request(app)
      .post('/api/v1/admin/trips/schedule')
      .set(auth(adminToken))
      .send({
        routeId: opts.back ? backRoute : outRoute,
        vehicleId: opts.vip ? bus2.id : bus.id,
        ...(opts.withDriver ? { driverId: driver.body.data.id } : {}),
        departures: [opts.departure.toISOString()],
        basePrice: opts.priceMinor,
      });
    expect(res.status).toBe(201);
    return res.body.data[0].id as string;
  }

  return { companyId: company.id, krt, shd, pzu, busId: bus.id, bus2Id: bus2.id, driverId: driver.body.data.id as string, driverPhone: '+249900000201', schedule };
}
