import { getPrisma } from '../../infrastructure/database/prisma';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import { setPrincipalAuthzVersion } from '../../shared/security/principal-authz-cache';
import { auditService } from '../audit/audit.service';
import { customerProfileRepository } from '../customer-app/customer-profile.repository';

/**
 * Admin hard delete (the "D" of CRUD) for reference and master data.
 *
 * Rule: a record can be deleted only while nothing depends on it (no trips, bookings, money,
 * history). Otherwise the API answers 409 ENTITY_IN_USE with the usage counts and the dashboard
 * offers the safe alternative (deactivate / suspend / retire), so financial and audit history is
 * never lost. Customers are "deleted" by anonymisation (bookings stay for accounting).
 */
export type DeletableEntity =
  | 'city'
  | 'station'
  | 'amenity'
  | 'vehicle'
  | 'driver'
  | 'route'
  | 'coupon'
  | 'content'
  | 'carrier'
  | 'brokerOffice'
  | 'brokerEmployee'
  | 'carrierEmployee';

type Usage = Record<string, number>;

const ALTERNATIVE: Record<DeletableEntity, string> = {
  city: 'Deactivate the city (isActive=false)',
  station: 'Deactivate the station (isActive=false)',
  amenity: 'Remove it from the vehicles first',
  vehicle: 'Retire the vehicle (status=RETIRED)',
  driver: 'Suspend the driver (status=SUSPENDED)',
  route: 'Deactivate the route (isActive=false)',
  coupon: 'Deactivate the coupon (isActive=false)',
  content: '',
  carrier: 'Suspend the carrier (status=SUSPENDED)',
  brokerOffice: 'Suspend the office (status=SUSPENDED)',
  brokerEmployee: 'Suspend the employee (status=SUSPENDED)',
  carrierEmployee: 'Suspend the employee (status=SUSPENDED)',
};

async function usage(entity: DeletableEntity, id: string): Promise<Usage | null> {
  const p = getPrisma();
  switch (entity) {
    case 'city': {
      if (!(await p.city.findUnique({ where: { id }, select: { id: true } }))) return null;
      return { stations: await p.station.count({ where: { cityId: id } }), recentSearches: 0 };
    }
    case 'station': {
      if (!(await p.station.findUnique({ where: { id }, select: { id: true } }))) return null;
      const [routes, routeStops, trips, tripStops] = await Promise.all([
        p.route.count({ where: { OR: [{ originStationId: id }, { destinationStationId: id }] } }),
        p.routeStop.count({ where: { stationId: id } }),
        p.trip.count({ where: { OR: [{ originStationId: id }, { destinationStationId: id }] } }),
        p.tripStop.count({ where: { stationId: id } }),
      ]);
      return { routes, routeStops, trips, tripStops };
    }
    case 'amenity': {
      if (!(await p.amenity.findUnique({ where: { id }, select: { id: true } }))) return null;
      return { vehicles: await p.vehicleAmenity.count({ where: { amenityId: id } }) };
    }
    case 'vehicle': {
      if (!(await p.vehicle.findUnique({ where: { id }, select: { id: true } }))) return null;
      return { trips: await p.trip.count({ where: { vehicleId: id } }), positions: await p.vehiclePosition.count({ where: { vehicleId: id } }) };
    }
    case 'driver': {
      if (!(await p.driver.findUnique({ where: { id }, select: { id: true } }))) return null;
      const [trips, boardings, cash, positions, scans] = await Promise.all([
        p.trip.count({ where: { driverId: id } }),
        p.ticket.count({ where: { boardedByDriverId: id } }),
        p.cashCollection.count({ where: { driverId: id } }),
        p.vehiclePosition.count({ where: { driverId: id } }),
        p.boardingScan.count({ where: { driverId: id } }),
      ]);
      return { trips, boardings, cashCollections: cash, positions, scans };
    }
    case 'route': {
      if (!(await p.route.findUnique({ where: { id }, select: { id: true } }))) return null;
      return { trips: await p.trip.count({ where: { routeId: id } }) };
    }
    case 'coupon': {
      if (!(await p.coupon.findUnique({ where: { id }, select: { id: true } }))) return null;
      return { redemptions: await p.couponRedemption.count({ where: { couponId: id } }) };
    }
    case 'content': {
      return (await p.contentPage.findUnique({ where: { slug: id }, select: { slug: true } })) ? {} : null;
    }
    case 'carrier': {
      if (!(await p.transportCompany.findUnique({ where: { id }, select: { id: true } }))) return null;
      const [trips, routes, vehicles, drivers, assignments, settlements, coupons, ratings] = await Promise.all([
        p.trip.count({ where: { companyId: id } }),
        p.route.count({ where: { companyId: id } }),
        p.vehicle.count({ where: { companyId: id } }),
        p.driver.count({ where: { companyId: id } }),
        p.brokerCarrierAssignment.count({ where: { companyId: id } }),
        p.carrierSettlement.count({ where: { companyId: id } }),
        p.coupon.count({ where: { companyId: id } }),
        p.carrierRating.count({ where: { companyId: id } }),
      ]);
      return { trips, routes, vehicles, drivers, brokerAssignments: assignments, settlements, coupons, ratings };
    }
    case 'brokerOffice': {
      const office = await p.brokerOffice.findUnique({ where: { id }, select: { id: true, wallet: { select: { id: true, balance: true } } } });
      if (!office) return null;
      const [bookings, ledger, topUps, accruals] = await Promise.all([
        p.booking.count({ where: { officeId: id } }),
        office.wallet ? p.walletLedgerEntry.count({ where: { walletId: office.wallet.id } }) : 0,
        office.wallet ? p.topUpIntent.count({ where: { walletId: office.wallet.id } }) : 0,
        p.commissionAccrual.count({ where: { officeId: id } }),
      ]);
      return { bookings, walletEntries: ledger, topUps, commissions: accruals, walletBalanceMinor: office.wallet?.balance ?? 0 };
    }
    case 'brokerEmployee': {
      if (!(await p.brokerEmployee.findUnique({ where: { id }, select: { id: true } }))) return null;
      return { bookings: await p.booking.count({ where: { employeeId: id } }), topUps: await p.topUpIntent.count({ where: { createdByEmployeeId: id } }) };
    }
    case 'carrierEmployee': {
      const e = await p.carrierEmployee.findUnique({ where: { id }, select: { role: true, companyId: true, status: true } });
      if (!e) return null;
      const lastManager = e.role === 'MANAGER' && e.status === 'ACTIVE' ? await p.carrierEmployee.count({ where: { companyId: e.companyId, role: 'MANAGER', status: 'ACTIVE' } }) : 2;
      return { lastActiveManager: lastManager <= 1 ? 1 : 0 };
    }
  }
}

async function remove(entity: DeletableEntity, id: string) {
  const p = getPrisma();
  switch (entity) {
    case 'city':
      return p.$transaction([p.recentSearch.deleteMany({ where: { OR: [{ fromCityId: id }, { toCityId: id }] } }), p.city.delete({ where: { id } })]);
    case 'station':
      return p.station.delete({ where: { id } });
    case 'amenity':
      return p.amenity.delete({ where: { id } });
    case 'vehicle':
      return p.vehicle.delete({ where: { id } });
    case 'driver':
      return p.driver.delete({ where: { id } });
    case 'route':
      return p.$transaction([p.routeStop.deleteMany({ where: { routeId: id } }), p.route.delete({ where: { id } })]);
    case 'coupon':
      return p.coupon.delete({ where: { id } });
    case 'content':
      return p.contentPage.delete({ where: { slug: id } });
    case 'carrier':
      return p.$transaction([p.carrierEmployee.deleteMany({ where: { companyId: id } }), p.transportCompany.delete({ where: { id } })]);
    case 'brokerOffice':
      return p.brokerOffice.delete({ where: { id } });
    case 'brokerEmployee':
      return p.brokerEmployee.delete({ where: { id } });
    case 'carrierEmployee':
      return p.carrierEmployee.delete({ where: { id } });
  }
}

export class AdminDeleteService {
  /** Deletes when unused, else 409 ENTITY_IN_USE with usage counts and the safe alternative. */
  async delete(entity: DeletableEntity, id: string, actor: { actorAdminId: string; requestId?: string }, scope?: { parentId: string; parent: 'office' | 'company' }) {
    if (scope) {
      const owner =
        scope.parent === 'office'
          ? (await getPrisma().brokerEmployee.findUnique({ where: { id }, select: { officeId: true } }))?.officeId
          : (await getPrisma().carrierEmployee.findUnique({ where: { id }, select: { companyId: true } }))?.companyId;
      if (owner !== scope.parentId) throw AppError.notFound('Not found');
    }
    const used = await usage(entity, id);
    if (!used) throw AppError.notFound('Not found');
    const blocking = Object.entries(used).filter(([k, v]) => v > 0 && k !== 'walletBalanceMinor' && k !== 'recentSearches');
    if (blocking.length > 0 || (used.walletBalanceMinor ?? 0) > 0) {
      throw new AppError({
        statusCode: 409,
        code: ErrorCodes.ENTITY_IN_USE,
        message: `This ${entity} is in use and cannot be deleted. ${ALTERNATIVE[entity]}`.trim(),
        details: { entity, usage: used, alternative: ALTERNATIVE[entity] || null },
      });
    }
    await remove(entity, id);
    await auditService.record({ actorAdminId: actor.actorAdminId, action: `${entity}.deleted`, resourceType: entity, resourceId: id, requestId: actor.requestId });
    return { deleted: true, entity, id };
  }

  /** GDPR-style removal of a customer by an admin: PII anonymised, bookings kept. */
  async deleteCustomer(customerId: string, actor: { actorAdminId: string; requestId?: string }) {
    const c = await getPrisma().customer.findUnique({ where: { id: customerId }, select: { status: true } });
    if (!c) throw AppError.notFound('Customer not found');
    if (c.status === 'DELETED') return { deleted: true, entity: 'customer', id: customerId };
    if ((await customerProfileRepository.countActiveBookings(customerId)) > 0) {
      throw new AppError({ statusCode: 409, code: ErrorCodes.ACCOUNT_HAS_ACTIVE_BOOKINGS, message: 'Cancel the upcoming trips before deleting the customer' });
    }
    const updated = await getPrisma().$transaction(async (tx) => {
      const row = await customerProfileRepository.anonymise(customerId, tx);
      await auditService.record({ actorAdminId: actor.actorAdminId, action: 'customer.deleted', resourceType: 'customer', resourceId: customerId, requestId: actor.requestId }, tx);
      return row;
    });
    await setPrincipalAuthzVersion('customer', customerId, updated.authzVersion);
    return { deleted: true, entity: 'customer', id: customerId };
  }
}

export const adminDeleteService = new AdminDeleteService();
