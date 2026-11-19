import type { NextFunction, Request, Response } from 'express';
import { BrokerEmployeeStatus, BrokerOfficeStatus } from '@prisma/client';
import { getPrisma } from '../../infrastructure/database/prisma';
import { brokerPermissionsFromFlags } from '../constants/broker-permissions';
import { AppError } from '../errors/app-error';
import { requireMatchingBrokerAuthzVersion } from '../security/broker-authz-cache';
import { verifyBrokerAccessToken } from '../security/broker-tokens';
import { asyncHandler } from './async-handler';

export const authenticateBroker = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) {
      throw AppError.unauthorized('Missing bearer token');
    }

    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      throw AppError.unauthorized('Missing bearer token');
    }

    const payload = verifyBrokerAccessToken(token);
    await requireMatchingBrokerAuthzVersion(payload.sub, payload.av);

    const employee = await getPrisma().brokerEmployee.findUnique({
      where: { id: payload.sub },
      include: { office: true },
    });

    if (!employee || employee.officeId !== payload.oid) {
      throw AppError.unauthorized('Broker employee not found');
    }
    if (employee.status !== BrokerEmployeeStatus.ACTIVE) {
      throw AppError.unauthorized('Broker employee account is suspended');
    }
    if (employee.office.status !== BrokerOfficeStatus.ACTIVE) {
      throw AppError.unauthorized('Broker office is suspended');
    }

    req.brokerAuth = {
      employeeId: employee.id,
      officeId: employee.officeId,
      authzVersion: payload.av,
      sessionId: payload.sid,
      permissions: brokerPermissionsFromFlags(employee),
      role: employee.role,
    };

    next();
  },
);
