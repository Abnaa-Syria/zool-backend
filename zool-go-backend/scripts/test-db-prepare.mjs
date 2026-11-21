// Applies all migrations to the TEST database defined in .env.test.
// Usage: npm run db:test:prepare
import { config } from 'dotenv';
import { spawnSync } from 'node:child_process';

const parsed = config({ path: '.env.test', override: false }).parsed ?? {};
const url = parsed.DATABASE_URL ?? process.env.DATABASE_URL ?? '';
const dbName = (() => {
  try {
    return new URL(url).pathname.replace(/^\//, '');
  } catch {
    return '';
  }
})();

if (!/test/i.test(dbName)) {
  console.error(`Refusing: .env.test DATABASE_URL database "${dbName || '(unset)'}" is not a test database.`);
  process.exit(1);
}

const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, DATABASE_URL: url },
});
process.exit(result.status ?? 1);
