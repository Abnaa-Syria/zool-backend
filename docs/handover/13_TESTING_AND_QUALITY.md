# ZoolGo — Testing and Quality Assurance

This document details the testing architecture, runtime verification results, linting quality gates, and automated test coverage across `zool-go-backend` and `zool-go-dashpoard`.

---

## 1. Test Architecture and Isolation Strategy

### 1.1. Backend Test Strategy (`zool-go-backend`)
- **Test Runner:** Vitest `3.0.8` (configured in `vitest.config.ts`).
- **HTTP Client:** Supertest `7.0.0` bound to `bootTestApp()` (`tests/helpers/app.ts`).
- **Database Isolation:**
  - Tests do **not** run against the development database (`3308`). They run against a dedicated test database container on port **3307** (`DATABASE_URL=mysql://root:root@127.0.0.1:3307/zoolgo_test`).
  - Redis runs on port **6380** with a dedicated test key prefix: `zoolgo_test:`.
  - In `beforeEach()`, tests call `resetDatabase()` (`tests/helpers/app.ts` L30–75) which truncates all tables in reverse dependency order, followed by `seedCatalogAndSuperAdmin()` to guarantee deterministic state.
- **Architectural Separation:**
  - **Pure Contract Unit Tests:** `tests/architecture/http-contract.test.ts` validates HTTP status codes and envelope formatting without requiring a running database.
  - **Integration Test Suites:** All other 8 suites execute complete end-to-end HTTP requests through the full middleware, controller, service, repository, and database stack.

### 1.2. Frontend Test Strategy (`zool-go-dashpoard`)
- **Test Runner:** Vitest `5.0.5`.
- **Scope:** 13 test files testing mock feature services (`*Service.test.ts`), telemetry mathematics (`telemetrySimulator.test.ts`), and string formatting utilities (`utils.test.ts`).
- **Current Quality Gap:** The frontend currently has **zero component rendering or user interaction tests** (e.g., React Testing Library or Playwright). Tests exercise only in-memory mock service methods.

---

## 2. Actual Verification Results (Recorded 2026-11-19)

### 2.1. Frontend Test Run
```text
Command: cd d:\zool-go\zool-go-dashpoard; npm test
Output:
 RUN  v5.0.5 D:/zool-go/zool-go-dashpoard

 ✓ src/features/settlements/services/settlementService.test.ts (9 tests)
 ✓ src/features/reports/services/reportsService.test.ts (7 tests)
 ✓ src/features/travelers/services/travelerService.test.ts (9 tests)
 ✓ src/features/refunds/services/refundService.test.ts (8 tests)
 ✓ src/features/financials/services/financialService.test.ts (7 tests)
 ✓ src/features/admin/services/adminService.test.ts (9 tests)
 ✓ src/lib/utils.test.ts (3 tests)
 ✓ src/features/admin/services/settingsService.test.ts (6 tests)
 ✓ src/features/tracking/services/telemetrySimulator.test.ts (5 tests)
 ✓ src/features/brokers/services/brokerService.test.ts (7 tests)
 ✓ src/features/bookings/services/bookingService.test.ts (7 tests)
 ✓ src/features/carriers/services/carrierService.test.ts (7 tests)
 ✓ src/services/overviewService.test.ts (5 tests)

 Test Files  13 passed (13)
      Tests  89 passed (89)
   Duration  2.82s
```

### 2.2. Frontend Linter and Build Run
```text
Command: cd d:\zool-go\zool-go-dashpoard; npm run lint; npm run build
Linter Output:
 oxlint: Found 20 warnings and 0 errors across 197 files.
 (Warnings relate to Fast Refresh export conventions in ReceiptPrinter and setState in useEffect).
Build Output:
 tsc -b && vite build
 ✓ 1330 modules transformed.
 dist/index.html                     1.19 kB
 dist/assets/index-*.css           100.68 kB
 dist/assets/index-*.js          2,426.09 kB  (Chunk warning > 500 kB)
 ✓ built in 6.68s (Exit code 0)
```

### 2.3. Backend Linter and Build Run
```text
Command: cd d:\zool-go\zool-go-backend; npm run lint; npm run build; npx prisma validate
Linter Output:
 eslint src tests --max-warnings 0
 (0 errors, 0 warnings. Exit code 0)
Build Output:
 tsc -p tsconfig.build.json
 (Compiles cleanly to dist/server.js. Exit code 0)
Prisma Output:
 npx prisma validate
 The schemas at prisma\schema are valid 🚀 (Exit code 0)
```

### 2.4. Backend Test Suite Metrics
- Total Test Files: **9 suites** (`tests/*.test.ts`)
- Total Test Cases: **72 tests**
  - **Offline Contract Tests:** `tests/architecture/http-contract.test.ts` (4 tests passed).
  - **Database Integration Tests:** 68 tests across 8 suites (require local MySQL 8.4 container on port 3307 and Redis on port 6380 via `docker compose up -d mysql-test redis`).

---

## 3. Test Coverage to Business Flow Mapping

| Flow / Module | Backend Test File | What is Verified | Important Missing Case |
|---|---|---|---|
| **Admin Auth & RBAC** | `tests/auth-rbac.test.ts` (15 tests) | OTP request/verify; rate limiting; token rotation; reuse detection; role union; suspension; super_admin lockout protections. | Token expiry during an in-flight long-running transaction. |
| **Admin Phone Change**| `tests/admin-phone-change.test.ts` (6 tests) | Unauthenticated reject; cross-admin update reject; OTP verification on new phone; duplicate phone conflict; challenge hijacking reject. | Verification that active sessions are invalidated (known gap). |
| **Broker Operations** | `tests/stage2-broker.test.ts` (14 tests) | Broker OTP login; isolated cookie; top-up intent + mock confirm; ledger entry; staff permissions; trip search; holds; atomic booking quote & confirm; exposure cap; full cancellation refund. | Concurrent booking attempt on the same hold token. |
| **Hardening & Attacks**| `tests/stage2-hardening.test.ts` (6 tests) | SQL injection resilience; malformed JSON payload recovery; excessive request body rejection; cookie header tampering. | Webhook replay with slightly modified timestamps. |
| **Stage 2.6 Policies** | `tests/stage2-policy.test.ts` (7 tests) | Office IANA timezone day bounds; SDG minor units; WhatsApp/SMS dispatch rejection (`TICKET_CHANNEL_DISABLED`); auto-seat race condition; admin cancel with reason; top-up evidence upload & approval without amount; raw webhook signature verification; settlement DRAFT reservation & idempotency. | Commission clawback when settlement has already finalized (unfunded debit). |
| **Milestone A (P0)** | `tests/milestone-a-admin.test.ts` (6 tests) | Cross-office wallet list pagination & low-balance filter; admin ticket PDF download (rejects broker tokens); settlement reserved accrual array sum; carrier GET & PATCH status idempotency; admin trip inspection without leaking holds. | PDF rendering failure with non-ASCII Arabic glyphs. |
| **Milestone B (P1)** | `tests/milestone-b-admin.test.ts` (6 tests) | Audit database multi-filter queries; central admin broker staff creation & patching; booking search by ticket number (`q`); target-admin session revoke-all; admin profile update (rejects phone); carrier search. | Searching bookings with special regex/SQL wildcard characters in `q`. |
| **HTTP Contracts** | `tests/architecture/http-contract.test.ts` (4 tests) | Standard error envelope structure (`code`, `message`, `requestId`); 404 handler envelope; health endpoint liveness. | Rate limit response header validation. |

---

## 4. How to Add an Integration Test (Conventions)

When writing a new integration test in `tests/`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  bootTestApp,
  shutdownTestApp,
  resetDatabase,
  seedCatalogAndSuperAdmin,
  loginWithOtp,
} from './helpers/app';

describe('Feature Domain Integration', () => {
  let app: Express;
  let adminToken: string;

  beforeAll(async () => {
    app = await bootTestApp();
  });

  afterAll(async () => {
    await shutdownTestApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedCatalogAndSuperAdmin();
    const login = await loginWithOtp(app, '+249900000001');
    adminToken = login.accessToken;
  });

  it('rejects unauthenticated requests with standard envelope', async () => {
    const res = await request(app).get('/api/v1/target-endpoint');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(res.body.requestId).toBeTruthy();
  });

  it('enforces required permission', async () => {
    const res = await request(app)
      .get('/api/v1/target-endpoint')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
```

---

*Evidence citations:*
- Test helpers: `d:\zool-go\zool-go-backend\tests\helpers\app.ts` L1–159
- Frontend test execution: recorded via `vitest run` on 2026-11-19
- Backend test execution: recorded via `vitest run` on 2026-11-19
- Build verification: recorded via `npm run build` on 2026-11-19
