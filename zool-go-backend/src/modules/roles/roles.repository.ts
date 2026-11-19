import type { Prisma } from '@prisma/client';
import { getPrisma, type PrismaTx } from '../../infrastructure/database/prisma';

function client(tx?: PrismaTx) {
  return tx ?? getPrisma();
}

const roleInclude = {
  rolePermissions: { include: { permission: true } },
  _count: { select: { userRoles: true } },
} satisfies Prisma.RoleInclude;

export class RolesRepository {
  list() {
    return getPrisma().role.findMany({
      include: roleInclude,
      orderBy: { name: 'asc' },
    });
  }

  findById(id: string) {
    return getPrisma().role.findUnique({ where: { id }, include: roleInclude });
  }

  findByKey(key: string) {
    return getPrisma().role.findUnique({ where: { key } });
  }

  create(
    data: { key: string; name: string; description?: string | null; isSystem?: boolean },
    tx?: PrismaTx,
  ) {
    return client(tx).role.create({ data });
  }

  update(id: string, data: Prisma.RoleUpdateInput, tx?: PrismaTx) {
    return client(tx).role.update({ where: { id }, data });
  }

  delete(id: string, tx?: PrismaTx) {
    return client(tx).role.delete({ where: { id } });
  }

  async setPermissions(roleId: string, permissionIds: string[], tx?: PrismaTx) {
    const db = client(tx);
    await db.rolePermission.deleteMany({ where: { roleId } });
    if (permissionIds.length === 0) return;
    await db.rolePermission.createMany({
      data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
    });
  }

  findPermissionsByKeys(keys: string[]) {
    return getPrisma().permission.findMany({ where: { key: { in: keys } } });
  }

  findAdminIdsWithRole(roleId: string) {
    return getPrisma().userRole.findMany({
      where: { roleId, isActive: true },
      select: { adminUserId: true },
    });
  }
}

export const rolesRepository = new RolesRepository();
