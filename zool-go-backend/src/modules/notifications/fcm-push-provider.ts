import { readFileSync } from 'node:fs';
import { cert, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging, type Message, type Messaging } from 'firebase-admin/messaging';
import { logger } from '../../infrastructure/observability/logger';
import type { PushMessage, PushProvider, PushResult } from './push-provider';

/** FCM answers for tokens that will never work again (app removed, token rotated, wrong project). */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
  'messaging/mismatched-credential',
]);

/** Android channel shared by the three apps (created on first use, named in Arabic by the app). */
export const ANDROID_CHANNEL_ID = 'zoolgo_default';

/** Firebase Cloud Messaging (HTTP v1) through firebase-admin. */
export class FcmPushProvider implements PushProvider {
  readonly name = 'fcm';
  private readonly messaging: Messaging;

  constructor(serviceAccountFile: string) {
    const account = JSON.parse(readFileSync(serviceAccountFile, 'utf8')) as { project_id: string; client_email: string; private_key: string };
    const app: App = initializeApp(
      { credential: cert({ projectId: account.project_id, clientEmail: account.client_email, privateKey: account.private_key }) },
      'zoolgo-push',
    );
    this.messaging = getMessaging(app);
    logger.info({ projectId: account.project_id }, 'FCM push provider ready');
  }

  async send(messages: PushMessage[]): Promise<PushResult> {
    const invalidTokens: string[] = [];
    // sendEach takes at most 500 messages per call.
    for (let i = 0; i < messages.length; i += 500) {
      const chunk = messages.slice(i, i + 500);
      const res = await this.messaging.sendEach(chunk.map(toFcm));
      res.responses.forEach((r, j) => {
        if (r.success) return;
        const code = r.error?.code ?? '';
        if (DEAD_TOKEN_CODES.has(code)) invalidTokens.push(chunk[j]!.token);
        else logger.warn({ code, message: r.error?.message }, 'FCM send failed');
      });
    }
    return { invalidTokens };
  }
}

function toFcm(m: PushMessage): Message {
  return {
    token: m.token,
    notification: { title: m.title, body: m.body },
    data: m.data ?? {},
    android: {
      priority: 'high',
      notification: { channelId: ANDROID_CHANNEL_ID, icon: 'ic_stat_zoolgo', color: '#03442C', sound: 'default' },
    },
    apns: { payload: { aps: { sound: 'default' } } },
  };
}
