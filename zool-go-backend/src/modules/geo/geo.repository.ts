import type { Prisma } from '@prisma/client';
import { getPrisma, type PrismaTx } from '../../infrastructure/database/prisma';

function client(tx?: PrismaTx) {
  return tx ?? getPrisma();
}

const cityInclude = { _count: { select: { stations: true } } } satisfies Prisma.CityInclude;
const stationInclude = { city: true } satisfies Prisma.StationInclude;

export type CityRow = Prisma.CityGetPayload<{ include: typeof cityInclude }>;
export type StationRow = Prisma.StationGetPayload<{ include: typeof stationInclude }>;

export class GeoRepository {
  // ---- Cities
  async listCities(params: { skip: number; take: number; q?: string; isActive?: boolean }) {
    const where: Prisma.CityWhereInput = {
      ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
      ...(params.q
        ? { OR: [{ code: { contains: params.q } }, { nameAr: { contains: params.q } }, { nameEn: { contains: params.q } }] }
        : {}),
    };
    const [items, total] = await Promise.all([
      getPrisma().city.findMany({
        where,
        include: cityInclude,
        orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
        skip: params.skip,
        take: params.take,
      }),
      getPrisma().city.count({ where }),
    ]);
    return { items, total };
  }

  findCityById(id: string) {
    return getPrisma().city.findUnique({ where: { id }, include: cityInclude });
  }

  createCity(data: Prisma.CityCreateInput, tx?: PrismaTx) {
    return client(tx).city.create({ data, include: cityInclude });
  }

  updateCity(id: string, data: Prisma.CityUpdateInput, tx?: PrismaTx) {
    return client(tx).city.update({ where: { id }, data, include: cityInclude });
  }

  // ---- Stations
  async listStations(params: { skip: number; take: number; cityId?: string; q?: string; isActive?: boolean }) {
    const where: Prisma.StationWhereInput = {
      ...(params.cityId ? { cityId: params.cityId } : {}),
      ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
      ...(params.q ? { OR: [{ nameAr: { contains: params.q } }, { nameEn: { contains: params.q } }] } : {}),
    };
    const [items, total] = await Promise.all([
      getPrisma().station.findMany({
        where,
        include: stationInclude,
        orderBy: [{ city: { sortOrder: 'asc' } }, { nameEn: 'asc' }],
        skip: params.skip,
        take: params.take,
      }),
      getPrisma().station.count({ where }),
    ]);
    return { items, total };
  }

  findStationById(id: string) {
    return getPrisma().station.findUnique({ where: { id }, include: stationInclude });
  }

  createStation(data: Prisma.StationUncheckedCreateInput, tx?: PrismaTx) {
    return client(tx).station.create({ data, include: stationInclude });
  }

  updateStation(id: string, data: Prisma.StationUncheckedUpdateInput, tx?: PrismaTx) {
    return client(tx).station.update({ where: { id }, data, include: stationInclude });
  }

  // ---- Amenities
  listAmenities() {
    return getPrisma().amenity.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
  }

  findAmenityById(id: string) {
    return getPrisma().amenity.findUnique({ where: { id } });
  }

  createAmenity(data: Prisma.AmenityCreateInput, tx?: PrismaTx) {
    return client(tx).amenity.create({ data });
  }

  updateAmenity(id: string, data: Prisma.AmenityUpdateInput, tx?: PrismaTx) {
    return client(tx).amenity.update({ where: { id }, data });
  }
}

export const geoRepository = new GeoRepository();
