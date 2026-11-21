# ZoolGo Backend — AI Agent Guidelines & Architectural Patterns

This document is the authoritative instruction file for all AI agents, tools, and code assistants (including Antigravity, OpenAI Codex, Cursor, Claude Code, GitHub Copilot, Windsurf, and Gemini CLI) working on the **ZoolGo Backend** (`zool-go-backend`).

Any code generated, refactored, or reviewed MUST adhere strictly to these architectural patterns, conventions, and invariants.

---

## 1. Project Overview & Technology Stack

- **Role**: Backend for ZoolGo (Sudan intercity bus booking, broker office wallet management, trips, and admin operations).
- **Runtime**: Node.js 22 LTS, TypeScript 5.8 (ES2022 target, NodeNext module resolution).
- **Framework**: Express 4.21 modular monolith.
- **Database & ORM**: MySQL 8.4 with Prisma ORM 6.19 using **multi-file schemas** (`prisma/schema/*.prisma`).
- **Cache & Sessions**: Redis 7.4 via `ioredis` (prefix `zoolgo:` for dev/prod, `zoolgo_test:` for tests).
- **Validation**: Zod 3.24.
- **Testing**: Vitest 3.x + Supertest.

---

## 2. Strict 4-Layer Architecture

Code must maintain single-direction dependency flow. Never bypass layers.

```text
Route Definition (src/modules/<domain>/<domain>.routes.ts)
  ↓
Middleware Pipeline (authenticate, requirePermission, validate)
  ↓
Controller Layer (src/modules/<domain>/<domain>.controller.ts)
  ↓
Service Layer (src/modules/<domain>/<domain>.service.ts)
  ↓
Repository Layer (src/modules/<domain>/<domain>.repository.ts)
  ↓
Infrastructure (Prisma MySQL 8.4, ioredis Redis 7.4, Local File Storage)
```

### Layer Rules:
1. **Route (`*.routes.ts`)**:
   - Only declare route paths, HTTP verbs, and attach middleware (`authenticate`, `requirePermission`, `validate`).
   - Never write business logic, database queries, or parameter transformations in route files.
2. **Controller (`*.controller.ts`)**:
   - Parse HTTP inputs (`req.body`, `req.params`, `req.query`, `req.user`).
   - Call the appropriate service method.
   - Return standard JSON envelope: `res.status(200).json(successResponse(data, meta, req.requestId))`.
   - Wrap all methods with `asyncHandler`.
   - Never query Prisma or make transaction decisions in controllers.
3. **Service (`*.service.ts`)**:
   - Contains pure business logic, policies, orchestration, and authorization rules.
   - Coordinates database transactions using `getPrisma().$transaction(async (tx) => { ... })`.
   - Throws typed `AppError` exceptions on business failures.
   - Never reference Express `req`, `res`, or HTTP status codes.
4. **Repository (`*.repository.ts`)**:
   - Encapsulates all Prisma queries, row locks (`SELECT FOR UPDATE`), and joins.
   - Every mutating method must accept an optional transaction client: `tx?: Prisma.TransactionClient`.
   - Fall back to default client: `const prisma = tx ?? getPrisma();`.
   - Never format HTTP responses or throw HTTP status errors.

---

## 3. Financial Invariants & Money Rules (CRITICAL — ZERO TOLERANCE)

1. **Minor Units Only (Integers)**:
   - Money is **never** stored, calculated, or passed as floating-point numbers or major units.
   - Fields must use the `*Minor` suffix: `amountMinor`, `balanceMinor`, `fareAmountMinor`, `commissionAmountMinor`.
   - In Sudanese Pounds (SDG), `1 SDG = 100 minor units`. Example: 25,000 SDG = `2500000`.
2. **Strict Currency**:
   - Currency is locked to `"SDG"` (`D-CUR-01`).
3. **Atomic Wallet Transactions**:
   - Any wallet debit, credit, top-up, booking charge, or refund **MUST** run inside `getPrisma().$transaction()`.
   - **Pessimistic Row Locking**: Before modifying wallet balances, acquire an exclusive row lock:
     ```typescript
     const [wallet] = await tx.$queryRaw<Wallet[]>`
       SELECT * FROM wallets WHERE brokerOfficeId = ${brokerOfficeId} FOR UPDATE
     `;
     ```
   - Verify balance sufficiency explicitly: `if (wallet.balanceMinor < debitAmountMinor) throw WalletErrors.insufficientBalance();`.
4. **Double-Entry Ledger Integrity**:
   - Every balance modification **MUST** create a corresponding `WalletLedgerEntry` record in the same transaction.
   - Required fields: `walletId`, `amountMinor`, `balanceBeforeMinor`, `balanceAfterMinor`, `type`, `referenceType`, `referenceId`, `ledgerKey`.
   - `ledgerKey` must be unique and idempotent (e.g. `topup:{intentId}`, `booking:{bookingId}`, `refund:{bookingId}`) to prevent replay attacks or duplicate balance modifications.
5. **No Arbitrary Adjustments**:
   - Administrative balance adjustments without a verified top-up intent or audited workflow are strictly forbidden (`D-ADJ-01`).

---

## 4. Dynamic RBAC and Security Conventions

1. **Permission Catalog**:
   - All permissions must be defined in `src/shared/constants/permissions.ts` (`PERMISSION_CATALOG`).
   - Never invent or hardcode arbitrary permission strings in routes or services.
2. **Route Protection**:
   - Always chain `authenticate` and `requirePermission('<permission_code>')`:
     ```typescript
     router.get('/', authenticate, requirePermission('trips.view'), asyncHandler(controller.list));
     router.post('/', authenticate, requirePermission('trips.create'), validate({ body: createTripSchema }), asyncHandler(controller.create));
     ```
3. **Role Union Evaluation**:
   - Admins can hold multiple roles. Effective permissions are computed as the union across all active roles assigned to the user.
4. **Authorization Invalidation (`authzVersion`)**:
   - Whenever an admin's roles change, their account is suspended, or sessions are revoked:
     - Increment `AdminUser.authzVersion` in MySQL.
     - Sync to Redis key `zoolgo:authz:version:{adminId}` via `setAuthzVersion(adminId, newVersion)`.
   - The `authenticate` middleware checks Redis on every request; tokens with stale `authzVersion` are rejected immediately with 401 Unauthorized.
5. **Phone Number Changes**:
   - When a phone number is changed and verified via OTP, active sessions must be invalidated and `authzVersion` incremented.

---

## 5. Unified HTTP Envelopes & Error Handling

Adhere strictly to `docs/HTTP_RESPONSE_AND_ERROR_STANDARD.md`.

### Success Response:
```typescript
import { successResponse } from '../../shared/http/success-response';

// Standard 200 OK
res.status(200).json(successResponse(data, meta, req.requestId));

// Standard 201 Created
res.status(201).json(successResponse(createdEntity, undefined, req.requestId));
```

Envelope structure:
```json
{
  "success": true,
  "data": { ... },
  "meta": { "page": 1, "limit": 20, "total": 100, "totalPages": 5 },
  "requestId": "req_abc123"
}
```

### Operational Errors:
Always throw `AppError` (`src/shared/errors/app-error.ts`). Never return ad-hoc error JSON objects.
```typescript
import { AppError } from '../../shared/errors/app-error';

throw AppError.unauthorized('Invalid phone number or password');
throw AppError.forbidden('User lacks permission: trips.create');
throw AppError.notFound('Bus trip not found');
throw AppError.conflict('Phone number already registered');
throw AppError.badRequest('Invalid status transition');
throw AppError.validation('Validation failed', validationErrors);
```

---

## 6. Input Validation with Zod

1. Schemas reside in `src/modules/<domain>/<domain>.validation.ts`.
2. Reuse shared pagination: `import { paginationQuerySchema } from '../../shared/validation/common';`.
3. Use `.strict()` on update payloads to reject unknown/unauthorized fields:
   ```typescript
   export const updateTripSchema = z.object({
     fareAmountMinor: z.number().int().positive().optional(),
     departureTime: z.string().datetime().optional(),
   }).strict();
   ```
4. Attach validation middleware to routes:
   ```typescript
   import { validate } from '../../shared/middleware/validate';
   router.post('/', validate({ body: createSchema, query: querySchema }), asyncHandler(controller.create));
   ```

---

## 7. Prisma Multi-File Schema Conventions

1. **Schema Location**: Multi-file schemas live in `prisma/schema/*.prisma`:
   - `base.prisma`: Datasource & client generator
   - `auth.prisma`: Admin, roles, permissions, sessions
   - `broker.prisma`: Broker offices, staff, wallets, ledger
   - `transport.prisma`: Companies, buses, routes, trips
   - `booking.prisma`: Bookings, tickets, passengers, refunds
   - `finance.prisma`: Top-up intents, payment receipts
   - `audit.prisma`: Audit logs
2. **Commands**:
   - Validate: `npx prisma validate`
   - Generate Client: `npm run prisma:generate`
   - Create Migration: `npx prisma migrate dev --name <migration_name>`
3. **Conventions**:
   - Enums: PascalCase (`BookingStatus`, `WalletLedgerType`).
   - Models: PascalCase (`BrokerOffice`, `WalletLedgerEntry`).
   - Fields: camelCase (`brokerOfficeId`, `amountMinor`, `createdAt`).
   - Timestamp fields: Always include `createdAt DateTime @default(now())` and `updatedAt DateTime @updatedAt` on mutable tables.

---

## 8. Testing Conventions

- **Runner**: Vitest 3.x.
- **Port Isolation**:
  - Test MySQL runs on port **3307** (`zoolgo_test` database).
  - Test Redis runs on port **6380** (`zoolgo_test:` prefix).
  - Dev MySQL runs on port 3308. Dev and test share one Redis on 6380, isolated by key prefix (`zoolgo:` vs `zoolgo_test:`).
  - Tests load `.env.test` (copy from `.env.test.example`); `tests/setup.ts` refuses to run if the DB name does not contain `test`.
- **Database Reset**: Every integration test must reset and seed in `beforeEach()`:
  ```typescript
  import { resetDatabase } from '../helpers/reset-db';
  import { seedCatalogAndSuperAdmin } from '../helpers/seed-catalog';

  beforeEach(async () => {
    await resetDatabase();
    await seedCatalogAndSuperAdmin();
  });
  ```
- **Offline / Architecture Tests**: Place pure contract and architecture verification tests (no database required) in `tests/architecture/*.test.ts`.

---

## 9. Prohibited Actions for AI

- **DO NOT** use floating-point types for currency or monetary amounts.
- **DO NOT** modify wallet balances without acquiring a row lock (`SELECT FOR UPDATE`) and creating a ledger entry.
- **DO NOT** import Prisma client directly inside controllers or route files.
- **DO NOT** return raw Express error objects or unformatted JSON errors.
- **DO NOT** hardcode permission strings outside `PERMISSION_CATALOG`.
- **DO NOT** create a single monolithic `schema.prisma` file.
- **DO NOT** allow arbitrary wallet credit adjustments without an audited flow.
