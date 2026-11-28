import { AsyncLocalStorage } from 'node:async_hooks';
import { logger } from '../../infrastructure/observability/logger';

export interface PushMessage {
  token: string;
  platform: 'IOS' | 'ANDROID' | 'WEB';
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface PushResult {
  /** Tokens the provider reported as no longer valid (removed from DeviceToken) */
  invalidTokens: string[];
}

/** Port for push delivery: `LogPushProvider` in dev/tests, `FcmPushProvider` when PUSH_PROVIDER=fcm. */
export interface PushProvider {
  readonly name: string;
  send(messages: PushMessage[]): Promise<PushResult>;
}

export class LogPushProvider implements PushProvider {
  readonly name = 'log';
  readonly sent: PushMessage[] = [];

  async send(messages: PushMessage[]): Promise<PushResult> {
    this.sent.push(...messages);
    if (this.sent.length > 500) this.sent.splice(0, this.sent.length - 500);
    logger.debug({ count: messages.length }, 'push (log provider)');
    return { invalidTokens: [] };
  }
}

let provider: PushProvider = new LogPushProvider();

export function getPushProvider(): PushProvider {
  return provider;
}

export function setPushProvider(next: PushProvider): void {
  provider = next;
}

const muted = new AsyncLocalStorage<true>();

/** Runs `fn` with push delivery off for everything it notifies (feed rows are still written). */
export function withoutPush<T>(fn: () => Promise<T>): Promise<T> {
  return muted.run(true, fn);
}

export function isPushMuted(): boolean {
  return muted.getStore() === true;
}
