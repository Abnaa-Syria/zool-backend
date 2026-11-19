# ZoolGo — API and Frontend Coverage

This document provides a technical specification of the REST API contracts exposed by `zool-go-backend` and maps them against the Admin Dashboard pages in `zool-go-dashpoard`.

---

## 1. API Protocol and Conventions

- **Base URL:** `http://127.0.0.1:4000/api/v1` (configured via `PORT` and `API_PREFIX` in `.env`).
- **Documentation:**
  - Interactive Swagger UI: `http://127.0.0.1:4000/docs`
  - OpenAPI 3.0 Specification: `http://127.0.0.1:4000/docs.json` (or `docs/openapi.yaml`).
- **Authentication & Headers:**
  - Authenticated requests must include the header: `Authorization: Bearer <access_jwt>`.
  - All responses include `X-Request-Id: <uuid>` for distributed tracing.
- **Cookie Security:**
  - Central Admin refresh tokens: `zoolgo_refresh` cookie (`Path=/api/v1/auth`, `HttpOnly`, `SameSite=Lax`).
  - Broker Employee refresh tokens: `zoolgo_broker_refresh` cookie (`Path=/api/v1/broker/auth`, `HttpOnly`, `SameSite=Lax`).
- **Binary Response Exceptions:**
  - Bus Ticket PDF: `GET /api/v1/admin/bookings/:id/tickets/:ticketId/pdf` returns `application/pdf`.
  - Receipt Evidence: `GET /api/v1/admin/wallets/top-ups/:id/evidence` streams binary file bytes with original MIME type.
- **Date/Time Standard:** All timestamps in JSON request bodies and response envelopes use **ISO 8601 strings in UTC** (`YYYY-MM-DDTHH:mm:ss.sssZ`).
- **Financial Standard:** All monetary amounts are integer **minor units** in Sudanese Pounds (**SDG**). Examples:
  - 10,000 SDG = `1000000` minor units.
  - Fields: `amountMinor`, `balanceMinor`, `fareAmountMinor`, `commissionAmountMinor`.

---

## 2. Complete Backend Endpoint Inventory (81 Routes)

Mounted in `src/app.ts` across 17 module routers:

### 2.1. Authentication Subsystem (Admin Principal)
| Method | Path | Principal | Permission | Description | Status |
|---|---|---|---|---|---|
| `POST` | `/api/v1/auth/otp/request` | Public | None | Request 6-digit login OTP | **COMPLETE** |
| `POST` | `/api/v1/auth/otp/verify` | Public | None | Verify OTP; receive JWT & refresh cookie | **COMPLETE** |
| `POST` | `/api/v1/auth/refresh` | Cookie | None | Rotate refresh cookie; receive new JWT | **COMPLETE** |
| `POST` | `/api/v1/auth/logout` | Cookie | None | Revoke active session & clear cookie | **COMPLETE** |
| `POST` | `/api/v1/auth/logout-all` | Bearer | Authenticated | Revoke all sessions & bump authzVersion | **COMPLETE** |
| `GET` | `/api/v1/auth/me` | Bearer | Authenticated | Retrieve current admin profile & permissions | **COMPLETE** |
| `POST` | `/api/v1/auth/phone/otp/request` | Bearer | Authenticated | Request OTP on new phone for self-service | **COMPLETE** |
| `POST` | `/api/v1/auth/phone/otp/verify` | Bearer | Authenticated | Verify OTP on new phone & update identity | **COMPLETE** |

### 2.2. Administrator Management & RBAC
| Method | Path | Principal | Permission | Description | Status |
|---|---|---|---|---|---|
| `GET` | `/api/v1/admins` | Bearer | `admins.view` | Paginated list of administrators | **COMPLETE** |
| `POST` | `/api/v1/admins` | Bearer | `admins.create` | Provision new administrator & assign roles | **COMPLETE** |
| `GET` | `/api/v1/admins/:id` | Bearer | `admins.view` | Retrieve administrator details | **COMPLETE** |
| `PATCH`| `/api/v1/admins/:id/status` | Bearer | `admins.suspend` | Suspend or activate administrator | **COMPLETE** |
| `PATCH`| `/api/v1/admins/:id` | Bearer | `admins.update` | Update admin profile (displayName) | **COMPLETE** |
| `PUT` | `/api/v1/admins/:id/roles` | Bearer | `roles.assign` | Replace assigned roles for administrator | **COMPLETE** |
| `POST` | `/api/v1/admins/:id/sessions/revoke-all` | Bearer | `sessions.revoke` | Administrative revocation of all sessions | **COMPLETE** |
| `GET` | `/api/v1/roles` | Bearer | `roles.view` | List all system and custom roles | **COMPLETE** |
| `POST` | `/api/v1/roles` | Bearer | `roles.create` | Create a new custom administrative role | **COMPLETE** |
| `GET` | `/api/v1/roles/:id` | Bearer | `roles.view` | Retrieve role details and permissions | **COMPLETE** |
| `PATCH`| `/api/v1/roles/:id` | Bearer | `roles.update` | Update role name or description | **COMPLETE** |
| `PUT` | `/api/v1/roles/:id/permissions` | Bearer | `permissions.assign` | Replace permissions assigned to role | **COMPLETE** |
| `DELETE`| `/api/v1/roles/:id` | Bearer | `roles.delete` | Delete a non-system custom role | **COMPLETE** |
| `GET` | `/api/v1/permissions` | Bearer | `permissions.view` | Retrieve complete 32-permission catalog | **COMPLETE** |
| `GET` | `/api/v1/sessions` | Bearer | `sessions.view` | List active server-side refresh sessions | **COMPLETE** |
| `DELETE`| `/api/v1/sessions/:id` | Bearer | `sessions.revoke` | Administratively revoke single session | **COMPLETE** |
| `GET` | `/api/v1/audit-logs` | Bearer | `audit.view` | Multi-filter query over audit records | **COMPLETE** |

### 2.3. Transport Carriers & Catalog (Admin Principal)
| Method | Path | Principal | Permission | Description | Status |
|---|---|---|---|---|---|
| `GET` | `/api/v1/carriers` | Bearer | `carriers.view` | List bus companies (with `q` search) | **COMPLETE** |
| `POST` | `/api/v1/carriers` | Bearer | `carriers.manage` | Register a new transport company | **COMPLETE** |
| `GET` | `/api/v1/carriers/:id` | Bearer | `carriers.view` | Retrieve carrier details and status | **COMPLETE** |
| `PATCH`| `/api/v1/carriers/:id` | Bearer | `carriers.manage` | Update carrier name or active status | **COMPLETE** |
| `POST` | `/api/v1/catalog/trips` | Bearer | `catalog.manage` | Schedule a new bus trip with seat array | **COMPLETE** |
| `GET` | `/api/v1/catalog/trips` | Bearer | `catalog.view` | Admin trip list with companyId filter | **COMPLETE** |
| `GET` | `/api/v1/catalog/trips/:id` | Bearer | `catalog.view` | Admin trip detail and seat status map | **COMPLETE** |
| `PATCH`| `/api/v1/catalog/trips/:id` | Bearer | `catalog.manage` | Update trip schedule or price | **COMPLETE** |
| `POST` | `/api/v1/catalog/trips/:id/seats` | Bearer | `catalog.manage` | Append additional seats to an active trip | **COMPLETE** |

### 2.4. Broker Offices & Staff (Admin Principal)
| Method | Path | Principal | Permission | Description | Status |
|---|---|---|---|---|---|
| `GET` | `/api/v1/brokers` | Bearer | `brokers.view` | List broker offices with search & status | **COMPLETE** |
| `POST` | `/api/v1/brokers` | Bearer | `brokers.manage` | Create broker office & open prepaid wallet | **COMPLETE** |
| `GET` | `/api/v1/brokers/:id` | Bearer | `brokers.view` | Retrieve office details and policies | **COMPLETE** |
| `PUT` | `/api/v1/brokers/:id/carriers` | Bearer | `brokers.manage` | Replace assigned carriers and rates | **COMPLETE** |
| `PATCH`| `/api/v1/brokers/:id/status` | Bearer | `brokers.manage` | Suspend or activate a broker office | **COMPLETE** |
| `PATCH`| `/api/v1/brokers/:id` | Bearer | `brokers.manage` | Update office policy (exposure/timezone) | **COMPLETE** |
| `POST` | `/api/v1/brokers/:id/staff` | Bearer | `brokers.manage` | Admin creates staff for broker office | **COMPLETE** |
| `PATCH`| `/api/v1/brokers/:id/staff/:empId` | Bearer | `brokers.manage` | Admin updates broker staff permissions | **COMPLETE** |

### 2.5. Wallets, Top-Ups & Financials (Admin Principal)
| Method | Path | Principal | Permission | Description | Status |
|---|---|---|---|---|---|
| `GET` | `/api/v1/admin/wallets` | Bearer | `wallets.view` | Cross-office wallet list with low-balance filter | **COMPLETE** |
| `GET` | `/api/v1/admin/wallets/:id` | Bearer | `wallets.view` | Office wallet balance and ledger entries | **COMPLETE** |
| `GET` | `/api/v1/admin/wallets/top-ups` | Bearer | `wallets.topups.view` | List top-up review queue | **COMPLETE** |
| `POST` | `/api/v1/admin/wallets/:id/top-ups` | Bearer | `wallets.topups.create_for_office` | Upload receipt on behalf of broker | **COMPLETE** |
| `POST` | `/api/v1/admin/wallets/top-ups/:id/approve` | Bearer | `wallets.topups.approve` | Approve top-up & credit agency wallet | **COMPLETE** |
| `POST` | `/api/v1/admin/wallets/top-ups/:id/reject` | Bearer | `wallets.topups.reject` | Reject top-up intent with reason | **COMPLETE** |
| `GET` | `/api/v1/admin/wallets/top-ups/:id/evidence` | Bearer | `wallets.topups.evidence.view` | Download uploaded deposit receipt file | **COMPLETE** |
| `GET` | `/api/v1/admin/commissions/accruals` | Bearer | `commissions.view` | View broker sales commission accruals | **COMPLETE** |
| `POST` | `/api/v1/admin/commissions/settlements` | Bearer | `commissions.payout` | Draft commission settlement (reserves lines) | **COMPLETE** |
| `GET` | `/api/v1/admin/commissions/settlements` | Bearer | `commissions.view` | List periodic commission settlements | **COMPLETE** |
| `GET` | `/api/v1/admin/commissions/settlements/:id` | Bearer | `commissions.view` | Settlement details + linked accrual lines | **COMPLETE** |
| `POST` | `/api/v1/admin/commissions/settlements/:id/finalize` | Bearer | `commissions.payout` | Finalize payout with payment reference | **COMPLETE** |
| `POST` | `/api/v1/admin/commissions/settlements/:id/cancel` | Bearer | `commissions.payout` | Cancel draft & release reserved accruals | **COMPLETE** |

### 2.6. Bookings & Tickets (Admin Principal)
| Method | Path | Principal | Permission | Description | Status |
|---|---|---|---|---|---|
| `GET` | `/api/v1/admin/bookings` | Bearer | `bookings.view` | Search & list bookings across offices (`q`) | **COMPLETE** |
| `GET` | `/api/v1/admin/bookings/:id` | Bearer | `bookings.view` | Inspect full booking and passenger lines | **COMPLETE** |
| `POST` | `/api/v1/admin/bookings/:id/cancel` | Bearer | `bookings.cancel` | Admin cancels booking with required reason | **COMPLETE** |
| `GET` | `/api/v1/admin/bookings/:id/tickets/:tId/pdf` | Bearer | `bookings.view` | Download vector PDF ticket | **COMPLETE** |

### 2.7. Broker Principal Subsystem (`/api/v1/broker/*`)
| Method | Path | Principal | Permission | Description | Status |
|---|---|---|---|---|---|
| `POST` | `/api/v1/broker/auth/otp/request` | Public | None | Broker clerk/manager login OTP request | **COMPLETE** |
| `POST` | `/api/v1/broker/auth/otp/verify` | Public | None | Broker OTP verification (sets broker cookie) | **COMPLETE** |
| `POST` | `/api/v1/broker/auth/refresh` | Cookie | None | Refresh broker access token | **COMPLETE** |
| `POST` | `/api/v1/broker/auth/logout` | Cookie | None | Broker logout | **COMPLETE** |
| `GET` | `/api/v1/broker/auth/me` | Broker | Authenticated | Retrieve current broker clerk profile | **COMPLETE** |
| `GET` | `/api/v1/broker/staff` | Broker | `broker.staff.manage` | List office staff members | **COMPLETE** |
| `POST` | `/api/v1/broker/staff` | Broker | `broker.staff.manage` | Self-service create clerk | **COMPLETE** |
| `PATCH`| `/api/v1/broker/staff/:id` | Broker | `broker.staff.manage` | Update clerk capability flags | **COMPLETE** |
| `GET` | `/api/v1/broker/carriers` | Broker | `broker.book` | List carriers assigned to this office | **COMPLETE** |
| `GET` | `/api/v1/broker/trips` | Broker | `broker.book` | Search available trips on assigned carriers | **COMPLETE** |
| `POST` | `/api/v1/broker/trips/:id/holds` | Broker | `broker.book` | Hold seats (MANUAL or AUTO) for 15 mins | **COMPLETE** |
| `DELETE`| `/api/v1/broker/holds/:token` | Broker | `broker.book` | Manually release active seat hold | **COMPLETE** |
| `POST` | `/api/v1/broker/bookings/quote` | Broker | `broker.book` | Calculate price and expected commission | **COMPLETE** |
| `POST` | `/api/v1/broker/bookings/confirm` | Broker | `broker.book` | Confirm booking; atomic wallet debit | **COMPLETE** |
| `GET` | `/api/v1/broker/bookings` | Broker | `broker.book` | List office booking history | **COMPLETE** |
| `GET` | `/api/v1/broker/bookings/:id` | Broker | `broker.book` | Retrieve booking details | **COMPLETE** |
| `POST` | `/api/v1/broker/bookings/:id/cancel` | Broker | `broker.book` | Cancel booking; refund wallet; clawback | **COMPLETE** |
| `GET` | `/api/v1/broker/bookings/:id/tickets/:tId/pdf` | Broker | `broker.book` | Download ticket PDF for passenger | **COMPLETE** |
| `POST` | `/api/v1/broker/bookings/:id/dispatch` | Broker | `broker.book` | Dispatch ticket (DOWNLOAD allowed; SMS disabled) | **COMPLETE** |
| `GET` | `/api/v1/broker/wallet` | Broker | `broker.book` | Get prepaid wallet balance | **COMPLETE** |
| `GET` | `/api/v1/broker/wallet/ledger` | Broker | `broker.book` | View immutable wallet ledger entries | **COMPLETE** |
| `POST` | `/api/v1/broker/wallet/top-ups` | Broker | `broker.wallet.topup` | Initiate wallet top-up intent | **COMPLETE** |
| `POST` | `/api/v1/broker/wallet/top-ups/:id/evidence` | Broker | `broker.wallet.topup` | Attach bank transfer receipt image | **COMPLETE** |
| `GET` | `/api/v1/broker/commissions/accruals` | Broker | `broker.reports.view` | View earned commission records | **COMPLETE** |
| `GET` | `/api/v1/broker/reports/summary` | Broker | `broker.reports.view` | Office sales and commission summary | **COMPLETE** |

### 2.8. Infrastructure, Webhooks & Health
| Method | Path | Principal | Permission | Description | Status |
|---|---|---|---|---|---|
| `GET` | `/api/v1/health` | Public | None | Liveness check | **COMPLETE** |
| `GET` | `/api/v1/ready` | Public | None | Readiness check (validates MySQL & Redis) | **COMPLETE** |
| `POST` | `/api/v1/payments/webhooks/:provider` | Webhook | Signature | Raw-body signed PSP webhook ingestion | **COMPLETE** |
| `POST` | `/api/v1/payments/mock/confirm` | Dev Only | Non-Prod | Mock payment confirmation (non-prod only) | **COMPLETE** |

---

## 3. Contract Mappings (Frontend ↔ Backend)

When integrating `zool-go-dashpoard` with `zool-go-backend`, the frontend adapter layer must translate these naming and data structure differences:

| Concept | Frontend Mock Usage | Backend Contract | Adapter Rule |
|---|---|---|---|
| **Office Identifier** | `brokerId: "BRK-001"` | `officeId: "uuid..."` | Map `brokerId` -> `officeId` |
| **Carrier Identifier**| `carrierId: "CAR-001"` | `companyId: "uuid..."` | Map `carrierId` -> `companyId` |
| **Monetary Units** | Floating-point SDG: `15000.00` | Integer Minor Units: `1500000` | Multiply by 100 on send; divide by 100 on render |
| **Booking Status** | Lowercase: `"confirmed"`, `"cancelled"` | Uppercase Enum: `"CONFIRMED"`, `"CANCELLED"` | `status.toUpperCase()` |
| **Settlement Status**| Proposes `"pending_approval"` | Backend Enum: `"DRAFT"`, `"FINALIZED"` | Map `"pending_approval"` -> `"DRAFT"` |
| **Pagination** | Array of items directly returned | Wrapped in `{ data: [...], meta: { total, page } }` | Extract `response.data.data` and `response.data.meta` |
| **Receipt Deposit** | Calls `recordTopUp(amount)` directly | Requires intent creation + evidence upload | Trigger 2-step intent + evidence multipart flow |

---

## 4. Integration Readiness Categorization

- **Ready to Integrate Immediately (Milestone F):**
  - Admin OTP login, `/auth/me`, logout, session revocation.
  - Team management, custom roles, permission assignments.
  - Broker offices list, creation, status, and policy updates.
  - Cross-office wallet list and per-office ledger inspection.
  - Manual top-up review queue: list, evidence download, approve, reject.
  - Bookings search, details inspection, admin cancellation, and ticket PDF download.
  - Carrier registry, status toggles, and broker carrier assignments.
  - Commission accruals list, settlement drafting, cancellation, and finalization.
  - Audit trail queries.
- **Backend Partial (Blocked on Milestone C):**
  - `/overview` dashboard KPIs (needs REQ-ADM-10 admin aggregate endpoint).
  - `/reports` executive summaries (needs REQ-ADM-09 cross-carrier reporting endpoint).
  - Synchronous CSV downloads (needs REQ-ADM-14 sync export endpoint).
- **Frontend Mocks to be Removed (Proposals with No Backend Authority):**
  - `/refunds/queue`, `/refunds/policies`, `/refunds/disputes/:id` (Broker cancels refund directly to the wallet; no customer refund dispute queue exists in M1 under `D-REF-01`).
  - `/financials/ledger`, `/reports/trial-balance` (Full general ledger accounting is deferred under `D-ACC-01`).
  - `/reports/carrier-shares` (Carrier revenue settlement is out of scope under `D-REV-01`).
  - `/tracking` & `/tracking/vehicles/:id` (Fleet GPS tracking is blocked on open decision `D-GPS-01`).

---

*Evidence citations:*
- Mounted routes: `d:\zool-go\zool-go-backend\src\app.ts` L52–112
- Route matrix: `d:\zool-go\docs\ADMIN_DASHBOARD_ROUTE_AND_ACTION_MATRIX.md`
- Gap audit: `d:\zool-go\docs\ADMIN_DASHBOARD_BACKEND_GAP_AUDIT.md`
