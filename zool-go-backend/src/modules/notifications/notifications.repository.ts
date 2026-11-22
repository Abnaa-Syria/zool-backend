import type { DevicePlatform, PrincipalType } from '@prisma/client';
import { getPrisma } from '../../infrastructure/database/prisma';

export const notificationsRepository = {
  async list(type: PrincipalType, id: string, skip: number, take: number) {
    const where = { recipientType: type, recipientId: id };
    const [items, total, unread] = await Promise.all([
      getPrisma().notification.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take }),
      getPrisma().notification.count({ where }),
      getPrisma().notification.count({ where: { ...where, readAt: null } }),
    ]);
    return { items, total, unread };
  },

  unreadCount(type: PrincipalType, id: string) {
    return getPrisma().notification.count({ where: { recipientType: type, recipientId: id, readAt: null } });
  },

  markRead(type: PrincipalType, id: string, notificationId: string) {
    return getPrisma().notification.updateMany({ where: { id: notificationId, recipientType: type, recipientId: id, readAt: null }, data: { readAt: new Date() } });
  },

  exists(type: PrincipalType, id: string, notificationId: string) {
    return getPrisma().notification.count({ where: { id: notificationId, recipientType: type, recipientId: id } });
  },

  markAllRead(type: PrincipalType, id: string) {
    return getPrisma().notification.updateMany({ where: { recipientType: type, recipientId: id, readAt: null }, data: { readAt: new Date() } });
  },

  /** A push token belongs to one principal: re-registering moves it (shared phones, re-login). */
  upsertDevice(type: PrincipalType, id: string, platform: DevicePlatform, token: string) {
    return getPrisma().deviceToken.upsert({
      where: { token },
      create: { principalType: type, principalId: id, platform, token },
      update: { principalType: type, principalId: id, platform, lastSeenAt: new Date() },
    });
  },

  deleteDevice(type: PrincipalType, id: string, token: string) {
    return getPrisma().deviceToken.deleteMany({ where: { token, principalType: type, principalId: id } });
  },

  devicesOf(recipients: Array<{ type: PrincipalType; id: string }>) {
    if (recipients.length === 0) return Promise.resolve([]);
    return getPrisma().deviceToken.findMany({ where: { OR: recipients.map((r) => ({ principalType: r.type, principalId: r.id })) } });
  },

  removeTokens(tokens: string[]) {
    return getPrisma().deviceToken.deleteMany({ where: { token: { in: tokens } } });
  },
};
