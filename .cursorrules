# ZoolGo Backend — Coding Rules (summary)

**Single source of truth: `AGENTS.md` (repo root).** Read it before writing code. This file is a short summary kept in sync with it; if they ever disagree, `AGENTS.md` and the code win. API rules for every client: `docs/API_CONVENTIONS.md`. Project plan: `docs/MASTER_PLAN.md`.

## Layers (zool-go-backend/src/modules/<domain>/)
- `*.routes.ts` → `authenticate` + `requirePermission('<key>')` (admin) or `authenticateBroker` + `requireBrokerPermission(...)` (broker), `validate({ body/query/params })`, then `asyncHandler`.
- `*.controller.ts` → parse HTTP, call service, `return successResponse(res, { statusCode, message, data, meta, requestId: req.requestId })`. Never `res.json` / `res.status().json` (enforced by `tests/architecture/http-contract.test.ts`).
- `*.service.ts` → business logic, transactions via `getPrisma().$transaction(async (tx) => ...)`, throws `AppError` (`validation`, `unauthorized`, `forbidden`, `notFound`, `conflict`, `rateLimited`, `internal`) or domain codes from `src/shared/errors/error-codes.ts`. No Express imports.
- `*.repository.ts` → all Prisma access; mutating methods accept optional `tx`.
- Zod schemas in `*.validation.ts`; `.strict()` on update schemas.

## Money (zero tolerance)
- Integers in minor units only (1 SDG = 100). Currency `SDG`. API fields end in `*Minor`; DB columns are plain ints (`balance`, `basePrice`, `totalAmount`).
- Wallet changes: inside a transaction, `walletsRepository.lockWallet(walletId, tx)` first, then a `WalletLedgerEntry` (`type`, positive `amount`, `balanceAfter`, unique `idempotencyKey`, `referenceType`/`referenceId`).
- No admin balance adjustments outside the audited top-up flow (D-ADJ-01).

## RBAC
- Admin permissions in `src/shared/constants/permissions.ts`; broker in `broker-permissions.ts`. Never hard-code ad-hoc strings.
- Role change, suspension, session revoke or credential change → increment `authzVersion` and `setAuthzVersion(...)`.

## Database
- Schema: `prisma/schema/*.prisma`; migrations: `prisma/schema/migrations/` only; additive migrations; never edit a pushed migration.

## Tests
- Vitest + Supertest in `tests/`; `.env.test` must point to a DB whose name contains `test`. Run `npm run lint && npx tsc --noEmit && npm test`.
