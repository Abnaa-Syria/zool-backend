---
name: zoolgo-backend-patterns
description: >-
  Mandatory architectural and engineering conventions for ZoolGo backend (Express, Prisma, MySQL, Redis).
  Use whenever implementing, modifying, reviewing, or testing backend endpoints, services, repositories,
  database schemas, financial operations, or RBAC.
---

# ZoolGo Backend Architecture and Coding Standards

This skill defines the mandatory engineering patterns, conventions, and architectural rules for `zool-go-backend`. Any AI assistant working on this codebase must follow these patterns without deviation.

---

## 1. Architectural Philosophy: Strict Layered Monolith

Dependencies flow in one direction only:
```text
Route Definition (src/modules/<domain>/<domain>.routes.ts)
  ↓
Middleware Pipeline (authenticate, requirePermission, validate)
  ↓
Controller (src/modules/<domain>/<domain>.controller.ts)
  ↓
Service Layer (src/modules/<domain>/<domain>.service.ts)
  ↓
Repository Layer (src/modules/<domain>/<domain>.repository.ts)
  ↓
Infrastructure (Prisma / MySQL 8.4, ioredis / Redis 7.4, Local Storage)
```

### Layer Rules & Prohibitions
- **Routes:** Only declare path, HTTP verb, and attach middleware (`authenticate`, `requirePermission`, `validate`). Never put business logic or queries here.
- **Controllers:** Extract `req.body`, `req.params`, `req.query`, invoke the service, and return standard JSON envelope. Never call Prisma or perform business validation here.
- **Services:** Pure business rules, policy resolution, transaction orchestration, audit logging. Never touch Express `req`, `res`, or format HTTP status codes.
- **Repositories:** Encapsulate Prisma queries, table joins, and row locking (`SELECT FOR UPDATE`). Accept an optional `tx?: Prisma.TransactionClient`. Never throw HTTP errors directly.

---

## 2. Financial Integrity and Money Rules (CRITICAL)

- **Minor Units Only:** Money is **NEVER** stored or calculated as floats or major currency.
  - Fields must be named `*Minor`: `amountMinor`, `balanceMinor`, `fareAmountMinor`, `commissionAmountMinor`.
  - In Sudanese Pounds (SDG), `1 SDG = 100 minor units`. 15,000 SDG = `1500000`.
- **Currency Standard:** Currency is strictly `"SDG"`. Multi-currency is not supported in M1 (`D-CUR-01`).
- **Atomic Wallet Transactions:**
  - Any wallet debit or credit **MUST** execute within an atomic transaction: `getPrisma().$transaction(async (tx) => { ... })`.
  - Always acquire a row lock on the wallet before balance modification:
    ```typescript
    const wallet = await tx.$queryRaw<Wallet[]>`SELECT * FROM wallets WHERE brokerOfficeId = ${officeId} FOR UPDATE`;
    ```
  - Verify balance sufficiency: `if (wallet.balanceMinor < amountMinor) throw WalletErrors.insufficientBalance();`.
- **Double-Entry Ledger Invariant:**
  - Every wallet balance update **MUST** insert a corresponding `WalletLedgerEntry`.
  - Must record `balanceBeforeMinor` and `balanceAfterMinor`.
  - Must provide a unique, idempotent `ledgerKey` (e.g. `topup:{intentId}`, `booking:{bookingId}`, `refund:{bookingId}`) to prevent duplicate credits or debits.
- **No Arbitrary Credit:** Exceptional administrative wallet adjustments without a verified top-up intent are strictly prohibited (`D-ADJ-01`).

---

## 3. Dynamic RBAC and Security Pipeline

- **Fixed Permission Catalog:** All capabilities are declared in `src/shared/constants/permissions.ts` (`PERMISSION_CATALOG`).
- **Endpoint Protection:** Every administrative route must be guarded:
  ```typescript
  import { authenticate } from '../../shared/middleware/authenticate';
  import { requirePermission } from '../../shared/middleware/require-permission';

  routes.use(authenticate);
  routes.get('/', requirePermission('bookings.view'), asyncHandler(controller.list));
  ```
- **Union of Multiple Roles:** Admins can have multiple roles. Permissions are evaluated as the mathematical union across active roles.
- **Authorization Invalidation (`authzVersion`):**
  - Whenever an admin's role, status, or session is revoked, increment `AdminUser.authzVersion` in MySQL and sync to Redis `zoolgo:authz:version:{adminId}` via `setAuthzVersion()`.
  - The `authenticate` middleware checks Redis on every request; stale access tokens are rejected immediately.

---

## 4. HTTP Envelopes and Error Handling

All JSON endpoints strictly adhere to `docs/HTTP_RESPONSE_AND_ERROR_STANDARD.md`.

### Success Envelope
Use `successResponse()` from `src/shared/http/success-response.ts`:
```typescript
res.status(200).json(successResponse(data, meta, req.requestId));
// For 201 Created:
res.status(201).json(successResponse(createdData, undefined, req.requestId));
```

### Operational Errors
Always throw typed `AppError` (`src/shared/errors/app-error.ts`):
```typescript
throw AppError.unauthorized('Invalid credentials');
throw AppError.forbidden('Missing required permission');
throw AppError.notFound('Trip not found');
throw AppError.conflict('Phone identity already registered');
throw AppError.validation('Invalid parameters', { field: 'phone' });
```
Never return raw error objects or call `res.status(500)`. Wrap all async controller functions with `asyncHandler` (`src/shared/middleware/async-handler.ts`).

---

## 5. Input Validation with Zod

Validation schemas live in `<domain>.validation.ts`:
```typescript
import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/validation/common';

export const listQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  q: z.string().trim().min(1).max(100).optional(),
});

export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(2).max(160),
}).strict(); // Use .strict() to reject unapproved fields like phone
```
Attach to routes via `validate({ query: listQuerySchema, body: ..., params: ... })`.

---

## 6. Prisma Database Schema Conventions

- **Multi-File Layout:** Prisma schema is split across `prisma/schema/*.prisma`. Never look for a single root `schema.prisma`.
- **Migrations:**
  - Validate: `npx prisma validate`
  - Migrate: `npm run prisma:migrate` (or `npx prisma migrate dev --name <migration_name>`)
  - Generate Client: `npm run prisma:generate`
- **Audit Fields:** Always include `createdAt DateTime @default(now())` and `updatedAt DateTime @updatedAt` on mutable domain models.

---

## 7. Testing Conventions

- **Framework:** Vitest + Supertest (`tests/*.test.ts`).
- **Database Isolation:** Integration tests run against port **3307** (`zoolgo_test`) and Redis port **6380** (`zoolgo_test:` prefix).
- **Test Reset:** In `beforeEach()`, always invoke:
  ```typescript
  await resetDatabase();
  await seedCatalogAndSuperAdmin();
  ```
- **Pure Contract Tests:** Place tests that do not require database connections in `tests/architecture/`.
