import { randomInt } from 'node:crypto';
import { DriverStatus, IdentityType, Prisma, type ServiceClass, type VehicleStatus } from '@prisma/client';
import { getPrisma } from '../../infrastructure/database/prisma';
import { AppError } from '../../shared/errors/app-error';
import { setPrincipalAuthzVersion } from '../../shared/security/principal-authz-cache';
import { paginationMeta, parsePagination } from '../../shared/utils/pagination';
import { normalizePhone } from '../../shared/utils/phone';
import { buildNumberedLayout, seatLayoutSchema, type SeatLayout } from '../../shared/utils/seat-layout';
import { auditService } from '../audit/audit.service';
import { fleetRepository, type DriverRow, type VehicleRow } from './fleet.repository';
import type { CreateDriverInput, CreateVehicleInput, LayoutInput, PatchDriverInput, PatchVehicleInput } from './fleet.validation';

type Actor = { actorAdminId: string; requestId?: string };

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

function resolveLayout(input: LayoutInput): SeatLayout {
  if ('seatLayout' in input) return input.seatLayout;
  const { rows, columns, womenOnlyLabels } = input.numbered;
  const layout = buildNumberedLayout({ rows, columns, womenOnlyLabels });
  const labels = new Set(layout.seats.map((s) => s.label));
  const unknown = (womenOnlyLabels ?? []).filter((l) => !labels.has(l));
  if (unknown.length > 0) {
    throw AppError.validation('Women-only seats must exist in the layout', { field: 'layout.numbered.womenOnlyLabels', unknown });
  }
  return layout;
}

export function toVehicleDto(v: VehicleRow) {
  const layout = seatLayoutSchema.parse(v.seatLayout);
  return {
    id: v.id,
    company: v.company,
    plateNumber: v.plateNumber,
    model: v.model,
    capacity: v.capacity,
    serviceClass: v.serviceClass,
    status: v.status,
    seatLayout: layout,
    amenities: v.amenities
      .map((a) => ({ code: a.amenity.code, nameAr: a.amenity.nameAr, nameEn: a.amenity.nameEn, icon: a.amenity.icon, value: a.value }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}

export function toDriverDto(d: DriverRow) {
  return {
    id: d.id,
    company: d.company,
    driverCode: d.driverCode,
    displayName: d.displayName,
    phone: d.identities[0]?.valueNormalized ?? null,
    avatarUrl: d.avatarUrl,
    licenseNumber: d.licenseNumber,
    licenseExpiry: d.licenseExpiry ? d.licenseExpiry.toISOString().slice(0, 10) : null,
    status: d.status,
    lastLoginAt: d.lastLoginAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}

const dateOnly = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

export class FleetService {
  // ---------------- Vehicles
  private async amenityRows(amenities: Array<{ code: string; value?: string }>) {
    const codes = [...new Set(amenities.map((a) => a.code))];
    const found = await fleetRepository.findAmenitiesByCodes(codes);
    const missing = codes.filter((c) => !found.some((f) => f.code === c));
    if (missing.length > 0) throw AppError.validation('Unknown amenity codes', { field: 'amenities', missing });
    return amenities.map((a) => ({ amenityId: found.find((f) => f.code === a.code)!.id, value: a.value ?? null }));
  }

  async listVehicles(query: { page?: number; pageSize?: number; companyId?: string; status?: VehicleStatus; q?: string }) {
    const { page, pageSize, skip, take } = parsePagination(query);
    const { items, total } = await fleetRepository.listVehicles({ skip, take, companyId: query.companyId, status: query.status, q: query.q });
    return { items: items.map(toVehicleDto), meta: paginationMeta(page, pageSize, total) };
  }

  async getVehicle(id: string) {
    const v = await fleetRepository.findVehicleById(id);
    if (!v) throw AppError.notFound('Vehicle not found');
    return toVehicleDto(v);
  }

  async createVehicle(input: CreateVehicleInput & Actor) {
    if (!(await fleetRepository.findCompany(input.companyId))) throw AppError.notFound('Transport company not found');
    const layout = resolveLayout(input.layout);
    const amenities = await this.amenityRows(input.amenities ?? []);
    try {
      const vehicle = await getPrisma().$transaction(async (tx) => {
        const created = await fleetRepository.createVehicle(
          {
            companyId: input.companyId,
            plateNumber: input.plateNumber,
            model: input.model,
            serviceClass: input.serviceClass as ServiceClass | undefined,
            capacity: layout.seats.length,
            seatLayout: layout as unknown as Prisma.InputJsonValue,
          },
          tx,
        );
        await fleetRepository.replaceVehicleAmenities(created.id, amenities, tx);
        await auditService.record(
          {
            actorAdminId: input.actorAdminId,
            action: 'vehicle.created',
            resourceType: 'vehicle',
            resourceId: created.id,
            requestId: input.requestId,
            metadata: { companyId: input.companyId, plateNumber: input.plateNumber, capacity: layout.seats.length },
          },
          tx,
        );
        return created.id;
      });
      return this.getVehicle(vehicle);
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('Plate number already registered');
      throw error;
    }
  }

  async updateVehicle(input: { vehicleId: string; patch: PatchVehicleInput } & Actor) {
    if (!(await fleetRepository.findVehicleById(input.vehicleId))) throw AppError.notFound('Vehicle not found');
    const { layout: layoutInput, amenities, ...scalars } = input.patch;
    const layout = layoutInput ? resolveLayout(layoutInput) : undefined;
    const amenityRows = amenities ? await this.amenityRows(amenities) : undefined;
    await getPrisma().$transaction(async (tx) => {
      await fleetRepository.updateVehicle(
        input.vehicleId,
        {
          ...scalars,
          ...(layout ? { seatLayout: layout as unknown as Prisma.InputJsonValue, capacity: layout.seats.length } : {}),
        },
        tx,
      );
      if (amenityRows) await fleetRepository.replaceVehicleAmenities(input.vehicleId, amenityRows, tx);
      await auditService.record(
        {
          actorAdminId: input.actorAdminId,
          action: 'vehicle.updated',
          resourceType: 'vehicle',
          resourceId: input.vehicleId,
          requestId: input.requestId,
          metadata: { fields: Object.keys(input.patch) },
        },
        tx,
      );
    });
    return this.getVehicle(input.vehicleId);
  }

  // ---------------- Drivers
  async listDrivers(query: { page?: number; pageSize?: number; companyId?: string; status?: DriverStatus; q?: string }) {
    const { page, pageSize, skip, take } = parsePagination(query);
    const { items, total } = await fleetRepository.listDrivers({ skip, take, companyId: query.companyId, status: query.status, q: query.q });
    return { items: items.map(toDriverDto), meta: paginationMeta(page, pageSize, total) };
  }

  async getDriver(id: string) {
    const d = await fleetRepository.findDriverById(id);
    if (!d) throw AppError.notFound('Driver not found');
    return toDriverDto(d);
  }

  private async generateDriverCode(): Promise<string> {
    for (let i = 0; i < 10; i += 1) {
      const code = `ZGD-${randomInt(1000, 100000)}`;
      if (!(await fleetRepository.driverCodeExists(code))) return code;
    }
    throw AppError.internal('Could not allocate a driver code');
  }

  async createDriver(input: CreateDriverInput & Actor) {
    if (!(await fleetRepository.findCompany(input.companyId))) throw AppError.notFound('Transport company not found');
    const phone = normalizePhone(input.phone);
    if (await fleetRepository.findDriverIdentityByPhone(phone)) throw AppError.conflict('Phone already registered to a driver');
    const driverCode = input.driverCode ?? (await this.generateDriverCode());
    try {
      const driver = await getPrisma().$transaction(async (tx) => {
        const created = await fleetRepository.createDriver(
          {
            companyId: input.companyId,
            driverCode,
            displayName: input.displayName,
            licenseNumber: input.licenseNumber ?? null,
            licenseExpiry: input.licenseExpiry ? dateOnly(input.licenseExpiry) : null,
            identities: { create: { type: IdentityType.PHONE, valueNormalized: phone, isPrimary: true, verifiedAt: new Date() } },
          } as Prisma.DriverUncheckedCreateInput,
          tx,
        );
        await auditService.record(
          {
            actorAdminId: input.actorAdminId,
            action: 'driver.created',
            resourceType: 'driver',
            resourceId: created.id,
            requestId: input.requestId,
            metadata: { companyId: input.companyId, driverCode },
          },
          tx,
        );
        return created;
      });
      await setPrincipalAuthzVersion('driver', driver.id, driver.authzVersion);
      return toDriverDto(driver);
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('Driver code or phone already exists');
      throw error;
    }
  }

  /**
   * Admin-managed driver profile. Phone change or suspension revokes all driver sessions and
   * bumps authzVersion so live access tokens stop working immediately.
   */
  async updateDriver(input: { driverId: string; patch: PatchDriverInput } & Actor) {
    const existing = await fleetRepository.findDriverById(input.driverId);
    if (!existing) throw AppError.notFound('Driver not found');
    const { phone: rawPhone, licenseExpiry, status, ...rest } = input.patch;

    const phone = rawPhone ? normalizePhone(rawPhone) : undefined;
    const phoneChanged = phone !== undefined && phone !== existing.identities[0]?.valueNormalized;
    if (phoneChanged) {
      const taken = await fleetRepository.findDriverIdentityByPhone(phone);
      if (taken && taken.driverId !== existing.id) throw AppError.conflict('Phone already registered to a driver');
    }
    const suspended = status === DriverStatus.SUSPENDED && existing.status !== DriverStatus.SUSPENDED;
    const invalidate = phoneChanged || suspended;

    const updated = await getPrisma().$transaction(async (tx) => {
      if (phoneChanged) await fleetRepository.updatePrimaryPhone(existing.id, phone, tx);
      if (invalidate) await fleetRepository.revokeDriverSessions(existing.id, suspended ? 'driver_suspended' : 'phone_changed', tx);
      const driver = await fleetRepository.updateDriver(
        existing.id,
        {
          ...rest,
          ...(status ? { status } : {}),
          ...(licenseExpiry !== undefined ? { licenseExpiry: licenseExpiry ? dateOnly(licenseExpiry) : null } : {}),
          ...(invalidate ? { authzVersion: { increment: 1 } } : {}),
        },
        tx,
      );
      await auditService.record(
        {
          actorAdminId: input.actorAdminId,
          action: suspended ? 'driver.suspended' : 'driver.updated',
          resourceType: 'driver',
          resourceId: existing.id,
          requestId: input.requestId,
          metadata: { fields: Object.keys(input.patch), sessionsRevoked: invalidate },
        },
        tx,
      );
      return driver;
    });
    if (invalidate) await setPrincipalAuthzVersion('driver', updated.id, updated.authzVersion);
    return toDriverDto(updated);
  }
}

export const fleetService = new FleetService();
