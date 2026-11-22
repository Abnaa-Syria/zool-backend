import type { PermissionKey } from '../constants/permissions';

export interface AuthContext {
  adminId: string;
  authzVersion: number;
  sessionId: string;
  permissions: PermissionKey[];
  roles: Array<{ id: string; key: string; name: string }>;
}

export interface BrokerAuthContext {
  employeeId: string;
  officeId: string;
  authzVersion: number;
  sessionId: string;
  permissions: string[];
  role: 'MANAGER' | 'CLERK';
}

export interface CustomerAuthContext {
  customerId: string;
  sessionId: string;
  authzVersion: number;
}

export interface DriverAuthContext {
  driverId: string;
  companyId: string;
  sessionId: string;
  authzVersion: number;
}

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthContext;
      brokerAuth?: BrokerAuthContext;
      customerAuth?: CustomerAuthContext;
      driverAuth?: DriverAuthContext;
      rawBody?: Buffer;
    }
  }
}

export {};
