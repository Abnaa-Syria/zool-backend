# ZoolGo — SOLID Principles and Design Patterns

This document provides an evidence-based analysis of the object-oriented and architectural design patterns applied across `zool-go-backend`. Generic theory is avoided; every pattern and principle is grounded in actual source code citations.

---

## 1. SOLID Principles in the ZoolGo Codebase

### 1. Single Responsibility Principle (SRP)
- **Application in ZoolGo:** Each layer and file owns exactly one responsibility.
  - **Controllers** handle HTTP transport only (status codes, headers, parameter extraction, response envelopes). Example: `src/modules/bookings/bookings.controller.ts` L45–65 (`confirm` delegates immediately to `bookingsService.confirm` and returns `res.status(201).json(successResponse(...))`).
  - **Services** encapsulate domain logic and business invariants (e.g., wallet balance sufficiency, exposure limits, commission calculation). Example: `src/modules/bookings/bookings.service.ts` L178–320.
  - **Repositories** encapsulate query construction, database projection, and relation joins. Example: `src/modules/bookings/bookings.repository.ts` L85–120.
  - **Validation Schemas** are kept in dedicated files separate from controllers. Example: `src/modules/bookings/bookings.validation.ts` L24–27.
- **Where Intentionally Relaxed:** In smaller read-only modules like `permissions` (`src/modules/permissions/`), the service and repository are minimal or combined to avoid unnecessary indirection.
- **Current Technical Debt:** In `src/modules/auth/auth.service.ts`, the `AuthService` class handles login OTP, phone-change OTP, session refreshing, token verification, and identity updates (677 lines). Refactoring into separate `AdminAuthService` and `AdminPhoneService` is recommended.
- **How to Preserve:** Never perform database queries (`prisma.*`) inside a controller or route handler. Never inspect `req` or format HTTP responses inside a service.

### 2. Open/Closed Principle (OCP)
- **Application in ZoolGo:** Core systems are open for extension via provider interfaces without altering business orchestrators.
  - **Payment Processing:** `PaymentProvider` interface (`src/modules/payments/payment-provider.ts` L1–15) defines `verifyWebhookSignature`, `parseWebhookPayload`, and `confirmPayment`. Adding a real Sudanese payment provider (e.g., Bankak or SyberPay) requires writing a new class implementing `PaymentProvider` without modifying `payments.service.ts`.
  - **Receipt Storage:** `StorageProvider` interface (`src/infrastructure/storage/storage-provider.ts` L1–12) abstracts file persistence. `LocalDiskStorageProvider` implements local filesystem storage. Migrating to S3/Cloud Storage involves creating an `S3StorageProvider` without touching `payments.controller.ts`.
  - **OTP Delivery:** `OtpDeliveryProvider` interface (`src/modules/auth/otp-delivery.ts` L1–8) abstracts SMS delivery. Currently implemented by `ConsoleOtpDeliveryProvider`; real SMS gateways (e.g., Zain, MTN, Sudani) plug in as new implementations.
- **How to Preserve:** When integrating external infrastructure, define or implement a TypeScript interface rather than importing concrete vendor SDKs into domain services.

### 3. Liskov Substitution Principle (LSP)
- **Application in ZoolGo:** Provider implementations can be substituted interchangeably without altering caller semantics.
  - In `src/modules/payments/payment-provider.ts`, `MockPaymentProvider` adheres strictly to `PaymentProvider`. In tests and development, passing `MockPaymentProvider` satisfies all contract requirements of `PaymentsService` without breaking the webhook ingestion lifecycle.
  - `LocalDiskStorageProvider` returns standard `Promise<StoredFileResult>` and streams buffers identically to what a remote cloud storage provider would return.
- **How to Preserve:** Ensure new provider adapters do not throw unexpected vendor-specific runtime errors; catch vendor exceptions and translate them into standard domain exceptions or `AppError`.

### 4. Interface Segregation Principle (ISP)
- **Application in ZoolGo:** Interfaces are compact, purposeful, and client-focused rather than bloated.
  - `StorageProvider` (`src/infrastructure/storage/storage-provider.ts`) contains only two methods: `saveFile(file)` and `getFile(path)`. Clients needing file storage are not forced to implement file deletion, archiving, or bucket administration.
  - `OtpDeliveryProvider` (`src/modules/auth/otp-delivery.ts`) has a single method: `sendOtp(phone, code, purpose)`.
- **How to Preserve:** Avoid creating large "god interfaces" (e.g., do not combine payment verification, refund processing, and wallet ledger updates into a single interface).

### 5. Dependency Inversion Principle (DIP)
- **Application in ZoolGo:** High-level policy services depend on abstractions rather than low-level concrete implementations where flexibility is needed (e.g., `PaymentsService` depends on `PaymentProvider`; `PaymentsController` depends on `StorageProvider`).
- **Where Pragmatically Relaxed:** Domain services import `getPrisma()` and `getRedis()` directly from `src/infrastructure/` rather than receiving ORM instances via an IoC container. This is an intentional architectural choice for a modular monolith in TypeScript, avoiding heavy dependency injection boilerplate while maintaining modular boundaries.

---

## 2. Design Patterns Evidenced in Source Code

| Pattern | Where Used in Code | Purpose & Justification | Extension Procedure | Risks & Limitations |
|---|---|---|---|---|
| **Modular Monolith** | `src/modules/*`, `src/app.ts` | High cohesion within business verticals; clear module boundaries without microservices operational overhead. | Create new domain folder under `src/modules/`; expose a router and mount in `app.ts`. | Risk of module coupling if repositories start importing other modules' Prisma models indiscriminately. |
| **Layered Architecture** | Every module (`routes -> controller -> service -> repository`) | Separation of concerns; separates HTTP serialization from transactional business rules. | Follow the 4-layer template for every new entity. | Slight boilerplate for simple CRUD operations. |
| **Repository Pattern** | `*repository.ts` in all modules | Encapsulates Prisma queries, database projections, and complex transactional joins. | Add data access methods to the domain repository; accept optional `tx: Prisma.TransactionClient`. | Leaking Prisma-specific types outside the repository layer. |
| **Service Layer** | `*service.ts` in all modules | Encapsulates application business rules, policy enforcement, and multi-entity coordination. | Create public async methods that accept typed inputs and return DTOs. | Services growing too large if multiple workflows are lumped into one file. |
| **Adapter Pattern** | `src/modules/payments/payment-provider.ts`<br>`src/infrastructure/storage/local-disk-storage.ts` | Decouples business logic from external third-party APIs and filesystem specifics. | Implement the target interface and register in the factory/constructor. | Subtle behavioral differences in third-party error handling. |
| **Strategy Pattern** | `SeatAssignmentStrategy` in `src/modules/catalog/catalog.service.ts` | Handles `MANUAL` (user-chosen seat array) vs `AUTO` (numerical `sortOrder` auto-allocation) seat selection. | Add new assignment strategy enum and branch logic in `catalog.service.ts`. | Potential race conditions in auto-allocation under high concurrent load (mitigated by row locks). |
| **Factory Pattern** | `AppError` (`src/shared/errors/app-error.ts` L25–55) | Provides standardized construction of HTTP operational errors with pre-mapped codes. | Add new static factory methods (e.g., `AppError.locked()`) to `AppError`. | None. |
| **Middleware Pipeline** | `src/shared/middleware/*`, `src/app.ts` | Intercepts HTTP requests for security headers, CORS, request IDs, JWT verification, and validation. | Write an Express middleware function `(req, res, next)` and mount before routes. | Order of execution is critical (e.g., raw body parser must precede JSON parser). |
| **Unit of Work via Prisma Transaction** | `getPrisma().$transaction(async (tx) => { ... })` across `bookings.service.ts`, `payments.service.ts` | Ensures ACID compliance across multi-table mutations (e.g., wallet debit + seat status update + booking creation). | Wrap interdependent repository operations inside `$transaction`. | Long-running operations inside `$transaction` can cause database lock timeouts. |
| **Idempotency Key Pattern** | `POST /broker/bookings/confirm`, `POST /admin/commissions/settlements/:id/finalize` | Prevents duplicate charges and duplicate payouts during network timeouts or client retries. | Check unique key column (`idempotencyKey` or `ledgerKey`) before mutating state; return existing record if found. | Clients failing to send unique keys on genuinely new requests. |

---

## 3. How to Add a New Backend Module (Engineering Guide)

When adding a new feature domain (e.g., `disputes` or `notifications`), follow this exact 5-step procedure:

### Step 1: Define Database Schema
In `prisma/schema/<domain>.prisma`:
```prisma
model Dispute {
  id          String        @id @default(uuid())
  bookingId   String
  status      DisputeStatus @default(OPEN)
  reason      String        @db.VarChar(500)
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt

  booking     Booking       @relation(fields: [bookingId], references: [id])

  @@index([bookingId])
  @@map("disputes")
}

enum DisputeStatus {
  OPEN
  RESOLVED
  REJECTED
}
```
Run `npx prisma validate` and `npx prisma migrate dev --name add_disputes`.

### Step 2: Define Zod Validation
In `src/modules/disputes/disputes.validation.ts`:
```typescript
import { z } from 'zod';

export const createDisputeSchema = z.object({
  bookingId: z.string().uuid(),
  reason: z.string().trim().min(5).max(500),
});
```

### Step 3: Implement Repository and Service
In `src/modules/disputes/disputes.repository.ts` and `disputes.service.ts`:
- Repository handles database queries via `getPrisma()`.
- Service enforces business invariants and audit logging.

### Step 4: Implement Controller and Routes
In `src/modules/disputes/disputes.routes.ts`:
```typescript
import { Router } from 'express';
import { authenticate } from '../../shared/middleware/authenticate';
import { requirePermission } from '../../shared/middleware/require-permission';
import { validate } from '../../shared/middleware/validate';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { disputesController } from './disputes.controller';
import { createDisputeSchema } from './disputes.validation';

export const disputesRoutes = Router();
disputesRoutes.use(authenticate);

disputesRoutes.post(
  '/',
  requirePermission('bookings.cancel'),
  validate({ body: createDisputeSchema }),
  asyncHandler((req, res) => disputesController.create(req, res)),
);
```

### Step 5: Mount in Express Application
In `src/app.ts`:
```typescript
import { disputesRoutes } from './modules/disputes';
// Inside createApp():
app.use(`${prefix}/disputes`, disputesRoutes);
```

---

## 4. How to Add a Real Payment Provider Adapter

To replace the mock payment provider with a production gateway (e.g., Bankak):

1. **Implement `PaymentProvider`** in `src/modules/payments/adapters/bankak-payment-provider.ts`:
   ```typescript
   import { PaymentProvider, WebhookVerificationResult, ParsedWebhookPayload } from '../payment-provider';

   export class BankakPaymentProvider implements PaymentProvider {
     readonly providerName = 'bankak';

     verifyWebhookSignature(rawBody: Buffer, signatureHeader?: string): boolean {
       // Perform HMAC-SHA256 comparison against process.env.BANKAK_WEBHOOK_SECRET
     }

     parseWebhookPayload(body: unknown): ParsedWebhookPayload {
       // Map Bankak payload fields to standard providerEventId, paymentReference, amountMinor
     }
   }
   ```
2. **Register in Payment Service:** Update `getPaymentProvider(name)` in `src/modules/payments/payment-provider.ts` to return the new instance based on configuration.

---

*Evidence citations:*
- Payment adapter: `d:\zool-go\zool-go-backend\src\modules\payments\payment-provider.ts` L1–40
- Storage adapter: `d:\zool-go\zool-go-backend\src\infrastructure\storage\local-disk-storage.ts` L1–35
- Booking transaction & unit of work: `d:\zool-go\zool-go-backend\src\modules\bookings\bookings.service.ts` L230–315
- AppError factory: `d:\zool-go\zool-go-backend\src\shared\errors\app-error.ts` L1–74
