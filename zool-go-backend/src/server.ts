import { loadEnv, env } from './config/env';
import { createApp } from './app';
import { connectPrisma, disconnectPrisma } from './infrastructure/database/prisma';
import { connectRedis, disconnectRedis } from './infrastructure/redis/redis';
import { logger } from './infrastructure/observability/logger';
import { catalogService } from './modules/catalog/catalog.service';
import { customerCheckoutService, sendDepartureReminders } from './modules/customer-app';

async function main() {
  loadEnv();
  const config = env();

  await connectPrisma();
  await connectRedis();

  const app = createApp();
  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, `${config.APP_NAME} listening`);
  });

  // Housekeeping: free expired seat holds, expire unpaid online checkouts (both also lazily on
  // reads) and send departure reminders.
  let sweeping = false;
  const sweeper = setInterval(() => {
    if (sweeping) return;
    sweeping = true;
    Promise.all([catalogService.releaseExpiredHolds(), customerCheckoutService.expireOverdue(), sendDepartureReminders()])
      .catch((err: unknown) => logger.warn({ err }, 'Housekeeping sweep failed'))
      .finally(() => {
        sweeping = false;
      });
  }, 30_000);
  sweeper.unref();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    clearInterval(sweeper);
    server.close(async () => {
      try {
        await disconnectPrisma();
        await disconnectRedis();
        process.exit(0);
      } catch (error) {
        logger.error({ err: error }, 'Error during shutdown');
        process.exit(1);
      }
    });
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
