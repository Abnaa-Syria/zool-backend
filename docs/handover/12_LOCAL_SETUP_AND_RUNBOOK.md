# ZoolGo — Local Setup and Engineering Runbook

This runbook provides complete instructions for configuring, running, testing, and debugging the ZoolGo platform on a Windows development machine.

---

## 1. Prerequisites and System Requirements

- **Operating System:** Windows 10/11 (PowerShell or Bash via WSL2)
- **Node.js:** `>= 20.10.0` (Verified on Node `22.x` / `20.x`)
- **Package Manager:** `npm` `>= 10.x`
- **Docker:** Docker Desktop for Windows with WSL2 backend (required for MySQL 8.4 and Redis 7.4 containers)
- **Memory & Ports:** At least 8 GB RAM available; free TCP ports `4000` (Backend API), `5173` (Frontend Dashboard), `3308` (MySQL Dev), `3307` (MySQL Test), and `6380` (Redis).

### 1.1. Option B — Laragon (no Docker) — verified 2026-11-21

Laragon ships MySQL 8.4 and Redis 5 (`C:\laragon\bin\redis`), which is enough for local dev and the full test suite (72/72 passing).

1. Start MySQL from Laragon (default `127.0.0.1:3306`, user `root`, empty password). Start Redis from Laragon's menu (default port `6379`).
2. Create the databases (HeidiSQL or CLI):
   ```sql
   CREATE DATABASE zoolgo      CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE DATABASE zoolgo_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```
3. In `zool-go-backend/`: `cp .env.example .env` and `cp .env.test.example .env.test`, then set in **both**:
   - `.env`: `DATABASE_URL=mysql://root@127.0.0.1:3306/zoolgo`
   - `.env.test`: `DATABASE_URL=mysql://root@127.0.0.1:3306/zoolgo_test`
   - both: `REDIS_URL=redis://127.0.0.1:6379` (dev/test stay isolated by `REDIS_KEY_PREFIX`).
4. Bootstrap:
   ```bash
   npm ci
   npx prisma generate
   npx prisma migrate deploy   # dev DB
   npm run db:seed             # super admin +249900000001, broker manager +249900000101
   npm run db:test:prepare     # test DB (refuses if DB name lacks "test")
   npm test                    # 72 tests
   npm run dev                 # API on :4000
   ```

> `.env.test` must keep the test-only OTP values from `.env.test.example` (`OTP_RESEND_COOLDOWN_SECONDS=1`, high OTP rate limits); with production-like values most suites fail with `429`.

---

## 2. Environment Variables Configuration

Both applications rely on environment files. Never commit live production secrets to configuration templates.

### 2.1. Backend Environment Matrix (`zool-go-backend/.env`)

| Variable | Required | Secret | Example / Dev Value | Purpose | Valid In |
|---|---|---|---|---|---|
| `NODE_ENV` | Yes | No | `development` | Runtime environment (`development`, `test`, `production`) | All |
| `PORT` | Yes | No | `4000` | HTTP listening port for Express server | All |
| `APP_NAME` | No | No | `zool-go-backend` | Application identifier for logging | All |
| `API_PREFIX` | Yes | No | `/api/v1` | URL prefix for all REST routes | All |
| `DATABASE_URL` | Yes | Yes | `mysql://zoolgo:zoolgo@127.0.0.1:3308/zoolgo` | Primary MySQL connection string | All |
| `REDIS_URL` | Yes | Yes | `redis://127.0.0.1:6380` | Redis connection URL | All |
| `REDIS_KEY_PREFIX`| No | No | `zoolgo:` | Namespace prefix for all Redis keys | All |
| `JWT_ACCESS_SECRET`| Yes | Yes | `dev-jwt-access-secret-minimum-32-chars!` | HMAC secret for signing 15-min access tokens | All |
| `JWT_ACCESS_TTL_SECONDS` | No | No | `900` | Access token lifespan in seconds (15 min) | All |
| `REFRESH_TOKEN_TTL_SECONDS` | No | No | `604800` | Refresh token lifespan in seconds (7 days) | All |
| `REFRESH_COOKIE_NAME` | No | No | `zoolgo_refresh` | Cookie name for central admin refresh token | All |
| `REFRESH_COOKIE_SECURE` | No | No | `false` | Sets `Secure` flag on refresh cookie (false in dev) | All |
| `REFRESH_COOKIE_SAMESITE`| No | No | `lax` | SameSite attribute (`lax`, `strict`, `none`) | All |
| `REFRESH_COOKIE_PATH` | No | No | `/api/v1/auth` | Path scope restriction for refresh cookie | All |
| `CORS_ORIGINS` | Yes | No | `http://localhost:5173` | Comma-separated list of allowed CORS origins | All |
| `TRUST_PROXY` | No | No | `false` | Enables reverse-proxy IP headers (set true behind Nginx) | All |
| `OTP_LENGTH` | No | No | `6` | Length of numeric one-time password | All |
| `OTP_TTL_SECONDS` | No | No | `300` | Challenge expiration window (5 minutes) | All |
| `OTP_MAX_ATTEMPTS` | No | No | `5` | Maximum failed verification attempts before lock | All |
| `OTP_RESEND_COOLDOWN_SECONDS` | No | No | `60` | Cooldown period before new OTP can be requested | All |
| `OTP_HMAC_SECRET` | Yes | Yes | `dev-otp-hmac-secret-minimum-32-chars!` | HMAC secret for hashing OTP codes | All |
| `OTP_DEV_EXPOSE` | No | No | `true` | Exposes plaintext OTP in API response (**DEV/TEST ONLY**) | Dev / Test |
| `BOOTSTRAP_SUPER_ADMIN_PHONE` | No | No | `+249900000001` | Phone identity for initial seeded Super Admin | All |
| `PAYMENT_PROVIDER`| No | No | `mock` | Selected PSP adapter (`mock` in non-prod) | All |
| `PAYMENT_WEBHOOK_SECRET` | Yes | Yes | `dev-webhook-secret-min-16-chars` | Raw-body HMAC verification key for webhooks | All |
| `PLATFORM_TIMEZONE`| No | No | `Africa/Khartoum` | Fallback platform IANA timezone | All |
| `UPLOAD_DIR` | No | No | `./uploads` | Local filesystem path for private receipt storage | All |
| `BROKER_REFRESH_COOKIE_NAME` | No | No | `zoolgo_broker_refresh` | Isolated cookie name for broker staff sessions | All |
| `BROKER_REFRESH_COOKIE_PATH` | No | No | `/api/v1/broker/auth` | Path scope for broker refresh cookie | All |
| `LOW_BALANCE_WARNING_THRESHOLD` | No | No | `20000` | Global default low balance threshold in minor units | All |

---

## 3. Step-by-Step Initial Setup Guide

### Step 1: Start Supporting Infrastructure via Docker
Open PowerShell in `d:\zool-go\zool-go-backend`:

> [!CAUTION]
> **Check for Port 6380 Conflicts First:**  
> Before running docker compose, check if port `6380` is in use by another local container (e.g. `lomi-redis`):
> ```powershell
> docker ps | Select-String "6380"
> ```
> If another container is already using `6380`, either stop that container or modify `REDIS_URL` in `.env`.

Start the development database, test database, and Redis container:
```powershell
cd d:\zool-go\zool-go-backend
docker compose up -d
```
Verify containers are healthy:
```powershell
docker ps --filter "name=zoolgo"
```

### Step 2: Install Backend Dependencies and Prepare Database
```powershell
cd d:\zool-go\zool-go-backend

# 1. Install dependencies
npm install

# 2. Validate Prisma schemas (multi-file schema)
npx prisma validate

# 3. Generate Prisma client
npm run prisma:generate

# 4. Apply migrations to local development database
npm run prisma:migrate

# 5. Seed initial data (Super Admin + Demo Carriers + Broker Office)
npm run db:seed
```

### Step 3: Install Frontend Dependencies
```powershell
cd d:\zool-go\zool-go-dashpoard
npm install
```

---

## 4. Common Execution Command Sequences

### Sequence A: Running the Platform in Development Mode

**Terminal 1 — Backend API:**
```powershell
cd d:\zool-go\zool-go-backend
npm run dev
# Server boots at http://127.0.0.1:4000
# OpenAPI Docs available at http://127.0.0.1:4000/docs
```

**Terminal 2 — Frontend Admin Dashboard:**
```powershell
cd d:\zool-go\zool-go-dashpoard
npm run dev
# Vite server boots at http://localhost:5173
```

### Sequence B: Running Automated Tests

**Backend Test Execution:**
```powershell
cd d:\zool-go\zool-go-backend

# Ensure test database (port 3307) and Redis (port 6380) are running:
docker compose up -d mysql-test redis

# Run Vitest test suites:
npm test
```

**Frontend Test Execution:**
```powershell
cd d:\zool-go\zool-go-dashpoard
npm test
```

### Sequence C: Applying Database Migrations

When modifying or adding `.prisma` files in `prisma/schema/`:
```powershell
cd d:\zool-go\zool-go-backend

# Validate multi-file schema syntax:
npm run prisma:validate

# Create and apply new migration:
npm run prisma:migrate

# Regenerate TypeScript client:
npm run prisma:generate
```

> [!WARNING]
> **Never Run `db:reset` on Shared Environments:**  
> `npm run db:reset` (`prisma migrate reset --force`) drops the entire database schema and deletes all data. Only use on local disposable databases.

### Sequence D: Running End-to-End Smoke Tests

With the backend running on `http://127.0.0.1:4000`:
```powershell
cd d:\zool-go\zool-go-backend

# Run Stage 1 smoke test (Health, Super Admin OTP login, /auth/me, RBAC checks):
node scripts/smoke.mjs

# Run Stage 2 smoke test (Broker office login, seat hold, booking, wallet debit):
node scripts/smoke-stage2.mjs
```

### Sequence E: Production-Grade Production Build

```powershell
# Build backend:
cd d:\zool-go\zool-go-backend
npm run build
# Compiled JavaScript outputs to dist/server.js

# Build frontend:
cd d:\zool-go\zool-go-dashpoard
npm run build
# Production assets compile to dist/
```

---

## 5. Development Bootstrap Credentials and OTP Workflow

When logging into the local backend during development:
- **Super Admin Phone:** `+249900000001`
- **Broker Manager Phone:** `+249900000101`
- **Broker Clerk Phone:** `+249900000102`

Because `OTP_DEV_EXPOSE = true` in `.env`:
1. Request OTP via `POST /api/v1/auth/otp/request` with body `{ phone: "+249900000001" }`.
2. Inspect the HTTP response body:
   ```json
   {
     "success": true,
     "data": {
       "challengeId": "ch_01HP8XYZ...",
       "devOtp": "748291"
     }
   }
   ```
3. Use the value of `devOtp` directly in `POST /api/v1/auth/otp/verify` to receive your JWT access token.

---

*Evidence citations:*
- Docker configuration: `d:\zool-go\zool-go-backend\docker-compose.yml` L1–58
- Backend scripts: `d:\zool-go\zool-go-backend\package.json` L11–25
- Frontend scripts: `d:\zool-go\zool-go-dashpoard\package.json` L6–12
- Environment schema: `d:\zool-go\zool-go-backend\src\config\env.ts` L10–82
