import type { BrokerEmployeeStatus, BrokerOfficeStatus, SettlementPeriod } from '@prisma/client';
import type { Request, Response } from 'express';
import { successResponse } from '../../shared/http/success-response';
import { brokerStaffService } from '../broker-staff/broker-staff.service';
import { brokersService } from './brokers.service';

export class BrokersController {
  async list(req: Request, res: Response): Promise<Response> {
    const result = await brokersService.list(
      req.query as { page?: number; pageSize?: number; status?: BrokerOfficeStatus; q?: string },
    );
    return successResponse(res, {
      statusCode: 200,
      message: 'Broker offices retrieved successfully',
      data: result.items,
      meta: result.meta,
      requestId: req.requestId,
    });
  }

  async get(req: Request, res: Response): Promise<Response> {
    const office = await brokersService.getById(req.params.officeId!);
    return successResponse(res, {
      statusCode: 200,
      message: 'Broker office retrieved successfully',
      data: office,
      requestId: req.requestId,
    });
  }

  async create(req: Request, res: Response): Promise<Response> {
    const office = await brokersService.create({
      code: req.body.code as string,
      name: req.body.name as string,
      settlementPeriod: req.body.settlementPeriod as SettlementPeriod | undefined,
      minTopUpMinorOverride: req.body.minTopUpMinorOverride as number | undefined,
      exposureCeilingOverride: req.body.exposureCeilingOverride as number | undefined,
      lowBalanceThresholdMinorOverride: req.body.lowBalanceThresholdMinorOverride as
        | number
        | undefined,
      timeZone: req.body.timeZone as string | undefined,
      manager: req.body.manager as { displayName: string; phone: string } | undefined,
      actorAdminId: req.auth!.adminId,
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: 201,
      message: 'Broker office created successfully',
      data: office,
      requestId: req.requestId,
    });
  }

  async replaceCarriers(req: Request, res: Response): Promise<Response> {
    const office = await brokersService.replaceCarriers({
      officeId: req.params.officeId!,
      assignments: req.body.assignments as Array<{ companyId: string; commissionPercent: number }>,
      actorAdminId: req.auth!.adminId,
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: 200,
      message: 'Carrier assignments updated successfully',
      data: office,
      requestId: req.requestId,
    });
  }

  async updateStatus(req: Request, res: Response): Promise<Response> {
    const office = await brokersService.updateStatus({
      officeId: req.params.officeId!,
      status: req.body.status as BrokerOfficeStatus,
      actorAdminId: req.auth!.adminId,
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: 200,
      message: 'Broker office status updated successfully',
      data: office,
      requestId: req.requestId,
    });
  }

  async updatePolicy(req: Request, res: Response): Promise<Response> {
    const office = await brokersService.updatePolicy({
      officeId: req.params.officeId!,
      name: req.body.name as string | undefined,
      settlementPeriod: req.body.settlementPeriod as SettlementPeriod | undefined,
      minTopUpMinorOverride: req.body.minTopUpMinorOverride as number | null | undefined,
      exposureCeilingOverride: req.body.exposureCeilingOverride as number | null | undefined,
      lowBalanceThresholdMinorOverride: req.body.lowBalanceThresholdMinorOverride as
        | number
        | null
        | undefined,
      timeZone: req.body.timeZone as string | null | undefined,
      actorAdminId: req.auth!.adminId,
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: 200,
      message: 'Broker office policy updated successfully',
      data: office,
      requestId: req.requestId,
    });
  }

  async createStaff(req: Request, res: Response): Promise<Response> {
    const employee = await brokerStaffService.createClerk({
      officeId: req.params.officeId!,
      actorAdminId: req.auth!.adminId,
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

  async updateStaff(req: Request, res: Response): Promise<Response> {
    const employee = await brokerStaffService.update({
      officeId: req.params.officeId!,
      actorAdminId: req.auth!.adminId,
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

export const brokersController = new BrokersController();
