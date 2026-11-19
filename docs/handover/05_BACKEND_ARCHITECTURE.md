# ZoolGo — Backend Architecture

This document details the architectural structure, design patterns, module inventory, and cross-cutting infrastructure of `zool-go-backend`.

---

## 1. Architectural Style and Layering

`zool-go-backend` is designed as a **Modular Monolith** organized into distinct, decoupled domain modules under `src/modules/`. Within each module, dependencies flow in a strict, unidirectional layered pipeline:

```text
HTTP Request
  ↓
Express Route Definition (src/modules/<domain>/<domain>.routes.ts)
  ↓
Authentication & Authorization Middleware (authenticate, requirePermission)
  ↓
Input Validation Middleware (validate({ body, query, params }) using Zod)
  ↓
Controller (src/modules/<domain>/<domain>.controller.ts)
  ↓
Service Layer (src/modules/<domain>/<domain>.service.ts)
  ↓
Repository Layer (src/modules/<domain>/<domain>.repository.ts)
  ↓
Infrastructure Persistence (Prisma ORM / MySQL 8.4, ioredis / Redis 7.4, Local Storage)
```

### Layer Responsibilities and Strict Prohibitions

| Layer | Strict Responsibilities | Prohibited Actions |
|---|---|---|
| **Route** | Defines HTTP method and path; attaches authentication, authorization, and validation middleware. | Must **not** contain business logic, database queries, or direct response writing. |
| **Middleware** | Enforces cross-cutting concerns: JWT authentication, permission checks, Zod parsing, request IDs. | Must **not** bypass controllers or mutate business state directly. |
| **Controller** | Unpacks `req.body`, `req.params`, `req.query`; delegates to Service; formats HTTP status and standard envelope (`res.json(successResponse(...))`). | Must **not** call Prisma directly; must **not** contain financial or transactional logic. |
| **Service** | Implements core business logic, policies, atomic transactions (`$transaction`), audit recording, and domain event checks. | Must **not** access Express `req` or `res` objects; must **not** construct HTTP responses. |
| **Repository** | Encapsulates Prisma queries, database operations, locks (`SELECT FOR UPDATE`), and table mappings. | Must **not** contain business rules, validation logic, or throw HTTP errors directly. |
| **Infrastructure** | Provides low-level database connection pooling, Redis clients, file storage, and external provider adapters. | Must **not** import domain services. |

---

## 2. Module Inventory

The backend contains **17 distinct modules** mounted in `src/app.ts`:

| Module | Responsibility | Main Entities | Primary Routes | Required Permissions | Test File | Status |
|---|---|---|---|---|---|---|
| **`auth`** | Central admin OTP login, verification, token refresh, and phone change. | `AdminUser`, `AdminIdentity`, `OtpChallenge`, `RefreshSession` | `POST /auth/otp/request`<br>`POST /auth/otp/verify`<br>`POST /auth/refresh`<br>`POST /auth/logout`<br>`GET /auth/me`<br>`POST /auth/phone/otp/request`<br>`POST /auth/phone/otp/verify` | Authenticated (for me/phone) | `tests/auth-rbac.test.ts`<br>`tests/admin-phone-change.test.ts` | **IMPLEMENTED** |
| **`admins`** | Super admin management of platform administrators, status, profiles, and role assignments. | `AdminUser`, `UserRole` | `GET /admins`<br>`POST /admins`<br>`GET /admins/:id`<br>`PATCH /admins/:id/status`<br>`PATCH /admins/:id`<br>`PUT /admins/:id/roles`<br>`POST /admins/:id/sessions/revoke-all` | `admins.view`<br>`admins.create`<br>`admins.suspend`<br>`admins.update`<br>`roles.assign`<br>`sessions.revoke` | `tests/auth-rbac.test.ts`<br>`tests/milestone-b-admin.test.ts` | **IMPLEMENTED** |
| **`roles`** | Dynamic custom roles and permission assignment. | `Role`, `RolePermission` | `GET /roles`<br>`POST /roles`<br>`GET /roles/:id`<br>`PATCH /roles/:id`<br>`PUT /roles/:id/permissions`<br>`DELETE /roles/:id` | `roles.view`<br>`roles.create`<br>`roles.update`<br>`permissions.assign`<br>`roles.delete` | `tests/auth-rbac.test.ts` | **IMPLEMENTED** |
| **`permissions`**| Read-only access to the static permission catalog. | Static `PERMISSION_CATALOG` | `GET /permissions` | `permissions.view` | `tests/auth-rbac.test.ts` | **IMPLEMENTED** |
| **`sessions`** | Central admin inspection and revocation of active refresh sessions. | `RefreshSession` | `GET /sessions`<br>`DELETE /sessions/:id` | `sessions.view`<br>`sessions.revoke` | `tests/auth-rbac.test.ts`<br>`tests/milestone-b-admin.test.ts` | **IMPLEMENTED** |
| **`audit`** | Immutable system audit log inspection with multi-field database filtering. | `AuditLog` | `GET /audit-logs` | `audit.view` | `tests/milestone-b-admin.test.ts` | **IMPLEMENTED** |
| **`brokers`** | Central admin creation, policy configuration, carrier assignment, and staff management for broker offices. | `BrokerOffice`, `BrokerCarrierAssignment`, `BrokerEmployee` | `GET /brokers`<br>`POST /brokers`<br>`GET /brokers/:id`<br>`PUT /brokers/:id/carriers`<br>`PATCH /brokers/:id/status`<br>`PATCH /brokers/:id`<br>`POST /brokers/:id/staff`<br>`PATCH /brokers/:id/staff/:empId` | `brokers.view`<br>`brokers.manage` | `tests/stage2-broker.test.ts`<br>`tests/milestone-b-admin.test.ts` | **IMPLEMENTED** |
| **`broker-auth`**| Broker manager and clerk OTP login, refresh rotation, and profile. | `BrokerEmployee`, `BrokerIdentity`, `BrokerOtpChallenge`, `BrokerRefreshSession` | `POST /broker/auth/otp/request`<br>`POST /broker/auth/otp/verify`<br>`POST /broker/auth/refresh`<br>`POST /broker/auth/logout`<br>`GET /broker/auth/me` | Broker Authenticated | `tests/stage2-broker.test.ts` | **IMPLEMENTED** |
| **`broker-staff`**| Self-service employee creation and permission flag management by broker managers. | `BrokerEmployee`, `BrokerIdentity` | `GET /broker/staff`<br>`POST /broker/staff`<br>`PATCH /broker/staff/:id` | `broker.staff.manage` | `tests/stage2-broker.test.ts` | **IMPLEMENTED** |
| **`carriers`** | Transport company (bus operator) registry, status toggles, and assignment. | `TransportCompany` | `GET /carriers`<br>`POST /carriers`<br>`GET /carriers/:id`<br>`PATCH /carriers/:id`<br>`GET /broker/carriers` | `carriers.view`<br>`carriers.manage`<br>`broker.book` | `tests/milestone-a-admin.test.ts`<br>`tests/milestone-b-admin.test.ts` | **IMPLEMENTED** |
| **`catalog`** | Trip scheduling, seat inventory, manual/auto seat holds, and trip searches. | `Trip`, `TripSeat`, `SeatHold` | `POST /catalog/trips`<br>`GET /catalog/trips`<br>`GET /catalog/trips/:id`<br>`PATCH /catalog/trips/:id`<br>`POST /catalog/trips/:id/seats`<br>`GET /broker/trips`<br>`POST /broker/trips/:id/holds`<br>`DELETE /broker/holds/:token` | `catalog.manage`<br>`catalog.view`<br>`broker.book` | `tests/stage2-broker.test.ts`<br>`tests/stage2-policy.test.ts`<br>`tests/milestone-a-admin.test.ts` | **IMPLEMENTED** |
| **`bookings`** | Ticket quotes, atomic booking confirmations, PDF generation, cancellations, and admin searches. | `Booking`, `BookingPassenger`, `Ticket`, `TicketDispatchAttempt` | `POST /broker/bookings/quote`<br>`POST /broker/bookings/confirm`<br>`GET /broker/bookings`<br>`GET /broker/bookings/:id`<br>`POST /broker/bookings/:id/cancel`<br>`GET /broker/bookings/:id/tickets/:tId/pdf`<br>`GET /admin/bookings`<br>`GET /admin/bookings/:id`<br>`POST /admin/bookings/:id/cancel`<br>`GET /admin/bookings/:id/tickets/:tId/pdf` | `broker.book`<br>`bookings.view`<br>`bookings.cancel` | `tests/stage2-broker.test.ts`<br>`tests/stage2-policy.test.ts`<br>`tests/milestone-a-admin.test.ts`<br>`tests/milestone-b-admin.test.ts` | **IMPLEMENTED** |
| **`wallets`** | Prepaid agency wallet retrieval, cross-office wallet balances, and ledger entry history. | `Wallet`, `WalletLedgerEntry` | `GET /broker/wallet`<br>`GET /broker/wallet/ledger`<br>`GET /admin/wallets`<br>`GET /admin/wallets/:officeId` | `broker.book`<br>`wallets.view` | `tests/stage2-broker.test.ts`<br>`tests/milestone-a-admin.test.ts` | **IMPLEMENTED** |
| **`payments`** | Dual-path top-ups: automatic webhook ingestion, receipt evidence upload, queue review, and approval. | `TopUpIntent`, `TopUpEvidence` | `POST /broker/wallet/top-ups`<br>`POST /broker/wallet/top-ups/:id/evidence`<br>`POST /payments/webhooks/:provider`<br>`POST /payments/mock/confirm`<br>`GET /admin/wallets/top-ups`<br>`POST /admin/wallets/:id/top-ups`<br>`POST /admin/wallets/top-ups/:id/approve`<br>`POST /admin/wallets/top-ups/:id/reject`<br>`GET /admin/wallets/top-ups/:id/evidence` | `broker.wallet.topup`<br>`wallets.topups.view`<br>`wallets.topups.create_for_office`<br>`wallets.topups.approve`<br>`wallets.topups.reject`<br>`wallets.topups.evidence.view` | `tests/stage2-broker.test.ts`<br>`tests/stage2-policy.test.ts` | **IMPLEMENTED** |
| **`commissions`**| Broker commission tracking, settlement drafting, cancellation release, and manual finalization. | `CommissionAccrual`, `CommissionSettlement`, `CommissionPayout` | `GET /broker/commissions/accruals`<br>`GET /admin/commissions/accruals`<br>`POST /admin/commissions/settlements`<br>`GET /admin/commissions/settlements`<br>`GET /admin/commissions/settlements/:id`<br>`POST /admin/commissions/settlements/:id/finalize`<br>`POST /admin/commissions/settlements/:id/cancel` | `broker.reports.view`<br>`commissions.view`<br>`commissions.payout` | `tests/stage2-broker.test.ts`<br>`tests/stage2-policy.test.ts`<br>`tests/milestone-a-admin.test.ts` | **IMPLEMENTED** |
| **`reports`** | Broker agency performance and revenue summaries. | Dynamic Aggregation | `GET /broker/reports/summary` | `broker.reports.view` | `tests/stage2-broker.test.ts` | **IMPLEMENTED** |
| **`health`** | Liveness and readiness endpoints checking MySQL and Redis connectivity. | Infrastructure | `GET /health`<br>`GET /ready` | Public | `tests/http-envelope.test.ts` | **IMPLEMENTED** |

---

## 3. Cross-Cutting Infrastructure and Standards

### 3.1. Standard Unified Envelopes
All JSON responses strictly follow the standard defined in `docs/HTTP_RESPONSE_AND_ERROR_STANDARD.md`:

- **Success Envelope (`src/shared/http/success-response.ts`):**
  ```json
  {
    "success": true,
    "data": { ... },
    "meta": { "page": 1, "pageSize": 20, "total": 142 },
    "requestId": "req_01HP8XYZ..."
  }
  ```
- **Error Envelope (`src/shared/http/error-response.ts`):**
  ```json
  {
    "success": false,
    "error": {
      "code": "INSUFFICIENT_BALANCE",
      "message": "Office wallet balance is insufficient for this booking",
      "details": { "requiredMinor": 4500000, "availableMinor": 1200000 }
    },
    "requestId": "req_01HP8XYZ..."
  }
  ```

### 3.2. Error Handling Pipeline
- **`AppError` (`src/shared/errors/app-error.ts`):** Custom operational error class containing HTTP status, stable uppercase error code, message, and optional details. Factory methods include `AppError.unauthorized()`, `AppError.forbidden()`, `AppError.notFound()`, `AppError.conflict()`, `AppError.validation()`.
- **`asyncHandler` (`src/shared/middleware/async-handler.ts`):** Wraps route controllers in a `Promise.catch(next)` boundary to avoid unhandled async rejections.
- **`errorHandler` (`src/shared/middleware/error-handler.ts`):** Global terminal middleware. Catches `AppError`, Zod validation errors, Prisma constraint errors (`P2002` -> `CONFLICT`), Multer upload errors, and syntax errors, converting them into structured error envelopes with sanitized messages in production.

### 3.3. Input Validation (`src/shared/middleware/validate.ts`)
Validates incoming requests against Zod schemas for `body`, `query`, and `params`. Automatically transforms types (e.g., string to integer via `z.coerce.number()`). If validation fails, responds immediately with HTTP 422 and field-level issues.

### 3.4. Request ID Tracing (`src/shared/middleware/request-id.ts`)
Inspects the incoming `X-Request-Id` header or generates a new UUID v4. Attaches `req.requestId`, sets the `X-Request-Id` response header, and injects `requestId` into Pino structured logs and response envelopes.

### 3.5. Structured Logging (`src/infrastructure/observability/logger.ts`)
Pino-based logger formatting logs as newline-delimited JSON. Sensitive fields are redacted automatically using Pino's path matcher:
- Passwords, access tokens, refresh tokens, cookie strings, authorization headers, and raw OTP codes are redacted as `"[REDACTED]"`.

### 3.6. Persistence and Cache Lifecycles
- **Prisma Client (`src/infrastructure/database/prisma.ts`):** Lazily instantiates a singleton `PrismaClient`. Explicit lifecycle methods `connectPrisma()` and `disconnectPrisma()` are called during server startup and graceful shutdown.
- **Redis Client (`src/infrastructure/redis/redis.ts`):** Manages an `ioredis` singleton instance with automatic reconnection logic, ready checks, and prefix namespacing (`zoolgo:`).

### 3.7. Private Evidence Storage (`src/infrastructure/storage/local-disk-storage.ts`)
Implements the `StorageProvider` interface using local disk (`UPLOAD_DIR`). Files uploaded as bank receipts are stored under `./uploads/receipts/` with randomized unique filenames (`uuid + ext`). Files are **never served directly via public static Express routes**; they are downloaded only through authenticated controllers (`GET /admin/wallets/top-ups/:id/evidence`) requiring `wallets.topups.evidence.view`.

### 3.8. OpenAPI Documentation and Smoke Scripts
- Swagger UI is mounted at `/docs` (raw JSON at `/docs.json`), loaded from `docs/openapi.yaml`.
- Smoke test scripts (`scripts/smoke.mjs` and `scripts/smoke-stage2.mjs`) verify health, admin OTP login, role queries, and Stage 2 broker booking flows against a running local instance.

---

*Evidence citations:*
- Module mounting: `d:\zool-go\zool-go-backend\src\app.ts` L84–112
- Envelopes: `d:\zool-go\zool-go-backend\src\shared\http\success-response.ts` L1–19, `error-response.ts` L1–28
- AppError: `d:\zool-go\zool-go-backend\src\shared\errors\app-error.ts` L1–74
- Server lifecycle: `d:\zool-go\zool-go-backend\src\server.ts` L10–42
