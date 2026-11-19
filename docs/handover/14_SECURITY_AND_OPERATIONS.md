# ZoolGo — Security Architecture and Operational Risk Register

This document details the security controls implemented across the ZoolGo platform, inspects potential attack surfaces, and provides an operational risk register for production deployment.

---

## 1. Implemented Security Controls

### 1.1. Authentication and Token Hardening
- **HMAC OTP Storage:** One-Time Passwords are never stored in plaintext in the database. `OtpChallenge.codeHash` stores an HMAC-SHA256 hash generated via `OTP_HMAC_SECRET`. Verification utilizes `crypto.timingSafeEqual` (`src/shared/security/crypto.ts` L22–27) to prevent timing side-channel attacks.
- **Brute-Force & Flood Protections:**
  - Failed attempt counters lock challenges permanently after 5 failed tries (`maxAttempts = 5`).
  - A 60-second Redis cooldown prevents rapid OTP resend attacks on the same phone.
  - Redis sliding-window rate limiters cap request and verification endpoints per IP and identity (`src/shared/security/redis-rate-limit.ts`).
- **Production Safety Switch:** Zod environment validation (`src/config/env.ts` L66–72) halts startup if `NODE_ENV = production` while `OTP_DEV_EXPOSE = true`.
- **Hashed Refresh Tokens:** Refresh tokens are 256-bit cryptographically random strings. Only their SHA-256 hash is persisted in `RefreshSession`.
- **Cookie Security:** Refresh tokens are transmitted strictly via `HttpOnly`, `SameSite=Lax`, path-scoped cookies (`/api/v1/auth` for admins; `/api/v1/broker/auth` for brokers). In production, `REFRESH_COOKIE_SECURE=true` enforces HTTPS-only transmission.
- **Reuse Detection:** Replaying a previously rotated refresh token causes the server to invalidate **all** active sessions for that user and bump the authorization version.
- **Fast Revocation via Redis (`authzVersion`):** Access tokens contain an authorization version (`av`). The `authenticate` middleware checks Redis on every request; suspending an admin or altering roles increments the version, immediately invalidating active access tokens without waiting for the 15-minute JWT expiration.

### 1.2. Network, HTTP, and Transport Security
- **Helmet Middleware:** Enforces strict HTTP security headers including `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security`, and DNS prefetch controls (`src/app.ts` L40).
- **CORS Allowlist:** Origin reflection is disabled. Origins are strictly checked against `CORS_ORIGINS`. Pre-flight `credentials: true` requests are permitted only for approved frontend origins (`src/app.ts` L41–46).
- **Payload Size Limits:** `express.json({ limit: '100kb' })` and `express.raw({ limit: '100kb' })` prevent denial-of-service attacks via oversized JSON or webhook bodies.
- **Raw-Body Signature Capture:** The payment webhook endpoint (`/api/v1/payments/webhooks/:provider`) captures raw bytes before body parsing to guarantee bit-for-bit cryptographic signature verification (`src/app.ts` L53–72).

### 1.3. Data Protection and Logging Sanitization
- **SQL Injection Prevention:** 100% of database interactions utilize Prisma ORM parameterized queries. Raw SQL queries (`$queryRawUnsafe`) are prohibited.
- **Sensitive Log Redaction:** Pino structured logger automatically redacts authorization headers, cookies, passwords, refresh tokens, access tokens, and OTP codes as `"[REDACTED]"` (`src/infrastructure/observability/logger.ts` L10–25).
- **Production Error Sanitization:** The global error handler (`src/shared/middleware/error-handler.ts` L35–55) suppresses internal database error details and stack traces when `NODE_ENV = production`, returning a generic `INTERNAL_ERROR` envelope with `requestId`.
- **Private Receipt Storage:** Bank deposit evidence files are stored in a private local directory (`./uploads/receipts/`) with randomized UUID filenames. They are **never served statically by Express**; downloads require authentication and `wallets.topups.evidence.view` permission.

---

## 2. Comprehensive Security and Operational Risk Register

| Risk | Verified Evidence | Business / Operational Impact | Current Mitigation | Recommended Next Action | Priority |
|---|---|---|---|---|---|
| **Admin Phone Change Session Leak** | `src/modules/auth/auth.service.ts` L640–674 updates phone without calling `updateAuthzVersion` or revoking `RefreshSession`. | If an admin's account is hijacked or recovered, the prior attacker's active JWT and refresh cookie remain valid for up to 7 days. | Phone change requires valid session; audit log is written. | Update `verifyPhoneChangeOtp` to revoke all active sessions and bump `authzVersion` in Redis/DB. | **P0 (Critical)** |
| **No Git Version Control** | `Test-Path "d:\zool-go\.git"` returned `False`. Workspace is not under source control. | Accidental file deletion, unauthorized code alterations, or hardware failure could cause irreversible project loss. | Local file system snapshots. | Initialize Git, create `.gitignore`, push to private GitHub/GitLab remote with protected `main` branch. | **P0 (Critical)** |
| **Local Disk Storage for Receipts** | `src/infrastructure/storage/local-disk-storage.ts` writes directly to `./uploads/receipts/`. | In containerized (Docker/Kubernetes) or multi-instance deployments, receipt images will be lost on container restart or unavailable to sibling nodes. | Directory mounted on local Windows disk. | Implement `S3StorageProvider` for Cloudflare R2, AWS S3, or MinIO. | **P1 (High)** |
| **Lack of Production Payment Provider** | `src/modules/payments/payment-provider.ts` defaults to `MockPaymentProvider`. | Real broker top-ups cannot be verified automatically via Sudanese banking networks (e.g., Bankak). | Manual receipt review queue (`MANUAL_FALLBACK`) is fully functional. | Partner with a licensed Sudanese payment aggregator; write a real `PaymentProvider` adapter. | **P1 (High)** |
| **Lack of Production SMS Gateway** | `src/modules/auth/otp-delivery.ts` logs OTPs to logger only. | Real central admins and broker clerks cannot receive login codes on physical mobile phones in Sudan. | `devOtp` is exposed in non-prod mode. | Integrate an SMS provider supporting Sudanese telecom operators (Zain, MTN, Sudani). | **P1 (High)** |
| **GPS Tracking Provider Unspecified** | `docs/BACKEND_DECISION_REGISTER.md` marks `D-GPS-01` as OPEN. | Live fleet tracking on frontend is purely simulated; no real telematics data ingestion exists. | Telemetry simulator allows UI testing. | Product Owner must resolve `D-GPS-01` architecture before backend telematics work starts. | **P2 (Medium)** |
| **Lack of APM & Metrics Infrastructure** | Backend has Pino structured logging, but no Prometheus metrics, Grafana dashboards, or OpenTelemetry tracing. | Production operators have no visibility into HTTP request latencies, memory leaks, or Redis connection saturation. | Basic `/health` and `/ready` endpoints exist. | Deploy Prometheus client (`prom-client`) and OpenTelemetry SDK for distributed tracing. | **P2 (Medium)** |
| **No Automated CI/CD Pipelines** | Workspace contains no `.github/workflows/` or `.gitlab-ci.yml`. | Code quality checks, TypeScript builds, and tests are not enforced automatically on pull requests. | Local npm scripts (`npm test`, `npm run lint`). | Establish CI pipeline running lint, build, prisma validate, and Vitest test suites. | **P2 (Medium)** |
| **Database Backup & Disaster Recovery** | No automated MySQL snapshot or WAL archiving script exists in `scripts/`. | Database corruption or disk loss would destroy ticket sales and immutable financial ledger records. | MySQL data persisted in Docker volume `zoolgo_mysql_data`. | Set up scheduled daily automated mysqldump backups with offsite S3 replication. | **P2 (Medium)** |
| **Frontend Monolithic Bundle Size** | Vite build outputs `dist/assets/index-*.js` of `2,426.09 kB` (> 500 kB chunk warning). | Slow initial dashboard page load for operators on low-bandwidth Sudanese cellular networks. | Gzip compression reduces wire size to ~583 kB. | Implement `React.lazy()` dynamic route splitting in `router/index.tsx`. | **P3 (Low)** |

---

## 3. Operational Health and Graceful Shutdown

### 3.1. Health and Readiness Endpoints
- **Liveness (`GET /api/v1/health`):** Returns HTTP 200 `{ status: "ok" }`. Proves the Express event loop is responsive.
- **Readiness (`GET /api/v1/ready`):** Executes live queries against dependencies:
  - Database: `prisma.$queryRaw\`SELECT 1\``
  - Cache: `redis.ping()`
  - If any dependency fails, returns HTTP 503 Service Unavailable with component-level diagnostic details (`src/modules/health/health.routes.ts` L20–44).

### 3.2. Graceful Shutdown Protocol
`src/server.ts` registers OS termination handlers (`SIGINT`, `SIGTERM`):
1. Stops accepting new HTTP connections.
2. Waits for in-flight requests to complete (with timeout).
3. Calls `disconnectRedis()` to flush connections cleanly.
4. Calls `disconnectPrisma()` to close MySQL database connection pool.
5. Exits process with code 0.

---

*Evidence citations:*
- Pino redaction: `d:\zool-go\zool-go-backend\src\infrastructure\observability\logger.ts` L10–25
- Helmet & limits: `d:\zool-go\zool-go-backend\src\app.ts` L40–74
- Server shutdown: `d:\zool-go\zool-go-backend\src\server.ts` L25–45
- Phone change implementation: `d:\zool-go\zool-go-backend\src\modules\auth\auth.service.ts` L640–674
