// Prisma CLI configuration (replaces the deprecated package.json#prisma block).
// With a config file Prisma no longer auto-loads .env, so load it here.
// Existing environment variables (e.g. DATABASE_URL set by CI or db:test:prepare) win.
import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: path.join('prisma', 'schema'),
  migrations: {
    path: path.join('prisma', 'schema', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
});
