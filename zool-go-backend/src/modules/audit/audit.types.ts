export interface AuditWriteInput {
  actorAdminId?: string | null;
  /** Non-admin actor, e.g. CARRIER_EMPLOYEE / BROKER_EMPLOYEE / CUSTOMER / DRIVER */
  actorType?: string | null;
  actorId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}
