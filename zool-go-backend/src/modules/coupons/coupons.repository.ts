import type { Prisma } from '@prisma/client';
import { getPrisma } from '../../infrastructure/database/prisma';

export class CouponsRepository {
  async list(params: { where: Prisma.CouponWhereInput; skip: number; take: number }) {
    const [items, total] = await Promise.all([
      getPrisma().coupon.findMany({ where: params.where, orderBy: { createdAt: 'desc' }, skip: params.skip, take: params.take }),
      getPrisma().coupon.count({ where: params.where }),
    ]);
    return { items, total };
  }

  findById(id: string) {
    return getPrisma().coupon.findUnique({ where: { id } });
  }

  companyExists(id: string) {
    return getPrisma().transportCompany.findUnique({ where: { id }, select: { id: true } });
  }

  create(data: Prisma.CouponUncheckedCreateInput) {
    return getPrisma().coupon.create({ data });
  }

  listPromotions(now: Date) {
    return getPrisma().coupon.findMany({
      where: { showInApp: true, isActive: true, validFrom: { lte: now }, validTo: { gt: now } },
      include: { company: { select: { id: true, name: true } } },
      orderBy: [{ promoSortOrder: 'desc' }, { validTo: 'asc' }],
      take: 10,
    });
  }

  update(id: string, data: Prisma.CouponUpdateInput) {
    return getPrisma().coupon.update({ where: { id }, data });
  }
}

export const couponsRepository = new CouponsRepository();
