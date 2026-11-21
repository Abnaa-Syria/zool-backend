import { PrincipalType, type Prisma } from '@prisma/client';
import { getPrisma, type PrismaTx } from '../../infrastructure/database/prisma';

export type NotificationType =
  | 'TICKET_ISSUED'
  | 'PAYMENT_SUCCEEDED'
  | 'PAYMENT_FAILED'
  | 'DEPARTURE_REMINDER'
  | 'TRIP_RESCHEDULED'
  | 'TRIP_CANCELLED'
  | 'BOOKING_REFUNDED'
  | 'RATE_TRIP'
  | 'PROMO';

export type NotificationPayload = {
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

/**
 * In-app notification feed (MASTER_PLAN phase 6 adds push delivery via DeviceToken / FCM).
 * Writing the feed row is the source of truth; push is a best-effort side effect.
 */
export class NotificationsService {
  async notify(
    recipients: Array<{ type: PrincipalType; id: string }>,
    payload: NotificationPayload,
    tx?: PrismaTx,
  ): Promise<number> {
    if (recipients.length === 0) return 0;
    const result = await (tx ?? getPrisma()).notification.createMany({
      data: recipients.map((r) => ({
        recipientType: r.type,
        recipientId: r.id,
        type: payload.type,
        title: payload.title,
        body: payload.body,
        data: (payload.data ?? undefined) as Prisma.InputJsonValue | undefined,
      })),
    });
    return result.count;
  }

  /** Active managers of a broker office (who receive office-level alerts). */
  async officeManagers(officeId: string, tx?: PrismaTx) {
    const managers = await (tx ?? getPrisma()).brokerEmployee.findMany({
      where: { officeId, role: 'MANAGER', status: 'ACTIVE' },
      select: { id: true },
    });
    return managers.map((m) => ({ type: PrincipalType.BROKER_EMPLOYEE, id: m.id }));
  }
}

export const notificationsService = new NotificationsService();
