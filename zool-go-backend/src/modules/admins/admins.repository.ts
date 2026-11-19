import { AdminStatus, IdentityType, type Prisma } from '@prisma/client';
import { getPrisma, type PrismaTx } from '../../infrastructure/database/prisma';

function client(tx?: PrismaTx) {
  return tx ?? getPrisma();
}

const adminInclude = {
  identities: true,
  userRoles: {
    where: { isActive: true },
    include: { role: true },
  },
} satisfies Prisma.AdminUserInclude;

export class AdminsRepository {
  list(params: { skip: number; take: number }) {
    return Promise.all([
      getPrisma().adminUser.findMany({
        include: adminInclude,
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
      getPrisma().adminUser.count(),
    ]);
  }

  findById(id: string) {
    return getPrisma().adminUser.findUnique({ where: { id }, include: adminInclude });
  }

  create(
    data: {
      displayName: string;
      employeeCode: string;
      phoneNormalized: string;
      roleIds: string[];
      assignedBy: string;
    },
    tx?: PrismaTx,
  ) {
    const db = client(tx);
    return db.adminUser.create({
      data: {
        displayName: data.displayName,
        employeeCode: data.employeeCode,
        status: AdminStatus.ACTIVE,
        identities: {
          create: {
            type: IdentityType.PHONE,
            valueNormalized: data.phoneNormalized,
            isPrimary: true,
            verifiedAt: new Date(),
          },
        },
        userRoles: {
          create: data.roleIds.map((roleId) => ({
            roleId,
            assignedBy: data.assignedBy,
          })),
        },
      },
      include: adminInclude,
    });
  }

  updateStatus(id: string, status: AdminStatus, tx?: PrismaTx) {
    return client(tx).adminUser.update({
      where: { id },
      data: { status, authzVersion: { increment: 1 } },
      include: adminInclude,
    });
  }

  async replaceRoles(adminId: string, roleIds: string[], assignedBy: string, tx?: PrismaTx) {
    const db = client(tx);
    await db.userRole.deleteMany({ where: { adminUserId: adminId } });
    await db.userRole.createMany({
      data: roleIds.map((roleId) => ({
        adminUserId: adminId,
        roleId,
        assignedBy,
        isActive: true,
      })),
    });
    return db.adminUser.update({
      where: { id: adminId },
      data: { authzVersion: { increment: 1 } },
      include: adminInclude,
    });
  }

  findRolesByIds(roleIds: string[]) {
    return getPrisma().role.findMany({ where: { id: { in: roleIds }, isActive: true } });
  }

  countBootstrapAdmins() {
    return getPrisma().adminUser.count({
      where: { isBootstrap: true, status: AdminStatus.ACTIVE },
    });
  }

  updateProfile(id: string, data: { displayName: string }, tx?: PrismaTx) {
    const db = client(tx);
    return db.adminUser.update({
      where: { id },
      data: { displayName: data.displayName },
      include: adminInclude,
    });
  }
}

export const adminsRepository = new AdminsRepository();
