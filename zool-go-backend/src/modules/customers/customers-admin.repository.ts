import { BookingStatus, IdentityType, type Prisma } from '@prisma/client';
import { getPrisma, type PrismaTx } from '../../infrastructure/database/prisma';

export const customerInclude = {
  identities: { where: { type: IdentityType.PHONE, isPrimary: true } },
  _count: { select: { bookings: true } },
} satisfies Prisma.CustomerInclude;

export type CustomerRow = Prisma.CustomerGetPayload<{ include: typeof customerInclude }>;

export class CustomersAdminRepository {
  async list(params: { where: Prisma.CustomerWhereInput; skip: number; take: number }) {
    const [items, total] = await Promise.all([
      getPrisma().customer.findMany({ where: params.where, include: customerInclude, orderBy: { createdAt: 'desc' }, skip: params.skip, take: params.take }),
      getPrisma().customer.count({ where: params.where }),
    ]);
    return { items, total };
  }

  findById(id: string) {
    return getPrisma().customer.findUnique({ where: { id }, include: customerInclude });
  }

  countBookings(customerId: string, status: BookingStatus) {
    return getPrisma().booking.count({ where: { customerId, status } });
  }

  revokeSessions(customerId: string, reason: string, tx: PrismaTx) {
    return tx.customerRefreshSession.updateMany({
      where: { customerId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }

  update(id: string, data: Prisma.CustomerUpdateInput, tx: PrismaTx) {
    return tx.customer.update({ where: { id }, data });
  }
}

export const customersAdminRepository = new CustomersAdminRepository();
