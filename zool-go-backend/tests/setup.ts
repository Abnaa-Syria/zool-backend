import { config as loadDotenv } from 'dotenv';
import path from 'path';

// Prefer .env.test when present; tests also set DATABASE_URL explicitly in helpers.
loadDotenv({ path: path.join(process.cwd(), '.env.test') });
loadDotenv({ path: path.join(process.cwd(), '.env') });

process.env.NODE_ENV = 'test';
process.env.OTP_DEV_EXPOSE = 'true';
process.env.LOG_LEVEL = 'silent';

// Safety guard: the integration suite truncates tables and deletes Redis keys.
// Never let it run against a non-test database or the dev/prod Redis prefix.
const dbName = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? '').pathname.replace(/^\//, '');
  } catch {
    return '';
  }
})();
if (!/test/i.test(dbName)) {
  throw new Error(
    `Refusing to run tests: DATABASE_URL database "${dbName || '(unset)'}" is not a test database. ` +
      'Copy .env.test.example to .env.test (MySQL 3307 / zoolgo_test).',
  );
}
if (!(process.env.REDIS_KEY_PREFIX ?? '').includes('test')) {
  process.env.REDIS_KEY_PREFIX = 'zoolgo_test:';
}
