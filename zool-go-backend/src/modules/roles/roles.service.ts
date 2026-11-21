import { getPrisma } from '../../infrastructure/database/prisma';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import {
  invalidatePermissionCache,
  setAuthzVersion,
} from '../../shared/security/authz-cache';
import { SUPER_ADMIN_ROLE_KEY } from '../../shared/constants/permissions';
import { isPermissionKey } from '../../shared/constants/permissions';
import { auditService } from '../audit/audit.service';
import { rolesRepository } from './roles.repository';

function toDto(role: NonNullable<Awaited<ReturnType<typeof rolesRepository.findById>>>) {
  return {
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    isActive: role.isActive,
    memberCount: role._count.userRoles,
    permissions: role.rolePermissions.map((rp) => rp.permission.key).filter(isPermissionKey),
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
  };
}

async function bumpAdmins(adminIds: string[]): Promise<void> {
  for (const adminId of adminIds) {
    const updated = await getPrisma().adminUser.update({
      where: { id: adminId },
      data: { authzVersion: { increment: 1 } },
    });
    await setAuthzVersion(adminId, updated.authzVersion);
    await invalidatePermissionCache(adminId);
  }
}

export class RolesService {
  async list() {
    const roles = await rolesRepository.list();
    return roles.map(toDto);
  }

  async getById(roleId: string) {
    const role = await rolesRepository.findById(roleId);
    if (!role) throw AppError.notFound('Role not found');
    return toDto(role);
  }

  async create(input: {
    key: string;
    name: string;
    description?: string;
    permissionKeys: string[];
    actorAdminId: string;
    requestId?: string;
  }) {
    const existing = await rolesRepository.findByKey(input.key);
    if (existing) throw AppError.conflict('Role key already exists');

    const permissions = await rolesRepository.findPermissionsByKeys(input.permissionKeys);
    if (permissions.length !== input.permissionKeys.length) {
      throw AppError.validation('One or more permission keys are invalid');
    }

    const role = await getPrisma().$transaction(async (tx) => {
      const created = await rolesRepository.create(
        {
          key: input.key,
          name: input.name,
          description: input.description ?? null,
          isSystem: false,
        },
        tx,
      );
      await rolesRepository.setPermissions(
        created.id,
        permissions.map((p) => p.id),
        tx,
      );
      return created;
    });

    await auditService.record({
      actorAdminId: input.actorAdminId,
      action: 'role.created',
      resourceType: 'role',
      resourceId: role.id,
      requestId: input.requestId,
      metadata: { key: role.key, permissionKeys: input.permissionKeys },
    });

    return this.getById(role.id);
  }

  async update(input: {
    roleId: string;
    name?: string;
    description?: string | null;
    isActive?: boolean;
    actorAdminId: string;
    requestId?: string;
  }) {
    const role = await rolesRepository.findById(input.roleId);
    if (!role) throw AppError.notFound('Role not found');

    if (role.key === SUPER_ADMIN_ROLE_KEY && input.isActive === false) {
      throw new AppError({
        message: 'Cannot deactivate the Super Admin system role',
        statusCode: 409,
        code: ErrorCodes.BOOTSTRAP_PROTECTED,
      });
    }

    await rolesRepository.update(input.roleId, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    });

    const members = await rolesRepository.findAdminIdsWithRole(input.roleId);
    await bumpAdmins(members.map((m) => m.adminUserId));

    await auditService.record({
      actorAdminId: input.actorAdminId,
      action: 'role.updated',
      resourceType: 'role',
      resourceId: input.roleId,
      requestId: input.requestId,
      metadata: {
        before: { name: role.name, isActive: role.isActive },
        after: { name: input.name ?? role.name, isActive: input.isActive ?? role.isActive },
      },
    });

    return this.getById(input.roleId);
  }

  async setPermissions(input: {
    roleId: string;
    permissionKeys: string[];
    actorAdminId: string;
    requestId?: string;
  }) {
    const role = await rolesRepository.findById(input.roleId);
    if (!role) throw AppError.notFound('Role not found');

    const permissions = await rolesRepository.findPermissionsByKeys(input.permissionKeys);
    if (permissions.length !== input.permissionKeys.length) {
      throw AppError.validation('One or more permission keys are invalid');
    }

    await getPrisma().$transaction(async (tx) => {
      await rolesRepository.setPermissions(
        input.roleId,
        permissions.map((p) => p.id),
        tx,
      );
    });

    const members = await rolesRepository.findAdminIdsWithRole(input.roleId);
    await bumpAdmins(members.map((m) => m.adminUserId));

    await auditService.record({
      actorAdminId: input.actorAdminId,
      action: 'role.permissions_updated',
      resourceType: 'role',
      resourceId: input.roleId,
      requestId: input.requestId,
      metadata: { permissionKeys: input.permissionKeys },
    });

    return this.getById(input.roleId);
  }

  async delete(input: { roleId: string; actorAdminId: string; requestId?: string }) {
    const role = await rolesRepository.findById(input.roleId);
    if (!role) throw AppError.notFound('Role not found');
    if (role.isSystem || role.key === SUPER_ADMIN_ROLE_KEY) {
      throw new AppError({
        message: 'Cannot delete system role',
        statusCode: 409,
        code: ErrorCodes.BOOTSTRAP_PROTECTED,
      });
    }

    const members = await rolesRepository.findAdminIdsWithRole(input.roleId);
    if (members.length > 0) {
      // Deleting would silently strip the role from admins (possibly leaving them with none).
      throw new AppError({
        message: 'Role is still assigned; reassign its members first',
        statusCode: 409,
        code: ErrorCodes.ROLE_IN_USE,
        details: { memberCount: members.length },
      });
    }
    await rolesRepository.delete(input.roleId);
    await bumpAdmins(members.map((m) => m.adminUserId));

    await auditService.record({
      actorAdminId: input.actorAdminId,
      action: 'role.deleted',
      resourceType: 'role',
      resourceId: input.roleId,
      requestId: input.requestId,
      metadata: { key: role.key },
    });

    return { deleted: true };
  }
}

export const rolesService = new RolesService();
