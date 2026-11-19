# CLAUDE.md — ZoolGo Backend Guide

Commands, architectural guidelines, and invariants for Claude Code working on the ZoolGo Backend repository.

## Commands

All commands run in `zool-go-backend`:

```bash
# Dependencies
npm install

# Build & Typecheck
npm run build
npx tsc --noEmit

# Database & Migrations
npx prisma validate
npm run prisma:generate
npm run prisma:migrate
# Or create migration:
npx prisma migrate dev --name <migration_name>

# Testing
npm test                             # Run full test suite (requires Docker test containers on 3307/6380)
npx vitest run tests/architecture/   # Run offline architecture tests (no DB required)
npx vitest run tests/auth/           # Run specific domain test

# Docker Services (from repo root)
docker compose up -d mysql-dev redis-dev     # Dev DB (3308) & Redis (6379)
docker compose up -d mysql-test redis-test   # Test DB (3307) & Redis (6380)
```

## Core Architecture Invariants

1. **4-Layer Dependency Direction**:
   `Routes -> Controller -> Service -> Repository -> Prisma / Redis`
   - Never import Prisma in controllers or route definitions.
   - Controllers only parse HTTP, call services, and return `res.status(200).json(successResponse(data, meta, req.requestId))`.
   - Services throw `AppError` subclasses. Never use `res.status(500)`.
   - Mutating repository methods must accept an optional `tx?: Prisma.TransactionClient`.

2. **Money and Financial Integrity (ZERO TOLERANCE)**:
   - Money is **never** floating-point. All monetary amounts must be integer minor units (`*Minor`).
   - 1 SDG = 100 minor units (`1500000` = 15,000 SDG). Currency is strictly `"SDG"`.
   - Wallet balance modifications **must** be inside `getPrisma().$transaction()`.
   - Always acquire an exclusive row lock before modifying balance:
     `SELECT * FROM wallets WHERE brokerOfficeId = ? FOR UPDATE`
   - Every balance change must insert a `WalletLedgerEntry` with `balanceBeforeMinor`, `balanceAfterMinor`, and an idempotent `ledgerKey`.
   - Direct administrative wallet balance credit without a verified top-up intent is strictly forbidden (`D-ADJ-01`).

3. **Dynamic RBAC & Security**:
   - Capabilities are declared in `src/shared/constants/permissions.ts` (`PERMISSION_CATALOG`).
   - Guard routes using `authenticate` + `requirePermission('<permission_code>')`.
   - Admin user effective permissions = union of all assigned active roles.
   - Any role revocation, suspension, or credential change must increment `AdminUser.authzVersion` and update Redis key `zoolgo:authz:version:{adminId}`.

4. **Response Envelopes & Validation**:
   - Success envelope: `successResponse(data, meta, req.requestId)`.
   - Error throwing: `AppError.badRequest()`, `AppError.unauthorized()`, `AppError.forbidden()`, `AppError.notFound()`, `AppError.conflict()`, `AppError.validation()`.
   - Controller async handlers: Wrap with `asyncHandler()`.
   - Zod validation: Put schemas in `<domain>.validation.ts`. Use `.strict()` on update schemas.

5. **Prisma Multi-File Layout**:
   - Schemas are split under `prisma/schema/*.prisma`. Do not create a single root `schema.prisma`.
