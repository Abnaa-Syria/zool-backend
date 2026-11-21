import { Prisma, type Amenity } from '@prisma/client';
import { AppError } from '../../shared/errors/app-error';
import { paginationMeta, parsePagination } from '../../shared/utils/pagination';
import { auditService } from '../audit/audit.service';
import { geoRepository, type CityRow, type StationRow } from './geo.repository';
import type {
  CreateAmenityInput,
  CreateCityInput,
  CreateStationInput,
  PatchAmenityInput,
  PatchCityInput,
  PatchStationInput,
} from './geo.validation';

type Actor = { actorAdminId: string; requestId?: string };

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

const decimalOrNull = (v: Prisma.Decimal | null) => (v === null ? null : Number(v.toString()));

export function toCityDto(city: CityRow) {
  return {
    id: city.id,
    code: city.code,
    nameAr: city.nameAr,
    nameEn: city.nameEn,
    imageUrl: city.imageUrl,
    isPopular: city.isPopular,
    sortOrder: city.sortOrder,
    isActive: city.isActive,
    stationCount: city._count.stations,
    createdAt: city.createdAt.toISOString(),
    updatedAt: city.updatedAt.toISOString(),
  };
}

export function toStationDto(station: StationRow) {
  return {
    id: station.id,
    city: { id: station.city.id, code: station.city.code, nameAr: station.city.nameAr, nameEn: station.city.nameEn },
    nameAr: station.nameAr,
    nameEn: station.nameEn,
    address: station.address,
    latitude: decimalOrNull(station.latitude),
    longitude: decimalOrNull(station.longitude),
    isActive: station.isActive,
    createdAt: station.createdAt.toISOString(),
    updatedAt: station.updatedAt.toISOString(),
  };
}

export function toAmenityDto(a: Amenity) {
  return { id: a.id, code: a.code, nameAr: a.nameAr, nameEn: a.nameEn, icon: a.icon, sortOrder: a.sortOrder };
}

export class GeoService {
  // ---------------- Cities
  async listCities(query: { page?: number; pageSize?: number; q?: string; isActive?: boolean }) {
    const { page, pageSize, skip, take } = parsePagination(query, { page: 1, pageSize: 50 });
    const { items, total } = await geoRepository.listCities({ skip, take, q: query.q, isActive: query.isActive });
    return { items: items.map(toCityDto), meta: paginationMeta(page, pageSize, total) };
  }

  async createCity(input: CreateCityInput & Actor) {
    const { actorAdminId, requestId, ...data } = input;
    try {
      const city = await geoRepository.createCity(data);
      await auditService.record({
        actorAdminId,
        action: 'city.created',
        resourceType: 'city',
        resourceId: city.id,
        requestId,
        metadata: { code: city.code },
      });
      return toCityDto(city);
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('City code already exists');
      throw error;
    }
  }

  async updateCity(input: { cityId: string; patch: PatchCityInput } & Actor) {
    const existing = await geoRepository.findCityById(input.cityId);
    if (!existing) throw AppError.notFound('City not found');
    const city = await geoRepository.updateCity(input.cityId, input.patch);
    await auditService.record({
      actorAdminId: input.actorAdminId,
      action: 'city.updated',
      resourceType: 'city',
      resourceId: city.id,
      requestId: input.requestId,
      metadata: { changes: input.patch },
    });
    return toCityDto(city);
  }

  // ---------------- Stations
  async listStations(query: { page?: number; pageSize?: number; cityId?: string; q?: string; isActive?: boolean }) {
    const { page, pageSize, skip, take } = parsePagination(query, { page: 1, pageSize: 50 });
    const { items, total } = await geoRepository.listStations({
      skip,
      take,
      cityId: query.cityId,
      q: query.q,
      isActive: query.isActive,
    });
    return { items: items.map(toStationDto), meta: paginationMeta(page, pageSize, total) };
  }

  async createStation(input: CreateStationInput & Actor) {
    const { actorAdminId, requestId, ...data } = input;
    const city = await geoRepository.findCityById(data.cityId);
    if (!city) throw AppError.notFound('City not found');
    const station = await geoRepository.createStation(data);
    await auditService.record({
      actorAdminId,
      action: 'station.created',
      resourceType: 'station',
      resourceId: station.id,
      requestId,
      metadata: { cityId: station.cityId, nameEn: station.nameEn },
    });
    return toStationDto(station);
  }

  async updateStation(input: { stationId: string; patch: PatchStationInput } & Actor) {
    const existing = await geoRepository.findStationById(input.stationId);
    if (!existing) throw AppError.notFound('Station not found');
    const nextLat = input.patch.latitude !== undefined ? input.patch.latitude : decimalOrNull(existing.latitude);
    const nextLng = input.patch.longitude !== undefined ? input.patch.longitude : decimalOrNull(existing.longitude);
    if ((nextLat === null) !== (nextLng === null)) {
      throw AppError.validation('latitude and longitude must be set or cleared together', { field: 'latitude' });
    }
    const station = await geoRepository.updateStation(input.stationId, input.patch);
    await auditService.record({
      actorAdminId: input.actorAdminId,
      action: 'station.updated',
      resourceType: 'station',
      resourceId: station.id,
      requestId: input.requestId,
      metadata: { changes: input.patch },
    });
    return toStationDto(station);
  }

  // ---------------- Amenities
  async listAmenities() {
    return (await geoRepository.listAmenities()).map(toAmenityDto);
  }

  async createAmenity(input: CreateAmenityInput & Actor) {
    const { actorAdminId, requestId, ...data } = input;
    try {
      const amenity = await geoRepository.createAmenity(data);
      await auditService.record({
        actorAdminId,
        action: 'amenity.created',
        resourceType: 'amenity',
        resourceId: amenity.id,
        requestId,
        metadata: { code: amenity.code },
      });
      return toAmenityDto(amenity);
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('Amenity code already exists');
      throw error;
    }
  }

  async updateAmenity(input: { amenityId: string; patch: PatchAmenityInput } & Actor) {
    const existing = await geoRepository.findAmenityById(input.amenityId);
    if (!existing) throw AppError.notFound('Amenity not found');
    const amenity = await geoRepository.updateAmenity(input.amenityId, input.patch);
    await auditService.record({
      actorAdminId: input.actorAdminId,
      action: 'amenity.updated',
      resourceType: 'amenity',
      resourceId: amenity.id,
      requestId: input.requestId,
      metadata: { changes: input.patch },
    });
    return toAmenityDto(amenity);
  }
}

export const geoService = new GeoService();
