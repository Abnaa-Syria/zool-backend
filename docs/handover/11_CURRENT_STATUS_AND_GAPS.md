# ZoolGo — Current Status and Technical Gaps

This document provides a truthful, evidence-backed snapshot of the ZoolGo platform as of **November 2026**.

---

## 1. Verified Completed Milestones

### Backend Completed Milestones
1. **Stage 1 (Admin Identity & RBAC Foundation):** Phone OTP login, access JWTs, HttpOnly refresh cookies, token rotation, reuse detection, dynamic custom roles, fixed 32-permission catalog, Super Admin protections, and Redis-backed authorization invalidation.
2. **Stage 2 (Broker Office Vertical):** Multi-employee broker office identity (`BrokerOffice`, `BrokerEmployee`), prepaid agency wallet, carrier assignments, trip search, manual and auto seat holds, atomic booking confirmation with immediate wallet debit, commission accruals, and cancellation refunds.
3. **Stage 2.6 (M1 Policy Locks & Hardening):** Strict conversion of all financial calculations to minor units (`amountMinor`, `balanceMinor`), office IANA timezone exposure bounds, ticket dispatch restrictions (`DOWNLOAD` only; WhatsApp/SMS disabled), manual top-up receipt upload and review queue (`MANUAL_FALLBACK`), and DRAFT/FINALIZED commission settlement period records.
4. **Milestone A (P0 Admin Core Gaps - Delivered):** Cross-office wallet list (`GET /admin/wallets`), admin vector ticket PDF download (`GET /admin/bookings/:id/tickets/:ticketId/pdf`), settlement review of reserved accrual line items (`GET /admin/commissions/settlements/:id`), and carrier inspection and status modification (`GET/PATCH /carriers/:id`).
5. **Milestone B (P1 Admin Workflows - Delivered):** Admin trip detail inspection (`GET /catalog/trips/:id`), database-level audit query filters (`GET /audit-logs`), central admin management of broker office staff (`POST/PATCH /brokers/:id/staff`), booking search by ticket number or reference (`GET /admin/bookings?q=...`), target-admin session revocation (`POST /admins/:id/sessions/revoke-all`), admin profile update (`PATCH /admins/:id`), and carrier search (`GET /carriers?q=...`).

### Frontend Delivery State
- **Admin Dashboard (`zool-go-dashpoard`):** 30 fully styled pages, responsive sidebar/topbar shell, Cairo Arabic typography, tactile buttons, thermal ticket printing preview, Leaflet map, and Recharts charts.
- **Integration State:** **0% integrated with backend**. The frontend functions as a self-contained in-memory prototype using 11 mock services and fixtures.

---

## 2. Domain-by-Domain Status Matrix

| Domain | Backend Status | Admin Frontend Status | Integration Status | Automated Tests | Remaining Work Classification |
|---|---|---|---|---|---|
| **Admin Auth** | **IMPLEMENTED** | **MISSING** (No login page) | Not integrated | 15 backend tests | `ENGINEERING GAP` (Build login page) |
| **Admin RBAC** | **IMPLEMENTED** | **MOCKED** (Fixtures in `adminService.ts`) | Not integrated | Backend passing | `CONTRACT MISMATCH` (Wire UI to `/api/v1/roles`) |
| **Broker Offices** | **IMPLEMENTED** | **MOCKED** (`brokerService.ts`) | Not integrated | Backend passing | `CONTRACT MISMATCH` (Wire UI to `/api/v1/brokers`) |
| **Broker Staff** | **IMPLEMENTED** | **MOCKED** (`brokerService.ts`) | Not integrated | Backend passing | `CONTRACT MISMATCH` (Wire staff modals) |
| **Carriers** | **IMPLEMENTED** | **MOCKED** (`carrierService.ts`) | Not integrated | Backend passing | `CONTRACT MISMATCH` (Wire UI to `/api/v1/carriers`) |
| **Catalog & Seats** | **IMPLEMENTED** | **MOCKED** (`carrierService.ts`) | Not integrated | Backend passing | `CONTRACT MISMATCH` (Wire trip modals) |
| **Bookings & Tickets**| **IMPLEMENTED** | **MOCKED** (`bookingService.ts`) | Not integrated | Backend passing | `CONTRACT MISMATCH` (Wire booking tables) |
| **Wallets & Top-Ups** | **IMPLEMENTED** | **MOCKED** (`financialService.ts`) | Not integrated | Backend passing | `CONTRACT MISMATCH` (Wire top-up queue) |
| **Commissions** | **IMPLEMENTED** | **MOCKED** (`settlementService.ts`) | Not integrated | Backend passing | `CONTRACT MISMATCH` (Wire settlement tables) |
| **Audit Logs** | **IMPLEMENTED** | **MOCKED** (`adminService.ts`) | Not integrated | Backend passing | `CONTRACT MISMATCH` (Wire audit table) |
| **Overview KPIs** | **PARTIAL** (No admin aggregate) | **MOCKED** (`overviewService.ts`) | Not integrated | Frontend passing | `ENGINEERING GAP` (Milestone C: REQ-ADM-10) |
| **Reports** | **PARTIAL** (Broker reports only)| **MOCKED** (`reportsService.ts`) | Not integrated | Frontend passing | `ENGINEERING GAP` (Milestone C: REQ-ADM-09) |
| **CSV Exports** | **NONE** (Client fixtures) | **MOCKED** (Downloads dummy CSV) | Not integrated | None | `ENGINEERING GAP` (Milestone C: REQ-ADM-14) |
| **Fleet Tracking** | **NONE** (`D-GPS-01` OPEN) | **MOCKED** (`telemetrySimulator.ts`) | Not integrated | Simulator tests | `PRODUCT DECISION` / `DEFERRED` |
| **Travelers / CRM** | **NONE** (Out of M1 scope) | **MOCKED** (`travelerService.ts`) | Not integrated | None | `DEFERRED` (Direct Customer Vertical) |
| **Refunds Queue** | **OUT OF SCOPE** (No admin queue)| **MOCKED** (`refundService.ts`) | Not integrated | None | `MOCK TO BE REMOVED` |
| **General Ledger** | **NONE** (`D-ACC-01` deferred) | **MOCKED** (`financialService.ts`) | Not integrated | None | `DEFERRED` (Full GL out of M1) |
| **System Settings** | **PARTIAL** (Config via .env) | **MOCKED** (`settingsService.ts`) | Not integrated | None | `PRODUCT DECISION` (No runtime DB table) |
| **Notifications** | **NONE** (No product spec) | **MOCKED** (Static topbar dropdown) | Not integrated | None | `PRODUCT DECISION` |
| **External Providers**| **MOCKED** (`PAYMENT_PROVIDER=mock`) | **N/A** | Not integrated | None | `EXTERNAL PROVIDER DEPENDENCY` (Real PSP) |

---

## 3. Quantitative Coverage Metrics

From the comprehensive 222-action inventory documented in `docs/ADMIN_DASHBOARD_ROUTE_AND_ACTION_MATRIX.md`:

- **Total inventoried UI interactions:** **222 rows**
- **Complete backend coverage:** **30 rows (13.5%)**
- **Complete + Contract Mismatch (Ready with adapters):** **59 rows (26.6%)**
- **Any backend surface (Complete + Mismatch + Partial):** **91 rows (41.0%)**
- **Product Decisions Required (Unapproved proposals):** **65 rows (29.3%)**
- **Pure UI Interactions (Tabs, modals, client navigation):** **13 rows (5.9%)**
- **Development-Only Fixtures (Persona alerts, static dates):** **6 rows (2.7%)**
- **Explicitly Out of Scope for M1:** **16 rows (7.2%)**

---

## 4. Categorized Technical Gaps

### 4.1. Engineering Gaps (Approved Scope, Code Required)
1. ~~**Admin Phone Change Security Hardening**~~ — **DONE 2026-11-21** (sessions revoked, `authzVersion` bumped, pending login OTPs expired; test updated).
1a. ~~**Split migration folders**~~ — **DONE 2026-11-21**: merged into `prisma/schema/migrations/` (5 migrations); CI checks fresh deploy + no drift.
1b. **Test DB safety** — **DONE 2026-11-21**: `.env.test.example` added; `tests/setup.ts` refuses to run when the DB name lacks `test` (previously, without `.env.test`, the suite would truncate the dev DB).
2. **Frontend Authentication Shell:** Build a dedicated `/login` route with phone input and 6-digit OTP verification; persist JWT in memory and configure an Axios/Fetch interceptor.
3. **Milestone C Backend APIs:**
   - `REQ-ADM-09`: Admin reporting summary across carriers and offices (`GET /admin/reports/summary`).
   - `REQ-ADM-10`: Overview KPI aggregate snapshot (`GET /admin/overview/kpis`).
   - `REQ-ADM-14`: Synchronous CSV export endpoints for bookings, offices, and settlements.

### 4.2. Contract Mismatches (Frontend Adapter Layer Required)
1. **Minor Units Conversion:** Frontend expects major SDG floats; backend sends/receives integer minor units (`amountMinor`).
2. **Entity ID Names:** Frontend uses `brokerId` and `carrierId`; backend uses `officeId` and `companyId`.
3. **Enum Normalization:** Frontend uses lowercase statuses (`"confirmed"`, `"draft"`); backend enforces uppercase Prisma enums (`"CONFIRMED"`, `"DRAFT"`).

### 4.3. Product Decisions Required (PO Resolution Needed)
1. **`D-GPS-01` (Fleet Tracking Protocol):** Determine whether ZoolGo will ingest GPS from physical OBD trackers, driver mobile phones, or third-party fleet software.
2. **`D-SUS-01` (Suspension Policy Details):** Determine policy on confirmed future passenger bookings when an entire transport company is suspended.
3. **System Settings Table:** Decide whether runtime configuration (maintenance mode, IP allowlists) should move from `.env` to a dynamic database settings model.

### 4.4. External Provider Dependencies
1. **Sudanese Payment Provider (PSP):** Selection and contract execution with a Sudanese payment gateway (e.g., Bank of Khartoum / Bankak, Faisal Islamic Bank / Fawry, or SyberPay) to implement a production `PaymentProvider` adapter.
2. **SMS Gateway:** Integration with Sudanese telecom providers (Zain, MTN, Sudani) for production OTP delivery.

### 4.5. Production Hardening
1. **Source Control:** Active repos since 2026-11-21: `https://github.com/Abnaa-Syria/zool-backend` (this repo) and `https://github.com/Abnaa-Syria/zool-dashboard`. The former `QeemaTech/zool_BE` and `QeemaTech/zool_dashboard` are kept only as a `legacy` remote. Remaining: branch protection rules on `main`.
2. **Object Storage:** Migrate local receipt storage from `./uploads/receipts/` to an S3-compatible private object store (e.g., Cloudflare R2, MinIO, AWS S3).
3. **CI/CD Pipeline:** CI added 2026-11-21 (`zool_BE/.github/workflows/backend-ci.yml`, `zool_dashboard/.github/workflows/ci.yml`). Remaining: CD / container builds.

---

*Evidence citations:*
- Gap audit counts: `d:\zool-go\docs\ADMIN_DASHBOARD_BACKEND_GAP_AUDIT.md` L21–31
- Route matrix: `d:\zool-go\docs\ADMIN_DASHBOARD_ROUTE_AND_ACTION_MATRIX.md` L13–28
- Milestone A & B verification: `d:\zool-go\zool-go-backend\tests\milestone-a-admin.test.ts`, `milestone-b-admin.test.ts`
