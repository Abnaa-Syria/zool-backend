# ZoolGo Backend (Stage 1)

Modular Express + TypeScript API foundation for the Sudan intercity transport platform: OTP auth, JWT access tokens, rotating refresh cookies, dynamic RBAC, audit logging.

## Prerequisites

- Node.js 20+
- Docker Desktop (MySQL 8.4 + Redis 7)

## Quick start

```bash
cd d:\zool-go\zool-go-backend
copy .env.example .env
docker compose up -d
npm install --ignore-scripts
npx prisma generate
npx prisma migrate dev --name stage1_auth_rbac
npm run db:seed
npm run dev
```

Docker Compose publishes MySQL on **3308** (dev), **3307** (test), and Redis on **6380** to avoid local port conflicts.

- API: `http://localhost:4000/api/v1`
- Swagger UI: `http://localhost:4000/docs`
- Health: `GET /api/v1/health`
- Ready: `GET /api/v1/ready`

### Development OTP login

Bootstrap Super Admin phone (seed): `+249900000001`

```bash
curl -s -X POST http://localhost:4000/api/v1/auth/otp/request ^
  -H "Content-Type: application/json" ^
  -d "{\"phone\":\"+249900000001\"}"
```

When `NODE_ENV!=production` and `OTP_DEV_EXPOSE=true`, the response includes `devOtp`. Verify:

```bash
curl -s -c cookies.txt -X POST http://localhost:4000/api/v1/auth/otp/verify ^
  -H "Content-Type: application/json" ^
  -d "{\"phone\":\"+249900000001\",\"code\":\"<devOtp>\"}"
```

Use the returned `accessToken` as `Authorization: Bearer ...`. Refresh cookie is HTTP-only on `/api/v1/auth`.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Watch mode |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled server |
| `npm run lint` | ESLint |
| `npm test` | Vitest integration tests |
| `npm run prisma:generate` | Generate Prisma Client |
| `npm run prisma:migrate` | Dev migration |
| `npm run db:seed` | Permission catalog + Super Admin |

## Architecture

See `STAGE1_PLAN.md` and `docs/AUTHZ_INVALIDATION.md`.

```
Route → authenticate / requirePermission / validate
     → Controller → Service → Repository → Prisma / Redis
```

## Explicit non-goals (Stage 1)

Bookings, wallets, payments, commissions, GPS, Bankak, WhatsApp/SMS production providers, frontend changes.

## Stage 2 recommendation

Broker offices + prepaid wallet top-up confirmation path (resolve D-TOP-01), then booking/seat concurrency.
