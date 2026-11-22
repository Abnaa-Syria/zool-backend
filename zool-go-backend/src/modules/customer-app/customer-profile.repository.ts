import { BookingStatus, IdentityType, type Prisma } from '@prisma/client';
import { getPrisma, type PrismaTx } from '../../infrastructure/database/prisma';

const profileInclude = {
  identities: { where: { type: IdentityType.PHONE }, orderBy: { isPrimary: 'desc' }, take: 1 },
} satisfies Prisma.CustomerInclude;

export type CustomerProfileRow = Prisma.CustomerGetPayload<{ include: typeof profileInclude }>;

export const customerProfileRepository = {
  findById(id: string) {
    return getPrisma().customer.findUnique({ where: { id }, include: profileInclude });
  },

  update(id: string, data: Prisma.CustomerUpdateInput, tx?: PrismaTx) {
    return (tx ?? getPrisma()).customer.update({ where: { id }, data, include: profileInclude });
  },

  /** Confirmed bookings and the distinct destination cities they reach (profile stats). */
  async travelStats(customerId: string) {
    const rows = await getPrisma().booking.findMany({
      where: { customerId, status: BookingStatus.CONFIRMED },
      select: { trip: { select: { destination: true, destinationStation: { select: { cityId: true } } } } },
    });
    const cities = new Set(rows.map((r) => r.trip.destinationStation?.cityId ?? r.trip.destination));
    return { tripsCount: rows.length, destinationsCount: cities.size };
  },

  countActiveBookings(customerId: string) {
    return getPrisma().booking.count({
      where: {
        customerId,
        status: { in: [BookingStatus.CONFIRMED, BookingStatus.PENDING_PAYMENT] },
        trip: { departureAt: { gt: new Date() }, status: { notIn: ['CANCELLED', 'COMPLETED'] } },
      },
    });
  },

  /** Removes everything that identifies the person; bookings stay for accounting. */
  async anonymise(customerId: string, tx: PrismaTx) {
    await tx.customerIdentity.deleteMany({ where: { customerId } });
    await tx.customerOtpChallenge.deleteMany({ where: { customerId } });
    await tx.recentSearch.deleteMany({ where: { customerId } });
    await tx.deviceToken.deleteMany({ where: { principalType: 'CUSTOMER', principalId: customerId } });
    await tx.customerRefreshSession.updateMany({
      where: { customerId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: 'account_deleted' },
    });
    return tx.customer.update({
      where: { id: customerId },
      data: {
        displayName: null,
        email: null,
        avatarUrl: null,
        status: 'DELETED',
        deletedAt: new Date(),
        authzVersion: { increment: 1 },
      },
    });
  },
};
