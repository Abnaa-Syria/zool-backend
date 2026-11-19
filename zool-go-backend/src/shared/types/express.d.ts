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

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthContext;
      brokerAuth?: BrokerAuthContext;
      rawBody?: Buffer;
    }
  }
}

export {};
