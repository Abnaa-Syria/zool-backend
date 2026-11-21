# ZoolGo Backend API

Express + TypeScript modular monolith for ZoolGo (Sudan intercity bus booking): admin OTP auth + dynamic RBAC, broker offices with prepaid wallets, carriers, trips/seats/holds, bookings and tickets, commissions and settlements, audit log.

- Stack: Node 22, TypeScript 5.8, Express 4, Prisma 6.19 (MySQL 8.4, multi-file schema), Redis (ioredis), Zod, Vitest.
- Architecture and invariants (4 layers, money in minor units, RBAC): see `../CLAUDE.md` and `../AGENTS.md`.
- Project plan: `../docs/MASTER_PLAN.md`.

## Local setup

You need MySQL 8.4 and Redis. Pick one:

**A. Laragon (Windows, no Docker)** — MySQL on `3306` (root, no password), start Redis from the Laragon menu (`6379`). Full guide: `../docs/handover/12_LOCAL_SETUP_AND_RUNBOOK.md` §1.1.

**B. Docker** — `docker compose up -d mysql mysql-test redis` (MySQL dev `3308`, test `3307`, Redis `6380`).

```bash
cp .env.example .env              # set DATABASE_URL / REDIS_URL for your setup
cp .env.test.example .env.test    # test DB name MUST contain "test"
npm ci
npx prisma generate
npx prisma migrate deploy         # apply migrations to the dev DB
npm run db:seed                   # permissions, Super Admin, demo broker office + trips
npm run dev                       # http://localhost:4000/api/v1
```

- Swagger UI: `http://localhost:4000/docs` (from `docs/openapi.yaml`)
- Health: `GET /api/v1/health`, readiness: `GET /api/v1/ready`

### Demo accounts (seed, dev only)

| Role | Phone |
|---|---|
| Super Admin | `+249900000001` |
| Broker office manager | `+249900000101` |
| Broker clerk | `+249900000102` |
| Driver (Sudan Express) | `+249900000201` |
| Customer | `+249900000301` |

With `OTP_DEV_EXPOSE=true` (never in production) the OTP request response contains `devOtp`.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Watch mode |
| `npm run build` / `npm start` | Compile / run `dist/` |
| `npm run lint` | ESLint (zero warnings allowed) |
| `npm test` | Full integration suite (needs `.env.test` + migrated test DB) |
| `npm run db:test:prepare` | Apply migrations to the test DB from `.env.test` |
| `npm run db:seed` | Seed dev data |
| `npx prisma migrate dev --name <change>` | Create a **new** migration after editing `prisma/schema/*.prisma` |

## Database rules

- Schema files: `prisma/schema/*.prisma`. Migrations: `prisma/schema/migrations/` (the only migrations folder). Config: `prisma.config.ts`.
- Migrations are additive; never edit a migration that has been pushed.
- CI (`../.github/workflows/backend-ci.yml`) deploys all migrations to a fresh DB, fails on schema drift, and runs every test.
