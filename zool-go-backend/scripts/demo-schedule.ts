/** `npm run db:demo [days]` — build/refresh the demo world (carriers, buses, drivers, rolling trips, demo passengers; up to 7 days). Run `npm run db:seed` first. */
import 'dotenv/config';
import { loadEnv } from '../src/config/env';
import { connectPrisma, disconnectPrisma } from '../src/infrastructure/database/prisma';
import { connectRedis, disconnectRedis } from '../src/infrastructure/redis/redis';
import { ensureDemoSchedule } from '../src/dev/demo-schedule';

async function main() {
  loadEnv();
  await connectPrisma();
  await connectRedis();
  const days = Number(process.argv[2] ?? 7);
  const created = await ensureDemoSchedule(days);
  console.log(`Demo schedule: ${created} trips created for the next ${days} days`);
  await disconnectPrisma();
  await disconnectRedis();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
