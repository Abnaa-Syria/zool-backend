# GitHub Copilot Instructions for ZoolGo Backend

These instructions guide GitHub Copilot when generating, completing, or suggesting code for the ZoolGo Backend (`zool-go-backend`).

## 1. 4-Layer Architecture Rules
- Follow single-direction flow: `Route -> Controller -> Service -> Repository -> Prisma / Redis`.
- Never import `@prisma/client` or `getPrisma` in controllers or routes. All DB queries belong in `*.repository.ts`.
- Controllers parse `req.body`, `req.params`, `req.query`, call service methods, and return standard JSON envelope using `res.status(200).json(successResponse(data, meta, req.requestId))`.
- Wrap every controller async method with `asyncHandler()`.
- Services contain business logic, handle transactions, and throw typed `AppError` subclasses. Never use `res.status(500)` or access `req`/`res`.
- Mutating repository methods must accept an optional transaction parameter: `tx?: Prisma.TransactionClient`.

## 2. Financial Integrity (Zero Tolerance)
- NEVER suggest or use floating-point types (`number` representing decimals) for monetary amounts.
- All monetary fields must use integer minor units with `*Minor` suffix (`amountMinor`, `balanceMinor`, `fareAmountMinor`).
  - Example: 15,000 SDG = `1500000` (1 SDG = 100 minor units).
- Currency is strictly `"SDG"`.
- Always wrap wallet debits and credits in `getPrisma().$transaction(async (tx) => { ... })`.
- Always lock the wallet row before balance modification:
  ```typescript
  const [wallet] = await tx.$queryRaw<Wallet[]>`
    SELECT * FROM wallets WHERE brokerOfficeId = ${brokerOfficeId} FOR UPDATE
  `;
  ```
- Always insert a `WalletLedgerEntry` with `balanceBeforeMinor`, `balanceAfterMinor`, and an idempotent `ledgerKey`.
- Never allow arbitrary balance credits without a verified top-up workflow (`D-ADJ-01`).

## 3. Dynamic RBAC
- Permissions are defined in `src/shared/constants/permissions.ts` (`PERMISSION_CATALOG`).
- Guard routes with `authenticate` and `requirePermission('<permission_name>')`.
- Any role change, suspension, or credential revocation must increment `AdminUser.authzVersion` and update Redis via `setAuthzVersion(adminId, newVersion)`.

## 4. Response Envelopes & Validation
- Standard success envelope: `successResponse(data, meta, req.requestId)`.
- Standard errors: Throw `AppError` (`unauthorized`, `forbidden`, `notFound`, `conflict`, `validation`, `badRequest`).
- Validate incoming requests with Zod schemas in `*.validation.ts` using `.strict()` for updates. Attach via `validate({ body, query, params })`.

## 5. Multi-File Prisma Schema
- Schemas are split under `prisma/schema/*.prisma`. Do not suggest creating a single root `schema.prisma`.
