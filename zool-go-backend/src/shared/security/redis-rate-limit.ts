import { getRedis, redisKey } from '../../infrastructure/redis/redis';
import { AppError } from '../errors/app-error';

/** Fixed-window counter in Redis. Throws RATE_LIMITED when exceeded. */
export async function enforceRedisRateLimit(
  key: string,
  max: number,
  windowSeconds: number,
): Promise<void> {
  const redis = getRedis();
  const namespaced = redisKey(key);
  const count = await redis.incr(namespaced);
  if (count === 1) {
    await redis.expire(namespaced, windowSeconds);
  }
  if (count > max) {
    throw AppError.rateLimited('Rate limit exceeded', { retryAfterSeconds: windowSeconds });
  }
}
