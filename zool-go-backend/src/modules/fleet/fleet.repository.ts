import { IdentityType, type Prisma } from '@prisma/client';
import { getPrisma, type PrismaTx } from '../../infrastructure/database/prisma';

function client(tx?: PrismaTx) {
  return tx ?? getPrisma();
}

const vehicleInclude = {
  company: { select: { id: true, key: true, name: true } },
  amenities: { include: { amenity: true } },
} satisfies Prisma.VehicleInclude;

const driverInclude = {
  company: { select: { id: true, key: true, name: true } },
  identities: { where: { type: IdentityType.PHONE, isPrimary: true } },
} satisfies Prisma.DriverInclude;

export type VehicleRow = Prisma.VehicleGetPayload<{ include: typeof vehicleInclude }>;
export type DriverRow = Prisma.DriverGetPayload<{ include: typeof driverInclude }>;

export class FleetRepository {
  findCompany(id: string) {
    return getPrisma().transportCompany.findUnique({ where: { id }, select: { id: true } });
  }

  findAmenitiesByCodes(codes: string[]) {
    return getPrisma().amenity.findMany({ where: { code: { in: codes } } });
  }

  // ---- Vehicles
  async listVehicles(params: { skip: number; take: number; companyId?: string; status?: Prisma.VehicleWhereInput['status']; q?: string }) {
    const where: Prisma.VehicleWhereInput = {
      ...(params.companyId ? { companyId: params.companyId } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.q ? { OR: [{ plateNumber: { contains: params.q } }, { model: { contains: params.q } }] } : {}),
    };
    const [items, total] = await Promise.all([
      getPrisma().vehicle.findMany({ where, include: vehicleInclude, orderBy: { createdAt: 'desc' }, skip: params.skip, take: params.take }),
      getPrisma().vehicle.count({ where }),
    ]);
    return { items, total };
  }

  findVehicleById(id: string) {
    return getPrisma().vehicle.findUnique({ where: { id }, include: vehicleInclude });
  }

  createVehicle(data: Prisma.VehicleUncheckedCreateInput, tx?: PrismaTx) {
    return client(tx).vehicle.create({ data, include: vehicleInclude });
  }

  updateVehicle(id: string, data: Prisma.VehicleUncheckedUpdateInput, tx?: PrismaTx) {
    return client(tx).vehicle.update({ where: { id }, data, include: vehicleInclude });
  }

  async replaceVehicleAmenities(vehicleId: string, rows: Array<{ amenityId: string; value: string | null }>, tx: PrismaTx) {
    await tx.vehicleAmenity.deleteMany({ where: { vehicleId } });
    if (rows.length > 0) {
      await tx.vehicleAmenity.createMany({ data: rows.map((r) => ({ vehicleId, ...r })) });
    }
  }

  // ---- Drivers
  async listDrivers(params: { skip: number; take: number; companyId?: string; status?: Prisma.DriverWhereInput['status']; q?: string }) {
    const where: Prisma.DriverWhereInput = {
      ...(params.companyId ? { companyId: params.companyId } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.q
        ? {
            OR: [
              { displayName: { contains: params.q } },
              { driverCode: { contains: params.q } },
              { identities: { some: { valueNormalized: { contains: params.q } } } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      getPrisma().driver.findMany({ where, include: driverInclude, orderBy: { createdAt: 'desc' }, skip: params.skip, take: params.take }),
      getPrisma().driver.count({ where }),
    ]);
    return { items, total };
  }

  findDriverById(id: string) {
    return getPrisma().driver.findUnique({ where: { id }, include: driverInclude });
  }

  findDriverIdentityByPhone(phone: string) {
    return getPrisma().driverIdentity.findUnique({
      where: { type_valueNormalized: { type: IdentityType.PHONE, valueNormalized: phone } },
    });
  }

  driverCodeExists(code: string) {
    return getPrisma().driver.findUnique({ where: { driverCode: code }, select: { id: true } });
  }

  createDriver(data: Prisma.DriverUncheckedCreateInput, tx?: PrismaTx) {
    return client(tx).driver.create({ data, include: driverInclude });
  }

  updateDriver(id: string, data: Prisma.DriverUncheckedUpdateInput, tx?: PrismaTx) {
    return client(tx).driver.update({ where: { id }, data, include: driverInclude });
  }

  updatePrimaryPhone(driverId: string, phone: string, tx: PrismaTx) {
    return tx.driverIdentity.updateMany({
      where: { driverId, type: IdentityType.PHONE, isPrimary: true },
      data: { valueNormalized: phone, verifiedAt: new Date() },
    });
  }

  revokeDriverSessions(driverId: string, reason: string, tx: PrismaTx) {
    return tx.driverRefreshSession.updateMany({
      where: { driverId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }
}

export const fleetRepository = new FleetRepository();
