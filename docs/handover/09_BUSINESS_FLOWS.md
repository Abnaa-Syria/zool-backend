# ZoolGo — Core Business Flows

This document details all 34 primary business flows across the ZoolGo platform. Implemented and planned flows are documented separately with complete transactional, security, and persistence specifications.

---

## Part I: Identity, Administration, and RBAC Flows

### Flow 1: Admin OTP Login
- **Status:** **IMPLEMENTED**
- **Actors:** Central Administrator
- **Preconditions:** Admin phone exists in `AdminIdentity` with `isPrimary = true` and `AdminUser.status = ACTIVE`.
- **Endpoints:** `POST /api/v1/auth/otp/request`, `POST /api/v1/auth/otp/verify`
- **Happy Path:**
  1. Admin requests OTP for phone number.
  2. Server generates 6-digit OTP, computes HMAC, creates `OtpChallenge` (status: `PENDING`).
  3. Admin enters received code and `challengeId`.
  4. Server validates HMAC; transitions challenge to `CONSUMED`.
  5. Server creates `RefreshSession` in MySQL, syncs `authz:version:{id}` to Redis, returns access JWT in body and sets `zoolgo_refresh` HttpOnly cookie.
- **DB Records:** `OtpChallenge` created/updated; `RefreshSession` inserted.
- **Redis Effects:** `zoolgo:authz:version:{adminId}` set; rate limit counters updated.
- **Audit Event:** `auth.login.success` recorded in `AuditLog`.
- **Source Files:** `src/modules/auth/auth.service.ts` L50–250.
- **Tests:** `tests/auth-rbac.test.ts` L20–60.

### Flow 2: Refresh Token Rotation
- **Status:** **IMPLEMENTED**
- **Actors:** Authenticated Admin Client
- **Preconditions:** Valid `zoolgo_refresh` cookie present in request.
- **Endpoint:** `POST /api/v1/auth/refresh`
- **Happy Path:**
  1. Client sends refresh cookie to `/api/v1/auth/refresh`.
  2. Server hashes token with SHA-256 and searches `RefreshSession`.
  3. Verifies session is not expired and `revokedAt IS NULL`.
  4. Revokes current session (`revokedAt = now()`) and inserts a new `RefreshSession`.
  5. Issues new access JWT and rotates `zoolgo_refresh` cookie.
- **Failure / Reuse Detection:** If incoming token was already revoked, server revokes all sessions for that admin user, increments `authzVersion`, and returns 401 Unauthorized (`TOKEN_REUSED`).
- **Source Files:** `src/modules/auth/auth.service.ts` L270–345.

### Flow 3: Logout and Logout-All
- **Status:** **IMPLEMENTED**
- **Actors:** Authenticated Admin
- **Endpoints:** `POST /api/v1/auth/logout`, `POST /api/v1/auth/logout-all`
- **Happy Path (Logout):** Hashes cookie, sets `RefreshSession.revokedAt = now()`, clears `zoolgo_refresh` cookie.
- **Happy Path (Logout-All):** Revokes all sessions belonging to `adminUserId`, increments `AdminUser.authzVersion` in MySQL and Redis, immediately invalidating all outstanding JWTs.
- **Source Files:** `src/modules/auth/auth.service.ts` L350–410.

### Flow 4: Admin Self-Service Phone Change
- **Status:** **IMPLEMENTED (WITH SECURITY GAP)**
- **Actors:** Authenticated Admin
- **Preconditions:** Admin has active session; target new phone is not assigned to any other admin.
- **Endpoints:** `POST /api/v1/auth/phone/otp/request`, `POST /api/v1/auth/phone/otp/verify`
- **Happy Path:**
  1. Admin calls request endpoint with new phone. Server generates `OtpChallenge` with `purpose = ADMIN_PHONE_CHANGE` bound to `adminId`.
  2. Server sends OTP to the **new** phone.
  3. Admin verifies code on verify endpoint.
  4. In transaction, server marks challenge `CONSUMED`, updates `AdminIdentity.valueNormalized` to new phone, and records audit event `admin.phone_changed`.
- **Security Gap Note:** Does **not** revoke existing sessions or bump `authzVersion`. Flagged in [14_SECURITY_AND_OPERATIONS.md](14_SECURITY_AND_OPERATIONS.md).
- **Source Files:** `src/modules/auth/auth.service.ts` L446–674.
- **Tests:** `tests/admin-phone-change.test.ts`.

### Flow 5: Admin Creation, Status Update, and Role Assignment
- **Status:** **IMPLEMENTED**
- **Actors:** Super Admin (`admins.create`, `admins.suspend`, `roles.assign`)
- **Endpoints:** `POST /api/v1/admins`, `PATCH /api/v1/admins/:id/status`, `PUT /api/v1/admins/:id/roles`
- **Happy Path:**
  1. Admin created with `employeeCode`, `displayName`, `phone`, and array of `roleIds`.
  2. Suspending an admin (`status: SUSPENDED`) increments `authzVersion` in DB and Redis.
  3. Modifying roles (`PUT /admins/:id/roles`) replaces `UserRole` rows and increments `authzVersion`.
- **Source Files:** `src/modules/admins/admins.service.ts`.
- **Tests:** `tests/auth-rbac.test.ts`, `tests/milestone-b-admin.test.ts`.

### Flow 6: Custom Role and Permission Management
- **Status:** **IMPLEMENTED**
- **Actors:** Super Admin (`roles.create`, `roles.update`, `permissions.assign`, `roles.delete`)
- **Endpoints:** `POST /api/v1/roles`, `PUT /api/v1/roles/:id/permissions`, `DELETE /api/v1/roles/:id`
- **Happy Path:**
  1. Admin creates custom role with unique key and description.
  2. Updates role permissions: validates all keys exist in `PERMISSION_CATALOG`; updates `RolePermission` join table.
  3. Bumps `authzVersion` for all administrators possessing this role.
- **Protections:** Cannot delete or modify `isSystem = true` roles (e.g., `super_admin`).
- **Source Files:** `src/modules/roles/roles.service.ts`.

---

## Part II: Broker Office and Carrier Onboarding Flows

### Flow 7: Broker Office Creation and Policy Setup
- **Status:** **IMPLEMENTED**
- **Actors:** Central Admin (`brokers.manage`)
- **Endpoint:** `POST /api/v1/brokers`
- **Happy Path:**
  1. Admin posts office `code`, `name`, `settlementPeriod` (WEEKLY/MONTHLY), and optional overrides (`exposureCeiling`, `minTopUpMinor`, `timeZone`).
  2. Inside a transaction, server creates `BrokerOffice` and creates an associated `Wallet` with `balanceMinor = 0`.
  3. Logs audit entry `broker_office.created`.
- **DB Records:** `BrokerOffice` and `Wallet` inserted.
- **Source Files:** `src/modules/brokers/brokers.service.ts` L25–55.

### Flow 8: Broker Employee Creation and Authentication
- **Status:** **IMPLEMENTED**
- **Actors:** Broker Manager (`broker.staff.manage`) or Admin (`brokers.manage`)
- **Endpoints:** `POST /api/v1/broker/staff`, `POST /api/v1/broker/auth/otp/request`, `POST /api/v1/broker/auth/otp/verify`
- **Happy Path:**
  1. Manager adds clerk: specifies `phone`, `displayName`, `role` (CLERK), and capability flags (`canBook`, `canTopUp`, `canViewReports`).
  2. Server creates `BrokerEmployee` and `BrokerIdentity`.
  3. Clerk requests login OTP; server verifies clerk belongs to active `BrokerOffice` and `BrokerEmployee.status = ACTIVE`.
  4. On verification, server creates `BrokerRefreshSession` and sets HttpOnly cookie `zoolgo_broker_refresh`.
- **Source Files:** `src/modules/broker-staff/broker-staff.service.ts`, `broker-auth.service.ts`.

### Flow 9: Carrier Assignment to Broker Office
- **Status:** **IMPLEMENTED**
- **Actors:** Central Admin (`brokers.manage`)
- **Endpoint:** `PUT /api/v1/brokers/:officeId/carriers`
- **Happy Path:**
  1. Admin submits array of `{ transportCompanyId, commissionPercent }`.
  2. Server validates carrier exists and is active.
  3. Inside a transaction, replaces assignments in `BrokerCarrierAssignment`.
  4. Broker can now search and book trips operated by these carriers.
- **Source Files:** `src/modules/brokers/brokers.service.ts` L110–150.

---

## Part III: Prepaid Wallet and Top-Up Flows

### Flow 10: Broker Wallet Top-Up via Manual Receipt Review
- **Status:** **IMPLEMENTED (ENABLED M1 PRODUCTION PATH)**
- **Actors:** Broker Manager (`broker.wallet.topup`), Central Admin (`wallets.topups.review`, `approve`)
- **Endpoints:**
  - `POST /api/v1/broker/wallet/top-ups` (create intent)
  - `POST /api/v1/broker/wallet/top-ups/:id/evidence` (upload bank receipt)
  - `GET /api/v1/admin/wallets/top-ups` (admin inspects review queue)
  - `POST /api/v1/admin/wallets/top-ups/:id/approve` (admin approves)
- **Happy Path:**
  1. Broker initiates top-up: submits `amountMinor` (must be >= `office.minTopUpMinor`).
  2. Server creates `TopUpIntent` (status: `PENDING`, `paymentReference = TP-YYYYMMDD-XXXX`).
  3. Broker attaches bank transfer receipt image (multipart form).
  4. Server validates MIME type (PNG/JPEG/PDF), stores file in `./uploads/receipts/`, and creates `TopUpEvidence`.
  5. Admin views queue, downloads evidence via `GET /admin/wallets/top-ups/:id/evidence`.
  6. Admin approves intent: Server verifies status is `PENDING`, updates status to `SETTLED`, sets `confirmationPath = MANUAL_FALLBACK`.
  7. In transaction, server credits `Wallet.balanceMinor = balanceMinor + intent.amountMinor` and writes `WalletLedgerEntry` (`type: CREDIT`, `ledgerKey: topup:{intentId}`).
- **Key Invariant:** Admin approval endpoint accepts **no amount parameter**. It credits strictly the amount locked in the intent.
- **Source Files:** `src/modules/payments/payments.service.ts` L150–290.
- **Tests:** `tests/stage2-policy.test.ts` L140–210.

### Flow 11: Automatic Webhook Top-Up Architecture
- **Status:** **IMPLEMENTED BUT MOCKED (REAL PSP OPEN)**
- **Actors:** External Payment Service Provider (PSP)
- **Endpoint:** `POST /api/v1/payments/webhooks/:provider`
- **Happy Path:**
  1. PSP sends signed POST request with payment reference and amount.
  2. Webhook middleware captures raw bytes, verifies HMAC signature using `PAYMENT_WEBHOOK_SECRET`.
  3. Server checks payload timestamp (`PAYMENT_WEBHOOK_MAX_AGE_SECONDS = 300`).
  4. Server finds matching `TopUpIntent`. Checks unique `providerEventId` against replay.
  5. In transaction: marks intent `SETTLED`, credits wallet, inserts ledger entry.
- **Non-Production Mocking:** `POST /api/v1/payments/mock/confirm` allows local testing. It is rejected with 403 Forbidden when `NODE_ENV = production`.
- **Source Files:** `src/modules/payments/payments.service.ts` L70–145.

---

## Part IV: Catalog, Seat Holds, and Booking Flows

### Flow 12: Trip Creation and Seat Inventory
- **Status:** **IMPLEMENTED**
- **Actors:** Central Admin (`catalog.manage`)
- **Endpoint:** `POST /api/v1/catalog/trips`
- **Happy Path:** Admin submits `companyId`, `origin`, `destination`, `departureAt`, `basePrice`, and `seatLabels` (e.g., `["A1", "A2", ..., "A45"]`). Server creates `Trip` and generates 45 `TripSeat` records with `status = AVAILABLE`.

### Flow 13: Trip Search Scoped to Assigned Carriers
- **Status:** **IMPLEMENTED**
- **Actors:** Broker Clerk (`broker.book`)
- **Endpoint:** `GET /api/v1/broker/trips?origin=Port+Sudan&destination=Kassala&date=2026-11-20`
- **Happy Path:** Server filters trips where `Trip.isActive = true` AND `Trip.companyId` is in the broker's active `BrokerCarrierAssignment` list. Calculates broker commission percentage per result.
- **Authority:** Broker Journey PDF §3.3; `D-RATE-01`.

### Flow 14: Manual Seat Hold
- **Status:** **IMPLEMENTED**
- **Actors:** Broker Clerk (`broker.book`)
- **Endpoint:** `POST /api/v1/broker/trips/:tripId/holds`
- **Body:** `{ mode: "MANUAL", seatIds: ["seat_1", "seat_2"] }`
- **Happy Path:**
  1. Validates that seats are currently `AVAILABLE` and belong to the trip.
  2. Generates unique `holdToken`.
  3. Updates `TripSeat.status = HELD` and inserts `SeatHold` records (`expiresAt = now + 900s`).
  4. Returns `holdToken` to client.
- **Source Files:** `src/modules/catalog/catalog.service.ts` L80–140.

### Flow 15: Automatic Seat Hold (Auto-Assign)
- **Status:** **IMPLEMENTED**
- **Actors:** Broker Clerk (`broker.book`)
- **Body:** `{ mode: "AUTO", seatCount: 2 }`
- **Happy Path:** Server executes query with `FOR UPDATE` lock, selects available seats ordered by numeric `sortOrder` (not alphabetical label), creates `SeatHold`, and returns allocated seats.
- **Source Files:** `src/modules/catalog/catalog.service.ts` L145–195.

### Flow 16: Hold Expiry and Seat Release
- **Status:** **IMPLEMENTED**
- **Happy Path:**
  - Client release: `DELETE /api/v1/broker/holds/:holdToken` frees seats immediately (`status = AVAILABLE`).
  - Lazy expiry: Any hold whose `expiresAt < now()` is treated as expired by search and hold queries, automatically freeing seats.

### Flow 17: Booking Confirmation and Immediate Wallet Debit
- **Status:** **IMPLEMENTED**
- **Actors:** Broker Clerk (`broker.book`)
- **Endpoint:** `POST /api/v1/broker/bookings/confirm`
- **Input:** `{ tripId, seatIds, passengers, idempotencyKey }`
- **Happy Path:**
  1. Verifies `passengers.length === seatIds.length`.
  2. Checks `idempotencyKey`; returns existing booking if retried.
  3. Checks office daily exposure ceiling: calculates confirmed tickets issued today in office timezone; throws 422 if `usedToday + count > ceiling`.
  4. Locks wallet with `FOR UPDATE`. Verifies `wallet.balanceMinor >= totalAmountMinor`.
  5. Verifies caller holds the requested seats and hold has not expired.
  6. Atomic transaction:
     - Deducts `totalAmountMinor` from wallet.
     - Inserts `WalletLedgerEntry` (`type: DEBIT`, `reference: booking:{id}`).
     - Transitions `TripSeat.status = SOLD`.
     - Deletes `SeatHold`.
     - Inserts `Booking` (status: `CONFIRMED`).
     - Inserts `BookingPassenger` and `Ticket` records.
     - Inserts `CommissionAccrual` (status: `UNSETTLED`, amount: per-carrier commission).
  7. Returns confirmed booking DTO.
- **Source Files:** `src/modules/bookings/bookings.service.ts` L178–320.
- **Tests:** `tests/stage2-broker.test.ts` L120–180.

### Flow 18: Ticket Generation and PDF Download
- **Status:** **IMPLEMENTED**
- **Actors:** Broker Clerk or Central Admin (`bookings.view`)
- **Endpoints:**
  - `GET /api/v1/broker/bookings/:id/tickets/:ticketId/pdf`
  - `GET /api/v1/admin/bookings/:id/tickets/:ticketId/pdf`
- **Happy Path:**
  1. Validates booking is `CONFIRMED` and ticket exists.
  2. Calls `pdf-ticket-renderer.ts` using PDFKit.
  3. Renders thermal-style bus ticket with passenger name, ticket number, trip origin/destination, seat label, and QR code representation.
  4. Returns binary `application/pdf` with `Content-Disposition: attachment`.
  5. Records `TicketDispatchAttempt` (`channel = DOWNLOAD`, `status = SUCCESS`).
- **Channel Policy:** WhatsApp and SMS dispatch endpoints return 400 with `TICKET_CHANNEL_DISABLED` under `D-TICKET-01`.

### Flow 19: Booking Cancellation, Full Wallet Refund, and Commission Clawback
- **Status:** **IMPLEMENTED**
- **Actors:** Broker Manager/Clerk (`broker.book`) or Central Admin (`bookings.cancel`)
- **Endpoints:**
  - `POST /api/v1/broker/bookings/:id/cancel`
  - `POST /api/v1/admin/bookings/:id/cancel` (requires `{ reason: "..." }`)
- **Happy Path:**
  1. Validates booking is currently `CONFIRMED`.
  2. Inside a single atomic transaction:
     - Updates `Booking.status = CANCELLED`, records cancellation timestamp and reason.
     - Updates all linked `Ticket.status = CANCELLED`.
     - Frees bus seats: updates `TripSeat.status = AVAILABLE`.
     - Refunds full ticket fare to agency wallet: `Wallet.balanceMinor = balanceMinor + booking.totalAmountMinor`.
     - Writes `WalletLedgerEntry` (`type: CREDIT`, `reference: refund:{bookingId}`).
     - Claws back commission: updates `CommissionAccrual.status = CLAWED_BACK`.
     - Records audit log entry.
- **No Retention Tiers:** Funds return 100% to the wallet. No cancellation penalty tiers exist in M1 (`D-REF-01`).
- **Source Files:** `src/modules/bookings/bookings.service.ts` L380–510.
- **Tests:** `tests/stage2-policy.test.ts` L80–135.

---

## Part V: Commission Settlement Flows

### Flow 20: Commission Settlement Drafting
- **Status:** **IMPLEMENTED**
- **Actors:** Central Admin (`commissions.payout`)
- **Endpoint:** `POST /api/v1/admin/commissions/settlements`
- **Body:** `{ officeId, periodStart, periodEnd }`
- **Happy Path:**
  1. Checks for existing `DRAFT` settlement for this office; returns 409 Conflict if found.
  2. Finds all `UNSETTLED` accruals for the office between period bounds.
  3. Sums total commission amount.
  4. In transaction: creates `CommissionSettlement` (status: `DRAFT`) and transitions accruals to `RESERVED` with `settlementId`.
- **Source Files:** `src/modules/commissions/commissions.service.ts` L75–125.

### Flow 21: Settlement Cancellation
- **Status:** **IMPLEMENTED**
- **Endpoint:** `POST /api/v1/admin/commissions/settlements/:id/cancel`
- **Happy Path:** Updates settlement status to `CANCELLED`. In transaction, releases all linked accruals back to `UNSETTLED` (`settlementId = NULL`).

### Flow 22: Settlement Finalization
- **Status:** **IMPLEMENTED**
- **Endpoint:** `POST /api/v1/admin/commissions/settlements/:id/finalize`
- **Body:** `{ payoutReference: "BANK-TRANSFER-9876" }`
- **Happy Path:**
  1. Validates settlement is `DRAFT`.
  2. In transaction: marks settlement `FINALIZED`, updates accruals to `SETTLED`, creates `CommissionPayout` record with `payoutReference` and `paidByAdminId`.
  3. **Idempotency:** Calling finalize on an already finalized settlement succeeds without duplicate payout records.
  4. **CRITICAL:** **Does NOT touch the broker prepaid wallet.** Payout is an external bank transfer to the agency.

---

## Part VI: Operational and Audit Flows

### Flow 23: Carrier and Broker Suspension
- **Status:** **IMPLEMENTED (FLAG ONLY)**
- **Endpoints:** `PATCH /api/v1/carriers/:id`, `PATCH /api/v1/brokers/:id/status`
- **Happy Path:** Setting status to `SUSPENDED` prevents broker employees from logging in or booking new trips. Catalog queries filter out suspended carriers.
- **Open Policy Note:** Detailed cancellation cascades for already confirmed future trips on suspended carriers remain open (`D-SUS-01`).

### Flow 24: Audit Log Query
- **Status:** **IMPLEMENTED**
- **Actors:** Central Admin (`audit.view`)
- **Endpoint:** `GET /api/v1/audit-logs?action=booking.confirmed&from=2026-11-01&to=2026-11-19`
- **Happy Path:** Executes indexed query over `AuditLog` table. Validates date ranges. Returns paginated log entries with actor details and request IDs.

---

## Part VII: Planned Future Flows (Unimplemented / Deferred)

### Flow 25: Live Fleet GPS Telemetry (Planned)
- **Status:** **DESIGN ONLY / MOCKED ON FRONTEND**
- **Decision Blocked:** `D-GPS-01` (OPEN).
- **Planned Flow:** On-bus hardware telematics device sends MQTT/HTTPS packet -> Ingestion gateway validates device auth -> Redis GEO stores latest coordinate -> WebSocket server pushes real-time pin update to Admin Dashboard map.

### Flow 26: Direct Customer Booking via Bankak (Planned)
- **Status:** **DESIGN ONLY (OUT OF M1 SCOPE)**
- **Decision Blocked:** `SCOPE-01`, `D-PAY-01` (OPEN).
- **Planned Flow:** Traveler installs consumer app -> searches intercity routes -> initiates checkout via Bank of Khartoum deep link -> Bankak webhook confirms payment -> ticket issued directly to traveler phone.

### Flow 27: Conductor QR Code Boarding Verification (Planned)
- **Status:** **DESIGN ONLY / NOT STARTED**
- **Planned Flow:** Conductor opens mobile scanner app (`Zool/QRScanner.png`) -> scans QR on passenger's thermal ticket -> app hits verification endpoint -> marks ticket `BOARDED` to prevent duplicate travel.

---

*Evidence citations:*
- Booking confirmation: `d:\zool-go\zool-go-backend\src\modules\bookings\bookings.service.ts` L178–320
- Cancellation: `d:\zool-go\zool-go-backend\src\modules\bookings\bookings.service.ts` L380–510
- Settlement lifecycle: `d:\zool-go\zool-go-backend\src\modules\commissions\commissions.service.ts` L75–215
- Top-up review: `d:\zool-go\zool-go-backend\src\modules\payments\payments.service.ts` L150–290
- Audit queries: `d:\zool-go\zool-go-backend\src\modules\audit\audit.service.ts` L25–65
