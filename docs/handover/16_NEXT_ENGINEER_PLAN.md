# ZoolGo — Receiving Engineer Onboarding and Action Plan

This document provides a dependency-ordered execution plan for the incoming engineer taking ownership of the ZoolGo platform.

---

## 1. First Day Guide

### 1.1. Reading Order (Morning)
1. [README.md](README.md): High-level orientation, stack overview, and critical warnings.
2. [01_PRODUCT_AND_SCOPE.md](01_PRODUCT_AND_SCOPE.md): Product context, actors, and domain boundaries.
3. [02_REPOSITORY_MAP.md](02_REPOSITORY_MAP.md): Filesystem structure and Git status.
4. [12_LOCAL_SETUP_AND_RUNBOOK.md](12_LOCAL_SETUP_AND_RUNBOOK.md): Docker, ports, and environment setup.

### 1.2. Environment Verification (Afternoon)
Execute these exact commands to verify your local runtime environment:

```powershell
# 1. Start Docker containers
cd d:\zool-go\zool-go-backend
docker compose up -d

# 2. Verify containers are healthy
docker ps --filter "name=zoolgo"

# 3. Validate Prisma schemas and compile backend
npx prisma validate
npm run build

# 4. Run contract tests (offline)
npm test tests/architecture/http-contract.test.ts

# 5. Boot backend API in dev mode
npm run dev
```

### 1.3. Trace One Complete End-to-End Request
Open a second terminal and trace an authenticated admin workflow:
1. Open Swagger UI at `http://127.0.0.1:4000/docs`.
2. Request an OTP:
   ```powershell
   Invoke-RestMethod -Uri "http://127.0.0.1:4000/api/v1/auth/otp/request" `
     -Method POST -ContentType "application/json" `
     -Body '{"phone":"+249900000001"}'
   ```
   Note the returned `challengeId` and `devOtp`.
3. Verify the OTP and obtain an access token:
   ```powershell
   $verify = Invoke-RestMethod -Uri "http://127.0.0.1:4000/api/v1/auth/otp/verify" `
     -Method POST -ContentType "application/json" `
     -Body '{"phone":"+249900000001","code":"<DEV_OTP>","challengeId":"<CHALLENGE_ID>"}'
   $token = $verify.data.accessToken
   ```
4. Query the permission catalog with the token:
   ```powershell
   Invoke-RestMethod -Uri "http://127.0.0.1:4000/api/v1/permissions" `
     -Headers @{ Authorization = "Bearer $token" }
   ```
   Observe the 32 catalogued permissions returned in the standard success envelope.

---

## 2. First Week Roadmap and Immediate Milestones

### Work Package 1: Admin Phone-Change Security Hardening (P0 Immediate)
- **Why It Comes Next:** Closes the open security vulnerability where an admin's phone number update fails to invalidate compromised active sessions.
- **Scope:**
  - Update `verifyPhoneChangeOtp` in `src/modules/auth/auth.service.ts`.
  - Invalidate all existing `RefreshSession` records for the admin (`revokedAt = new Date()`).
  - Increment `AdminUser.authzVersion` in MySQL and call `setAuthzVersion(admin.id, nextVersion)` in Redis.
  - Expire all pending `OtpChallenge` records for this admin across all purposes (`LOGIN` and `ADMIN_PHONE_CHANGE`).
- **Tests Required:** Add test case in `tests/admin-phone-change.test.ts` verifying that after verifying a phone change, the old access token is rejected on subsequent calls with 401 Unauthorized.
- **Completion Gate:** `tests/admin-phone-change.test.ts` passes; no regression in `tests/auth-rbac.test.ts`.

### Work Package 2: Milestone C — P2 Reports, Overview KPIs, and CSV (Next Feature Milestone)
- **Why It Comes Next:** Closes the last backend data gaps required for the Admin Dashboard overview and analytics pages before frontend wiring begins.
- **Scope:**
  - `REQ-ADM-09`: Admin reporting summary (`GET /api/v1/admin/reports/summary`) aggregating bookings, revenue, and commissions across carriers and offices.
  - `REQ-ADM-10`: Overview KPI aggregate snapshot (`GET /api/v1/admin/overview/kpis`) providing counts of active carriers, low-balance offices, pending top-up reviews, and today's ticket volume.
  - `REQ-ADM-14`: Synchronous CSV export endpoints for bookings and settlements.
  - Add new permission `reports.view` to `src/shared/constants/permissions.ts` and update seeder.
- **Explicit Exclusions:** Do **not** build trial balance, general ledger journals, or live fleet GPS telemetry.
- **Completion Gate:** Integration tests verifying aggregate math against seeded fixtures; OpenAPI document updated.

### Work Package 3: Milestone E & F — Frontend Integration Preparation
- **Scope:**
  - Publish Milestone E contract adapter specification.
  - Create `/login` page in `zool-go-dashpoard` with phone OTP input.
  - Implement centralized Axios/Fetch API client with `withCredentials: true`, bearer token interceptor, and minor-unit monetary adapters.
  - Replace mock services module-by-module starting with `brokers`, `carriers`, `wallets`, `top-ups`, and `bookings`.

---

## 3. Engineering Change Checklists

### Checklist A: Adding a New Backend Endpoint
- [ ] Define Zod validation schemas in `<domain>.validation.ts` (`body`, `query`, or `params`).
- [ ] Add route to `<domain>.routes.ts` with `authenticate`, `requirePermission`, and `validate`.
- [ ] Implement controller method in `<domain>.controller.ts` returning `successResponse(data)`.
- [ ] Implement business logic and invariants in `<domain>.service.ts`.
- [ ] Implement database queries in `<domain>.repository.ts`.
- [ ] Add audit logging call (`auditService.record`) if mutating financial, access, or entity state.
- [ ] Add operation definition to `docs/openapi.yaml`.
- [ ] Add automated integration test in `tests/`.

### Checklist B: Adding a New Permission
- [ ] Append `{ key, module, description }` to `PERMISSION_CATALOG` in `src/shared/constants/permissions.ts`.
- [ ] Update `prisma/seed.ts` to assign the new permission to `super_admin`.
- [ ] Attach `requirePermission('new.permission')` to target route handlers.
- [ ] Ensure custom roles do **not** receive the permission automatically (deny-by-default).
- [ ] Write integration test verifying HTTP 403 Forbidden without the permission.

### Checklist C: Modifying Prisma Schemas and Migrations
- [ ] Edit or create `.prisma` file under `prisma/schema/`.
- [ ] Run `npx prisma validate` to confirm multi-file schema integrity.
- [ ] Run `npm run prisma:migrate` to generate a timestamped SQL migration in `prisma/migrations/`.
- [ ] Run `npm run prisma:generate` to regenerate `@prisma/client`.
- [ ] Update `tests/helpers/app.ts` `resetDatabase()` if a new table requires truncation before tests.
- [ ] Run backend tests (`npm test`) to verify zero schema regressions.

### Checklist D: Implementing a Financial Mutation (Money Invariant Rule)
- [ ] Use integer minor units exclusively (`amountMinor`, `balanceMinor`).
- [ ] Enforce database transaction via `getPrisma().$transaction(async (tx) => { ... })`.
- [ ] Acquire row lock on wallet (`SELECT FOR UPDATE`).
- [ ] Verify `balance - debit >= 0` before mutating wallet.
- [ ] Insert corresponding `WalletLedgerEntry` record with a unique `ledgerKey`.
- [ ] Write an integration test testing concurrent debit attempts and balance exhaustion.

---

*Evidence citations:*
- Milestone roadmap: `d:\zool-go\docs\ADMIN_BACKEND_COMPLETION_ROADMAP.md` L26–180
- Permission catalog: `d:\zool-go\zool-go-backend\src\shared\constants\permissions.ts` L1–44
- Phone change logic: `d:\zool-go\zool-go-backend\src\modules\auth\auth.service.ts` L640–674
- Database seeder: `d:\zool-go\zool-go-backend\prisma\seed.ts` L1–120
