import { CouponDiscountType, Prisma, type Coupon } from '@prisma/client';
import { couponsRepository } from './coupons.repository';
import { AppError } from '../../shared/errors/app-error';
import { paginationMeta, parsePagination } from '../../shared/utils/pagination';
import { auditService } from '../audit/audit.service';

export function toCouponDto(c: Coupon) {
  return {
    id: c.id,
    code: c.code,
    discountType: c.discountType,
    /** PERCENT: basis points (2500 = 25%); FIXED: minor units */
    value: c.value,
    maxDiscountAmountMinor: c.maxDiscountAmount,
    minSubtotalAmountMinor: c.minSubtotalAmount,
    companyId: c.companyId,
    validFrom: c.validFrom.toISOString(),
    validTo: c.validTo.toISOString(),
    maxRedemptions: c.maxRedemptions,
    perCustomerLimit: c.perCustomerLimit,
    redeemedCount: c.redeemedCount,
    isActive: c.isActive,
    showInApp: c.showInApp,
    promoTitleAr: c.promoTitleAr,
    promoSubtitleAr: c.promoSubtitleAr,
    promoImageUrl: c.promoImageUrl,
    promoSortOrder: c.promoSortOrder,
    createdAt: c.createdAt.toISOString(),
  };
}

/**
 * Discount computation shared by quote/checkout (phase 6). Integer math only:
 * percent in basis points, floor, then capped by maxDiscountAmount and the subtotal.
 */
export function computeCouponDiscount(coupon: Pick<Coupon, 'discountType' | 'value' | 'maxDiscountAmount'>, subtotalMinor: number): number {
  const raw =
    coupon.discountType === CouponDiscountType.PERCENT
      ? Math.floor((subtotalMinor * coupon.value) / 10_000)
      : coupon.value;
  const capped = coupon.maxDiscountAmount !== null ? Math.min(raw, coupon.maxDiscountAmount) : raw;
  return Math.max(0, Math.min(capped, subtotalMinor));
}

type CouponInput = {
  code: string;
  discountType: 'PERCENT' | 'FIXED';
  value: number;
  maxDiscountAmountMinor?: number;
  minSubtotalAmountMinor?: number;
  companyId?: string;
  validFrom: Date;
  validTo: Date;
  maxRedemptions?: number;
  perCustomerLimit?: number;
} & PromoFields;

/** D-PROMO-01 banner fields (admin-managed). */
export type PromoFields = {
  showInApp?: boolean;
  promoTitleAr?: string | null;
  promoSubtitleAr?: string | null;
  promoImageUrl?: string | null;
  promoSortOrder?: number;
};

export class CouponsService {
  async list(query: { page?: number; pageSize?: number; q?: string; isActive?: boolean }) {
    const { page, pageSize, skip, take } = parsePagination(query);
    const where: Prisma.CouponWhereInput = {
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.q ? { code: { contains: query.q.toUpperCase() } } : {}),
    };
    const { items, total } = await couponsRepository.list({ where, skip, take });
    return { items: items.map(toCouponDto), meta: paginationMeta(page, pageSize, total) };
  }

  async create(input: CouponInput & { actorAdminId: string; requestId?: string }) {
    if (input.validFrom >= input.validTo) throw AppError.validation('validFrom must be before validTo', { field: 'validTo' });
    if (input.discountType === 'PERCENT' && (input.value < 1 || input.value > 10_000)) {
      throw AppError.validation('Percent value is in basis points (1..10000)', { field: 'value' });
    }
    if (input.companyId && !(await couponsRepository.companyExists(input.companyId))) {
      throw AppError.notFound('Transport company not found');
    }
    try {
      const coupon = await couponsRepository.create({
        code: input.code,
        discountType: input.discountType,
        value: input.value,
        maxDiscountAmount: input.maxDiscountAmountMinor ?? null,
        minSubtotalAmount: input.minSubtotalAmountMinor ?? null,
        companyId: input.companyId ?? null,
        validFrom: input.validFrom,
        validTo: input.validTo,
        maxRedemptions: input.maxRedemptions ?? null,
        perCustomerLimit: input.perCustomerLimit ?? 1,
        showInApp: input.showInApp ?? false,
        promoTitleAr: input.promoTitleAr ?? null,
        promoSubtitleAr: input.promoSubtitleAr ?? null,
        promoImageUrl: input.promoImageUrl ?? null,
        promoSortOrder: input.promoSortOrder ?? 0,
      });
      await auditService.record({
        actorAdminId: input.actorAdminId,
        action: 'coupon.created',
        resourceType: 'coupon',
        resourceId: coupon.id,
        requestId: input.requestId,
        metadata: { code: coupon.code, discountType: coupon.discountType, value: coupon.value },
      });
      return toCouponDto(coupon);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw AppError.conflict('Coupon code already exists');
      }
      throw error;
    }
  }

  async update(input: {
    couponId: string;
    patch: { isActive?: boolean; validTo?: Date; maxRedemptions?: number | null } & PromoFields;
    actorAdminId: string;
    requestId?: string;
  }) {
    const existing = await couponsRepository.findById(input.couponId);
    if (!existing) throw AppError.notFound('Coupon not found');
    if (input.patch.validTo && input.patch.validTo <= existing.validFrom) {
      throw AppError.validation('validTo must be after validFrom', { field: 'validTo' });
    }
    if (input.patch.maxRedemptions != null && input.patch.maxRedemptions < existing.redeemedCount) {
      throw AppError.validation('maxRedemptions cannot be below redemptions already made', { field: 'maxRedemptions' });
    }
    const coupon = await couponsRepository.update(existing.id, input.patch);
    await auditService.record({
      actorAdminId: input.actorAdminId,
      action: 'coupon.updated',
      resourceType: 'coupon',
      resourceId: coupon.id,
      requestId: input.requestId,
      metadata: { fields: Object.keys(input.patch) },
    });
    return toCouponDto(coupon);
  }

  /**
   * D-PROMO-01: active coupons marked «show in app», as home banners (newest sort order first
   * by promoSortOrder, then the soonest to expire). Exhausted coupons are left out.
   */
  async promotions() {
    const now = new Date();
    const rows = await couponsRepository.listPromotions(now);
    return rows
      .filter((c) => c.maxRedemptions === null || c.redeemedCount < c.maxRedemptions)
      .map((c) => ({
        couponId: c.id,
        code: c.code,
        titleAr: c.promoTitleAr ?? (c.discountType === 'PERCENT' ? `خصم ${c.value / 100}%` : `خصم ${c.value / 100} ج.س`),
        subtitleAr: c.promoSubtitleAr,
        imageUrl: c.promoImageUrl,
        discountType: c.discountType,
        value: c.value,
        maxDiscountAmountMinor: c.maxDiscountAmount,
        minSubtotalAmountMinor: c.minSubtotalAmount,
        carrier: c.company ? { id: c.company.id, name: c.company.name } : null,
        validTo: c.validTo.toISOString(),
      }));
  }
}

export const couponsService = new CouponsService();
