import { BookingStatus, TransportCompanyStatus, TripSeatStatus, TripStatus, type Prisma } from '@prisma/client';
import { getPrisma, type PrismaTx } from '../../infrastructure/database/prisma';

export class CarriersRepository {
  findByKey(key: string) {
    return getPrisma().transportCompany.findUnique({ where: { key } });
  }

  findById(id: string) {
    return getPrisma().transportCompany.findUnique({
      where: { id },
      include: { _count: { select: { brokerAssignments: true } } },
    });
  }

  create(data: { key: string; name: string }) {
    return getPrisma().transportCompany.create({ data });
  }

  update(id: string, data: Prisma.TransportCompanyUpdateInput, tx?: PrismaTx) {
    return (tx ?? getPrisma()).transportCompany.update({
      where: { id },
      data,
      include: { _count: { select: { brokerAssignments: true } } },
    });
  }

  async list(params: {
    skip: number;
    take: number;
    status?: TransportCompanyStatus;
    q?: string;
  }) {
    const where: Prisma.TransportCompanyWhereInput = {
      ...(params.status ? { status: params.status } : {}),
      ...(params.q
        ? { OR: [{ key: { contains: params.q } }, { name: { contains: params.q } }] }
        : {}),
    };
    const [items, total] = await Promise.all([
      getPrisma().transportCompany.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
      getPrisma().transportCompany.count({ where }),
    ]);
    return { items, total };
  }

  listActiveAssignmentsForOffice(officeId: string) {
    return getPrisma().brokerCarrierAssignment.findMany({
      where: { officeId, company: { status: TransportCompanyStatus.ACTIVE } },
      include: { company: true },
      orderBy: { company: { name: 'asc' } },
    });
  }

  /** D-SUS-01: free every seat held on the carrier's not-yet-departed trips. Returns released count. */
  async releaseFutureHolds(companyId: string, tx: PrismaTx): Promise<number> {
    const holds = await tx.seatHold.findMany({
      where: { tripSeat: { trip: { companyId, departureAt: { gt: new Date() } } } },
      select: { id: true, tripSeatId: true },
    });
    if (holds.length === 0) return 0;
    await tx.seatHold.deleteMany({ where: { id: { in: holds.map((h) => h.id) } } });
    await tx.tripSeat.updateMany({
      where: { id: { in: holds.map((h) => h.tripSeatId) }, status: TripSeatStatus.HELD },
      data: { status: TripSeatStatus.FREE },
    });
    return holds.length;
  }

  /** Not-yet-departed, not-cancelled trips of the carrier that still carry confirmed bookings. */
  async listAffectedTrips(companyId: string, params: { skip: number; take: number }) {
    const where: Prisma.TripWhereInput = {
      companyId,
      departureAt: { gt: new Date() },
      status: { in: [TripStatus.SCHEDULED, TripStatus.BOARDING] },
      bookings: { some: { status: BookingStatus.CONFIRMED } },
    };
    const [items, total] = await Promise.all([
      getPrisma().trip.findMany({
        where,
        orderBy: { departureAt: 'asc' },
        skip: params.skip,
        take: params.take,
        select: {
          id: true,
          tripNumber: true,
          origin: true,
          destination: true,
          departureAt: true,
          status: true,
          bookings: {
            where: { status: BookingStatus.CONFIRMED },
            select: { id: true, channel: true, totalAmount: true, _count: { select: { tickets: true } } },
          },
        },
      }),
      getPrisma().trip.count({ where }),
    ]);
    return { items, total };
  }
}

export const carriersRepository = new CarriersRepository();
