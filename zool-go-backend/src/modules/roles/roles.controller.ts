import type { Request, Response } from 'express';
import { successResponse } from '../../shared/http/success-response';
import { rolesService } from './roles.service';

export class RolesController {
  async list(req: Request, res: Response): Promise<Response> {
    const roles = await rolesService.list();
    return successResponse(res, {
      statusCode: 200,
      message: 'Roles retrieved successfully',
      data: roles,
      requestId: req.requestId,
    });
  }

  async get(req: Request, res: Response): Promise<Response> {
    const role = await rolesService.getById(req.params.roleId!);
    return successResponse(res, {
      statusCode: 200,
      message: 'Role retrieved successfully',
      data: role,
      requestId: req.requestId,
    });
  }

  async create(req: Request, res: Response): Promise<Response> {
    const role = await rolesService.create({
      key: req.body.key,
      name: req.body.name,
      description: req.body.description,
      permissionKeys: req.body.permissionKeys ?? [],
      actorAdminId: req.auth!.adminId,
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: 201,
      message: 'Role created successfully',
      data: role,
      requestId: req.requestId,
    });
  }

  async update(req: Request, res: Response): Promise<Response> {
    const role = await rolesService.update({
      roleId: req.params.roleId!,
      name: req.body.name,
      description: req.body.description,
      isActive: req.body.isActive,
      actorAdminId: req.auth!.adminId,
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: 200,
      message: 'Role updated successfully',
      data: role,
      requestId: req.requestId,
    });
  }

  async setPermissions(req: Request, res: Response): Promise<Response> {
    const role = await rolesService.setPermissions({
      roleId: req.params.roleId!,
      permissionKeys: req.body.permissionKeys,
      actorAdminId: req.auth!.adminId,
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: 200,
      message: 'Role permissions updated successfully',
      data: role,
      requestId: req.requestId,
    });
  }

  async remove(req: Request, res: Response): Promise<Response> {
    const result = await rolesService.delete({
      roleId: req.params.roleId!,
      actorAdminId: req.auth!.adminId,
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: 200,
      message: 'Role deleted successfully',
      data: result,
      requestId: req.requestId,
    });
  }
}

export const rolesController = new RolesController();
