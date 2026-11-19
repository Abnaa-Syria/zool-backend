import type { Request, Response } from 'express';
import { successResponse } from '../../shared/http/success-response';
import { sessionsService } from '../sessions/sessions.service';
import { adminsService } from './admins.service';

export class AdminsController {
  async list(req: Request, res: Response): Promise<Response> {
    const result = await adminsService.list(req.query as { page?: number; pageSize?: number });
    return successResponse(res, {
      statusCode: 200,
      message: 'Admins retrieved successfully',
      data: result.items,
      meta: result.meta,
      requestId: req.requestId,
    });
  }

  async get(req: Request, res: Response): Promise<Response> {
    const admin = await adminsService.getById(req.params.adminId!);
    return successResponse(res, {
      statusCode: 200,
      message: 'Admin retrieved successfully',
      data: admin,
      requestId: req.requestId,
    });
  }

  async create(req: Request, res: Response): Promise<Response> {
    const admin = await adminsService.create({
      displayName: req.body.displayName,
      employeeCode: req.body.employeeCode,
      phone: req.body.phone,
      roleIds: req.body.roleIds,
      actorAdminId: req.auth!.adminId,
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: 201,
      message: 'Admin created successfully',
      data: admin,
      requestId: req.requestId,
    });
  }

  async updateStatus(req: Request, res: Response): Promise<Response> {
    const admin = await adminsService.updateStatus({
      adminId: req.params.adminId!,
      status: req.body.status,
      actorAdminId: req.auth!.adminId,
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: 200,
      message: 'Admin status updated successfully',
      data: admin,
      requestId: req.requestId,
    });
  }

  async setRoles(req: Request, res: Response): Promise<Response> {
    const admin = await adminsService.setRoles({
      adminId: req.params.adminId!,
      roleIds: req.body.roleIds,
      actorAdminId: req.auth!.adminId,
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: 200,
      message: 'Admin roles updated successfully',
      data: admin,
      requestId: req.requestId,
    });
  }

  async updateProfile(req: Request, res: Response): Promise<Response> {
    const admin = await adminsService.updateProfile({
      adminId: req.params.adminId!,
      displayName: req.body.displayName as string,
      actorAdminId: req.auth!.adminId,
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: 200,
      message: 'Admin profile updated successfully',
      data: admin,
      requestId: req.requestId,
    });
  }

  async revokeAllSessions(req: Request, res: Response): Promise<Response> {
    const result = await sessionsService.revokeAllForAdmin({
      adminId: req.params.adminId!,
      actorAdminId: req.auth!.adminId,
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: 200,
      message:
        result.revokedCount === 0
          ? 'No active sessions to revoke'
          : 'Admin sessions revoked successfully',
      data: result,
      requestId: req.requestId,
    });
  }
}

export const adminsController = new AdminsController();
