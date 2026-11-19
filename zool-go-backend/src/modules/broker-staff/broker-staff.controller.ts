import type { BrokerEmployeeStatus } from '@prisma/client';
import type { Request, Response } from 'express';
import { successResponse } from '../../shared/http/success-response';
import { brokerStaffService } from './broker-staff.service';

export class BrokerStaffController {
  async list(req: Request, res: Response): Promise<Response> {
    const staff = await brokerStaffService.list(req.brokerAuth!.officeId);
    return successResponse(res, {
      statusCode: 200,
      message: 'Staff retrieved successfully',
      data: staff,
      requestId: req.requestId,
    });
  }

  async create(req: Request, res: Response): Promise<Response> {
    const auth = req.brokerAuth!;
    const employee = await brokerStaffService.createClerk({
      officeId: auth.officeId,
      actorEmployeeId: auth.employeeId,
      displayName: req.body.displayName as string,
      phone: req.body.phone as string,
      canBook: req.body.canBook as boolean,
      canTopUp: req.body.canTopUp as boolean,
      canViewReports: req.body.canViewReports as boolean,
      canManageStaff: req.body.canManageStaff as boolean,
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: 201,
      message: 'Staff member created successfully',
      data: employee,
      requestId: req.requestId,
    });
  }

  async update(req: Request, res: Response): Promise<Response> {
    const auth = req.brokerAuth!;
    const employee = await brokerStaffService.update({
      officeId: auth.officeId,
      actorEmployeeId: auth.employeeId,
      employeeId: req.params.employeeId!,
      changes: req.body as {
        displayName?: string;
        canBook?: boolean;
        canTopUp?: boolean;
        canViewReports?: boolean;
        canManageStaff?: boolean;
        status?: BrokerEmployeeStatus;
      },
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: 200,
      message: 'Staff member updated successfully',
      data: employee,
      requestId: req.requestId,
    });
  }
}

export const brokerStaffController = new BrokerStaffController();
