import { PrincipalType, type DevicePlatform, type Prisma } from '@prisma/client';
import { getPrisma, type PrismaTx } from '../../infrastructure/database/prisma';
import { logger } from '../../infrastructure/observability/logger';
import { AppError } from '../../shared/errors/app-error';
import { paginationMeta, parsePagination } from '../../shared/utils/pagination';
import { notificationsRepository } from './notifications.repository';
import { getPushProvider, isPushMuted } from './push-provider';

export type NotificationType =
  | 'TICKET_ISSUED'
  | 'PAYMENT_SUCCEEDED'
  | 'PAYMENT_FAILED'
  | 'DEPARTURE_REMINDER'
  | 'TRIP_RESCHEDULED'
  | 'TRIP_CANCELLED'
  | 'BOOKING_REFUNDED'
  | 'RATE_TRIP'
  | 'TRIP_ASSIGNED'
  | 'TRIP_UNASSIGNED'
  | 'PROMO';

export type NotificationPayload = {
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

type Recipient = { type: PrincipalType; id: string };

/**
 * In-app notification feed + push. Writing the feed row is the source of truth; push is a
 * best-effort side effect sent after the current tick (so a caller's transaction usually commits
 * first) through the PushProvider port (FCM at phase 7).
 */
export class NotificationsService {
  async notify(recipients: Recipient[], payload: NotificationPayload, tx?: PrismaTx): Promise<number> {
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
    if (!isPushMuted()) setImmediate(() => void this.push(recipients, payload));
    return result.count;
  }

  private async push(recipients: Recipient[], payload: NotificationPayload): Promise<void> {
    try {
      const devices = await notificationsRepository.devicesOf(recipients);
      if (devices.length === 0) return;
      const data = Object.fromEntries(Object.entries({ type: payload.type, ...(payload.data ?? {}) }).map(([k, v]) => [k, String(v)]));
      const { invalidTokens } = await getPushProvider().send(
        devices.map((d) => ({ token: d.token, platform: d.platform, title: payload.title, body: payload.body, data })),
      );
      if (invalidTokens.length > 0) await notificationsRepository.removeTokens(invalidTokens);
    } catch (err) {
      logger.warn({ err }, 'Push delivery failed');
    }
  }

  /** Active managers of a broker office (who receive office-level alerts). */
  async officeManagers(officeId: string, tx?: PrismaTx) {
    const managers = await (tx ?? getPrisma()).brokerEmployee.findMany({
      where: { officeId, role: 'MANAGER', status: 'ACTIVE' },
      select: { id: true },
    });
    return managers.map((m) => ({ type: PrincipalType.BROKER_EMPLOYEE, id: m.id }));
  }

  // ---------------------------------------------------------------- feed (any app principal)

  async feed(r: Recipient, query: { page?: number; pageSize?: number }) {
    const { page, pageSize, skip, take } = parsePagination(query);
    const { items, total, unread } = await notificationsRepository.list(r.type, r.id, skip, take);
    return {
      items: items.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        data: n.data,
        isRead: n.readAt !== null,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
      meta: { ...paginationMeta(page, pageSize, total), unread },
    };
  }

  async unreadCount(r: Recipient) {
    return { unread: await notificationsRepository.unreadCount(r.type, r.id) };
  }

  async markRead(r: Recipient, notificationId: string) {
    if ((await notificationsRepository.exists(r.type, r.id, notificationId)) === 0) throw AppError.notFound('Notification not found');
    await notificationsRepository.markRead(r.type, r.id, notificationId);
    return this.unreadCount(r);
  }

  async markAllRead(r: Recipient) {
    const { count } = await notificationsRepository.markAllRead(r.type, r.id);
    return { marked: count, unread: 0 };
  }

  async registerDevice(r: Recipient, platform: DevicePlatform, token: string) {
    const d = await notificationsRepository.upsertDevice(r.type, r.id, platform, token);
    return { token: d.token, platform: d.platform, registeredAt: d.createdAt.toISOString() };
  }

  async removeDevice(r: Recipient, token: string) {
    await notificationsRepository.deleteDevice(r.type, r.id, token);
    return { removed: true };
  }
}

export const notificationsService = new NotificationsService();
