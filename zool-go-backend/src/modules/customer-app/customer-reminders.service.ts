import { BookingChannel, BookingStatus, PrincipalType, TripStatus } from '@prisma/client';
import { getPrisma } from '../../infrastructure/database/prisma';
import { getRedis, redisKey } from '../../infrastructure/redis/redis';
import { notificationsService } from '../notifications/notifications.service';

const REMINDER_LEAD_MS = 2 * 60 * 60 * 1000;

/**
 * DEPARTURE_REMINDER about two hours before departure, once per booking (Redis NX marker), for
 * customers who keep trip alerts on. Runs from the periodic sweeper.
 */
export async function sendDepartureReminders(): Promise<number> {
  const now = Date.now();
  const bookings = await getPrisma().booking.findMany({
    where: {
      channel: BookingChannel.DIRECT,
      status: BookingStatus.CONFIRMED,
      customer: { tripAlertsEnabled: true, status: 'ACTIVE' },
      trip: { status: { in: [TripStatus.SCHEDULED, TripStatus.BOARDING] }, departureAt: { gt: new Date(now), lte: new Date(now + REMINDER_LEAD_MS) } },
    },
    select: { id: true, customerId: true, trip: { select: { origin: true, destination: true, departureAt: true } } },
    take: 200,
  });
  let sent = 0;
  for (const b of bookings) {
    const first = await getRedis().set(redisKey(`reminder:departure:${b.id}`), '1', 'EX', 2 * 24 * 3600, 'NX');
    if (first !== 'OK' || !b.customerId) continue;
    await notificationsService.notify([{ type: PrincipalType.CUSTOMER, id: b.customerId }], {
      type: 'DEPARTURE_REMINDER',
      title: 'رحلتك قريبًا',
      body: `رحلتك ${b.trip.origin} ← ${b.trip.destination} تنطلق قريبًا. جهّز تذكرتك.`,
      data: { bookingId: b.id, departureAt: b.trip.departureAt.toISOString() },
    });
    sent += 1;
  }
  return sent;
}
