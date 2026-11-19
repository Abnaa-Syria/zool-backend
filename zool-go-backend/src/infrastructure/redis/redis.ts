import Redis from 'ioredis';
import { env } from '../../config/env';
import { logger } from '../observability/logger';

let redisClient: Redis | null = null;

/**
 * Build a namespaced Redis key using REDIS_KEY_PREFIX.
 * Logical keys (e.g. `authz:version:{id}`) stay prefix-free in call sites.
 */
export function redisKey(...parts: string[]): string {
  const prefix = env().REDIS_KEY_PREFIX;
  const joined = parts.join(':').replace(/^:+/, '');
  return `${prefix}${joined}`;
}

export function getRedis(): Redis {
  if (!redisClient) {
    redisClient = new Redis(env().REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
    });

    redisClient.on('error', (err) => {
      logger.error({ err }, 'Redis client error');
    });

    redisClient.on('connect', () => {
      logger.info('Redis connecting');
    });

    redisClient.on('ready', () => {
      logger.info('Redis ready');
    });
  }
  return redisClient;
}

export async function connectRedis(): Promise<Redis> {
  const client = getRedis();
  if (client.status === 'wait' || client.status === 'end') {
    await client.connect();
  } else if (client.status === 'connecting') {
    await new Promise<void>((resolve, reject) => {
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        client.off('ready', onReady);
        client.off('error', onError);
      };
      client.once('ready', onReady);
      client.once('error', onError);
    });
  }
  return client;
}

export async function disconnectRedis(): Promise<void> {
  if (!redisClient) {
    return;
  }
  const client = redisClient;
  redisClient = null;
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
  logger.info('Redis disconnected');
}

export async function redisHealthCheck(): Promise<boolean> {
  try {
    const pong = await getRedis().ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}
