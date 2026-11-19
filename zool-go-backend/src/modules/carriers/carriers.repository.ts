import { TransportCompanyStatus, type Prisma } from '@prisma/client';
import { getPrisma } from '../../infrastructure/database/prisma';

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

  update(id: string, data: { name?: string; status?: TransportCompanyStatus }) {
    return getPrisma().transportCompany.update({
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
}

export const carriersRepository = new CarriersRepository();
