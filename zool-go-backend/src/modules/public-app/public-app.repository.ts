import { TransportCompanyStatus, TripStatus } from '@prisma/client';
import { getPrisma } from '../../infrastructure/database/prisma';

export const publicAppRepository = {
  /** Active cities with their active stations (from/to pickers). */
  listCities(q?: string) {
    return getPrisma().city.findMany({
      where: {
        isActive: true,
        ...(q ? { OR: [{ code: { contains: q } }, { nameAr: { contains: q } }, { nameEn: { contains: q } }] } : {}),
      },
      include: {
        stations: {
          where: { isActive: true },
          select: { id: true, nameAr: true, nameEn: true, address: true, latitude: true, longitude: true },
          orderBy: { nameEn: 'asc' },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
    });
  },

  listPopularCities() {
    return getPrisma().city.findMany({
      where: { isActive: true, isPopular: true },
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
      take: 20,
    });
  },

  /** Cheapest bookable upcoming trip into a city (sellable carriers only, D-SUS-01). */
  async minUpcomingPriceInto(cityId: string): Promise<number | null> {
    const r = await getPrisma().trip.aggregate({
      _min: { basePrice: true },
      where: {
        isActive: true,
        status: TripStatus.SCHEDULED,
        departureAt: { gt: new Date() },
        destinationStation: { cityId },
        company: { status: TransportCompanyStatus.ACTIVE },
      },
    });
    return r._min.basePrice;
  },
};
