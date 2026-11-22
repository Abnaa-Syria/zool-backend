import { IdentityType } from '@prisma/client';
import { getPrisma } from '../../infrastructure/database/prisma';

export const driverProfileRepository = {
  findById(id: string) {
    return getPrisma().driver.findUnique({
      where: { id },
      include: {
        company: { select: { id: true, name: true, shortName: true, logoUrl: true, status: true } },
        identities: { where: { type: IdentityType.PHONE }, orderBy: { isPrimary: 'desc' }, take: 1 },
      },
    });
  },
};
