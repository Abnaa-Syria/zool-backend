# Admin Dashboard → Backend Gap Audit

Read-only audit of `zool-go-dashpoard` against `zool-go-backend` (Stage 1, Stage 2, Stage 2.6). No source, Prisma, or mock was changed.

**Clarification (2026-10-23, Milestone A):** D-TOP-01 still locks automatic provider confirmation as the PDF architectural path. For **current M1 production**, MANUAL receipt review is the **enabled and usable** top-up path until a real payment provider is selected. Automatic remains supported architecturally; mock confirm is non-production only. Both paths share the same idempotent wallet credit. This does not change the original finding that Stitch queue-as-normal is SUPERSEDED.

**Companion documents**

- [`ADMIN_DASHBOARD_ROUTE_AND_ACTION_MATRIX.md`](ADMIN_DASHBOARD_ROUTE_AND_ACTION_MATRIX.md) — 222 interaction rows
- [`ADMIN_DASHBOARD_API_REQUIREMENTS.md`](ADMIN_DASHBOARD_API_REQUIREMENTS.md) — approved missing APIs only
- [`ADMIN_BACKEND_COMPLETION_ROADMAP.md`](ADMIN_BACKEND_COMPLETION_ROADMAP.md) — P0–P3 then frontend last

**Authority order used:** `BACKEND_DECISION_REGISTER.md` → implemented Stage 1/2/2.6 contracts → `Zool/ZoolGo_Broker_Journey.pdf` → `BACKEND_REQUIREMENTS.md` → `REQUIREMENTS_AND_DECISIONS.md` → implemented admin frontend → Stitch / fixtures as proposals.

---

## 1. Executive verified state

The Admin Dashboard is a **30-page in-memory React application**. It does not call `/api/v1`. There is **no login route**. Persona, notifications, nav badges, and money values are fixtures. The backend **does** implement a complete broker-office vertical plus admin OTP/RBAC.

### How much of the Admin Dashboard has real backend support?

Derived from matrix **data rows** (Coverage column), not intuition.

| Denominator | Formula | COMPLETE | COMPLETE + CONTRACT_MISMATCH | Any backend surface (those + PARTIAL) |
|---|---|---|---|---|
| All inventoried actions | 30 / 222 | **13.5%** | 59 / 222 = **26.6%** | 91 / 222 = **41.0%** |
| Integration-relevant actions | exclude UI_ONLY (13), DEV_ONLY (6), OUT_OF_SCOPE (16) → **187** | 30 / 187 = **16.0%** | 59 / 187 = **31.6%** | 91 / 187 = **48.7%** |

**Weighting:** every meaningful UI interaction is one row (list ≠ cancel ≠ export). Rows are **not** weighted by revenue. PRODUCT_DECISION_REQUIRED (65) is **not** counted as missing engineering.

### Which sections can be integrated now?

After a frontend adapter (`*Minor`, enum case, id names) **and** a login shell:

| Section | Why |
|---|---|
| Admin OTP login, `/auth/me`, logout, logout-all (self) | Stage 1; dashboard has no login page yet (frontend gap) |
| Admin team freeze/activate | `PATCH /admins/:id/status` |
| Roles, permission catalog, assign permissions, assign roles | Stage 1 routes; fixture keys must map to `PERMISSION_CATALOG` |
| Session revoke (single) | `DELETE /sessions/:id` |
| Broker offices list/get/create, status, policy, carrier assignment | Stage 2 |
| Per-office wallet + ledger | `GET /admin/wallets/:officeId` |
| Top-up review: list, approve, reject, evidence, create-for-office | Stage 2.6; **M1 production enabled path is MANUAL** until a real PSP (D-TOP-01 clarification 2026-10-23). Automatic remains architectural; mock confirm is non-production. UI must not treat Stitch queue-as-normal as policy. |
| Bookings list/get; admin cancel | Stage 2.6; UI currently has **no cancel call** |
| Commission accruals; settlement draft / finalize / cancel | Stage 2.6; UI must **not** credit wallets on finalize |
| Audit list (actor + pagination only) | Stage 1 |
| Health / ready | Public; shell pill is hardcoded |

### Which sections require backend work first?

| Section | Why |
|---|---|
| `/financials/wallets` list | No cross-office wallet collection (REQ-ADM-01) |
| Booking ticket PDF | PDF is broker-principal only (REQ-ADM-02) |
| Settlement review of reserved lines | GET settlement omits accrual array (REQ-ADM-03) |
| `/companies/:id` update/status | No GET/PATCH carrier (REQ-ADM-04/05) |
| `/overview` KPIs | No admin aggregate (REQ-ADM-10); fleet KPI is GPS product |
| `/reports` | Broker reports only (REQ-ADM-09) |
| Office employee mutations | Broker-principal staff API only (REQ-ADM-08) |
| Audit filters / booking activity | Query schema too thin (REQ-ADM-07) |
| CSV buttons | Client fixture downloads (REQ-ADM-14) |
| `/tracking*` | No GPS/vehicle backend (D-GPS-01) |
| `/travelers*` | No customer identity backend |
| `/financials/ledger*`, `/reports/trial-balance` | Full GL deferred (D-ACC-01) |
| `/refunds*` | Not the locked broker cancel path (D-REF-01) |
| `/reports/carrier-shares` | D-REV-01 |
| `/admin/settings` mutations | Env/product/dangerous; not a settings table |

**Recommended next backend milestone:** Roadmap **Milestone A (P0)** — wallet list, admin ticket PDF, settlement line items, carrier get/patch. Do not start frontend integration until A lands. Do not implement GPS/GL/travelers/refunds as “gaps”.

---

## 2. Inventory counts

| Item | Count | Source |
|---|---:|---|
| Frontend router entries | 32 | `zool-go-dashpoard/src/app/router/index.tsx` (30 pages + `/` redirect + `*` redirect) |
| **Frontend routes audited (pages)** | **30** | Same file L42–163 |
| Meaningful actions inventoried | **222** | Matrix data rows |
| Mock / in-memory services | 11 + telemetry simulator + overview fetcher | `src/features/*/services/*Service.ts`, `src/services/overviewService.ts`, `telemetrySimulator.ts` |
| HTTP calls from dashboard | **0** | No `fetch`/`axios` API client for `/api/v1` |
| Route guards / permission gates | **0** | All pages render inside `AppShell` with no auth |
| Mounted backend JSON operations | **81** | `zool-go-backend/src/app.ts` L52–111 + route files |
| Admin-principal subset | **50** | auth, admins, roles, permissions, sessions, audit, brokers, carriers, catalog, admin bookings/wallets/commissions, health |
| Permission catalog keys | **31** | `src/shared/constants/permissions.ts` L1–33 |
| `bookings.override` routes | **0** | Catalogued only (`permissions.ts` L32) |
| `admins.update` routes | **0** | Catalogued only (`permissions.ts` L4) |

### Coverage totals (matrix)

| Classification | Count |
|---|---:|
| COMPLETE | 30 |
| PARTIAL | 32 |
| CONTRACT_MISMATCH | 29 |
| MISSING | 31 |
| PRODUCT_DECISION_REQUIRED | 65 |
| UI_ONLY | 13 |
| DEV_ONLY | 6 |
| OUT_OF_SCOPE | 16 |
| **Total** | **222** |

### Coverage by domain (integration-relevant only)

Approximate grouping of the 187 non-UI/DEV/OOS rows:

| Domain | Predominant coverage | Integrate now? |
|---|---|---|
| Shell auth (me/logout/login APIs) | COMPLETE | Yes (frontend login missing) |
| Overview | MISSING / PARTIAL | No (needs REQ-ADM-10; fleet is PDR) |
| Tracking | PRODUCT_DECISION_REQUIRED | No |
| Bookings | CONTRACT_MISMATCH + PARTIAL; cancel COMPLETE | List/get/cancel after adapter; PDF blocked |
| Companies | PARTIAL / MISSING / PDR | List/create only; detail blocked |
| Broker offices | COMPLETE + CONTRACT_MISMATCH | Yes after adapter; exceptional top-up must stay out |
| Travelers | OUT_OF_SCOPE / PDR | No |
| Wallets list | MISSING | No |
| Wallet ledger (per office) | CONTRACT_MISMATCH | Per-office yes; GL no |
| Top-up queue | COMPLETE + CONTRACT_MISMATCH | Yes as **fallback**, not Stitch-normal |
| Settlements | COMPLETE + CONTRACT_MISMATCH | Yes if UI stops crediting wallets; line items blocked |
| Refunds | PRODUCT_DECISION_REQUIRED | No |
| Reports / TB / shares / export jobs | MISSING / PDR / OOS | No (except future REQ-ADM-09) |
| Admin team / roles | COMPLETE + CONTRACT_MISMATCH | Yes for freeze/roles; profile PATCH missing |
| Audit | PARTIAL / MISSING filters | Thin list only |
| Settings | PRODUCT_DECISION_REQUIRED | No runtime settings API |

---

## 3. Frontend inspection notes

### Router (`src/app/router/index.tsx`)

`/overview`, `/tracking`, `/tracking/vehicles/:vehicleId`, `/bookings`, `/bookings/:id`, `/bookings/:id/activity`, `/companies`, `/companies/:id`, `/brokers`, `/brokers/:id`, `/travelers`, `/travelers/:id`, `/financials/wallets`, `/financials/ledger`, `/financials/ledger/:id`, `/financials/topup-queue`, `/financials/settlements`, `/refunds/queue`, `/refunds/policies`, `/refunds/disputes/:ticketId`, `/reports`, `/reports/trial-balance`, `/reports/carrier-shares`, `/reports/export-center`, `/admin/team`, `/admin/team/:id`, `/admin/roles`, `/admin/audit`, `/admin/settings`.

### Mocks (no HTTP, fake latency, in-memory mutation)

| Module | File | Notable mutations / defects |
|---|---|---|
| Overview | `src/services/overviewService.ts` L19–35 | `setTimeout` 350ms / infinite loading; preset fixtures |
| Tracking | `src/features/tracking/services/telemetrySimulator.ts` | `subscribe` L341; client GPS sim |
| Bookings | `bookingService.ts` | Read-only list/get/CSV; **no cancel** |
| Carriers | `carrierService.ts` | `addCarrier`, `assignBrokerToCarrier` does not sync brokers |
| Brokers | `brokerService.ts` | `topUpBrokerWallet` L117 immediate credit (D-ADJ-01) |
| Travelers | `travelerService.ts` | KYC/suspend/notes; suspend does not kill sessions |
| Financials | `financialService.ts` | Three AG-882 stores; `recordTopUp` free credit + fake GL |
| Settlements | `settlementService.ts` | `approveAndDisburseBatch` Bankak; `creditCommissionToBrokerWallet` L118 |
| Refunds | `refundService.ts` | Override does not touch bookings/wallets |
| Reports | `reportsService.ts` | Frozen TB; `triggerReportExport` fake jobs |
| Admin | `adminService.ts` | Invite/freeze/sessions in memory; 2FA metrics `Math.max(..., 7)` |
| Settings | `settingsService.ts` | Isolated form; `testGatewayConnection` always succeeds |

**localStorage / sessionStorage:** not used as a persistence layer for domain data (search is React state). Logout is `alert` (`Topbar.tsx` L149–155).

Loading / empty / error on overview are **UI states**. Backend should produce: in-flight HTTP → loading; empty aggregates → empty; 5xx envelope → error. They are not separate modules.

---

## 4. Backend inspection notes

### Mount (`src/app.ts`)

Prefix `/api/v1`. Webhook raw-body at `/payments/webhooks` (L52–72). Admin mounts: `/brokers`, `/carriers`, `/catalog`, `/admin/bookings`, `/admin/wallets`, `/admin/commissions` (L105–111). Swagger `/docs` if `docs/openapi.yaml` loads.

### Prisma entities that exist (M1)

`AdminUser`, roles/permissions/sessions, `AuditLog`, `BrokerOffice` (+ TZ/overrides), `BrokerEmployee`, `Wallet` + `WalletLedgerEntry`, `TopUpIntent` + `TopUpEvidence`, `TransportCompany`, `BrokerCarrierAssignment`, `Trip` + `TripSeat` + `SeatHold`, `Booking` + passengers + tickets, `CommissionAccrual` + `CommissionSettlement`.

**No** Vehicle, Driver, Route (named), Customer/Traveler, Notification, Journal, Dispute, GpsPing models.

### Redis

Authz version cache (admin + broker); OTP/session support as Stage 1. **No** latest-position cache.

### Jobs / GPS / notifications / global search

None in production `src/` for those products. Hold expiry is evaluated on use (Stage 2 tests), not a GPS loop.

---

## 5. Mock versus real

| UI pretends | Backend truth |
|---|---|
| Always logged-in Super Admin | OTP + cookie + `/auth/me` |
| Major-unit SDG floats (`*Sdg`, `amount`) | Integer `*Minor` + `currency: SDG` |
| Booking `pending/on_route/completed` | `CONFIRMED` \| `CANCELLED` |
| Direct-customer bookings | Broker-office bookings only |
| Receipt queue as **normal** top-up | Stitch queue-as-normal is SUPERSEDED. PDF architectural path is automatic after a real PSP. **Current M1 production usable path is MANUAL receipt review** until then (D-TOP-01 clarification 2026-10-23). Mock confirm is non-production only. |
| Exceptional admin deposit | D-ADJ-01 out of scope |
| Settlement finalize credits wallet / Bankak file | Finalize records `payoutReference`; **does not** touch wallet |
| Carrier payouts | D-REV-01 out of scope |
| Refund % tiers / disputes | Broker cancel → wallet refund + clawback; no queue |
| Trial balance | D-ACC-01 deferred |
| Live GPS | Simulator only |
| Traveler CRM | Passenger PII on booking only |
| Settings save changes platform policy | Env + office overrides; WhatsApp/SMS disabled |
| Nav badges / notifications | Hardcoded |
| CSV | Browser Blob of fixtures |

---

## 6. Cross-domain consistency

### Broker top-up (approved)

Intent → (webhook **or** evidence PENDING_REVIEW) → admin approve/reject → wallet CREDIT_TOPUP (`topup:{intentId}`) → ledger → audit.

**Mock split-brain:** `brokerService.topUpBrokerWallet` vs `financialService.approveTopUpRequest` vs queue fixtures vs three AG-882 copies.

### Broker booking (approved)

Trip search (assigned carriers) → hold → passengers → wallet debit → booking+tickets → accrual → seats SOLD. Admin visibility via `GET /admin/bookings`.

Dashboard bookings module is **read-only fixtures** and includes a fake customer channel.

### Cancellation (approved)

Admin/broker cancel (reason on admin) → tickets cancelled → seats FREE → CREDIT_REFUND → commission CLAWED_BACK → audit. Idempotent; does not edit passenger/seat/fare rows (Stage 2.6 tests).

Refund UI **does not** call this and does not update booking fixtures.

### Settlement (approved)

UNSETTLED → DRAFT reserves → CANCEL releases → FINALIZE + `payoutReference` + `lastSettledAt`. Overlapping drafts 409. **No scheduler.**

UI invents Bankak batches and wallet credit (`settlementService.ts` L74, L118) — **contract mismatch / out of scope**, not a missing payout gateway.

### Admin suspension (implemented)

`PATCH /admins/:id/status` SUSPENDED → authz version → subsequent access 403 (Stage 1 tests). Single session revoke exists. Revoke-all for **another** admin is PARTIAL (logout-all is self).

### Broker-office suspension (implemented + OPEN)

Implemented (`brokers.service.ts` L192–194; `authenticate-broker.ts` L36–38):

- Office `SUSPENDED`
- Office sessions revoked
- **Every** broker-principal route unauthorized (including historical read)

Admin can still inspect office, bookings, wallets, settlements.

**OPEN (D-SUS-01):** admin fallback top-up while suspended; cancel of existing bookings; finalize settlement; whether broker read-only history is required. Do not invent those rules in Milestone A.

---

## 7. Permission findings

- Backend routes checked in this audit use `authenticate` + `requirePermission` / `requireAnyPermission` (top-up list).
- Dashboard **never** enforces keys. Screen visibility is not authorization.
- Split top-up keys are correct on the API; the UI is a single queue.
- `bookings.override` must remain unimplemented.
- `admins.update` is an empty catalog key.
- Sensitive evidence has `wallets.topups.evidence.view` — keep it off the generic view key.
- Exports have no permission today (REQ-ADM-14).
- Full permission table: matrix closing section.

---

## 8. Contract mismatches (canonical = backend)

| Frontend | Backend (canonical) |
|---|---|
| `amount`, `*Sdg`, `toFixed(2)` | `amountMinor` / `balanceMinor` integer + `currency: "SDG"` |
| `brokerId` | `officeId` |
| `carrierId` | `companyId` |
| Booking status lowercase mixed | `CONFIRMED` / `CANCELLED` |
| Ticket `issued` | `CONFIRMED` |
| Settlement `pending_approval` | `DRAFT` |
| Admin status `online/restricted/leave` | `ACTIVE` / `SUSPENDED` |
| Company status `under_review` | `ACTIVE` / `SUSPENDED` |
| Passenger `name` | `fullName` |
| Envelope `{ bookings, totalCount }` | `{ success, data, meta: { page, limit, total, totalPages } }` |
| ISO vs Arabic display timestamps | ISO-8601 in JSON; format in UI |
| RBAC fixture action ids | `PERMISSION_CATALOG` keys |

Do not expose token hashes, OTP codes (except guarded `devOtp`), or raw receipt bytes without `evidence.view`.

---

## 9. Product decisions that still block implementation

Genuine blockers — **not** engineering backlog:

1. **Admin Dashboard M1 scope:** broker-vertical ops only vs full Stitch product (GPS, travelers, GL, refunds, carrier settlement, settings).
2. **D-GPS-01** — GPS provider, protocol, ping/stale, retention, WS vs poll.
3. **D-SUS-01** — office suspend effects beyond “block broker API”.
4. **D-AUTH-01** — admin 2FA beyond OTP.
5. **D-ADJ-01** — remains out of scope (UI deposit modal).
6. **D-ACC-01** — GL/trial balance remain deferred.
7. **D-REV-01** — carrier shares remain out of scope.
8. **D-REF-01** — customer/% refund matrix; disputes.
9. **D-PAY-01** — customer Bankak.
10. **D-TICKET-01** — WhatsApp/SMS still disabled; do not add settings toggles.
11. **D-RATE-01** — global % fields non-authoritative.
12. Notification inbox, async export jobs, runtime maintenance mode, IP allowlist, VAT, overbooking.
13. Fixture **88/12 insurance float** (`financialService.ts` L37–40) is not policy.
14. Whether `admins.update` should exist in M1.

---

## 10. Non-functional gaps (tied to UI, not a wish list)

| Topic | Tied to | Status |
|---|---|---|
| Pagination / sort | All tables | JSON lists paginate; several UI sorts are client-only (PARTIAL) |
| Global search | Topbar | MISSING (P2); brokers have `q` |
| Large export jobs | Export center | PRODUCT (sync CSV is REQ-ADM-14) |
| File storage / signed access | Top-up evidence | Implemented for receipts |
| Notifications | Bell | PRODUCT |
| WebSockets | Tracking | PRODUCT D-GPS-01 |
| Scheduled jobs | Auto settlement / backup hour | D-SET-01 no scheduler; settings PDR |
| Idempotency | Top-up, cancel, finalize | Implemented — do not regress |
| Optimistic concurrency | Settlement reserve | 409 implemented |
| Audit | Mutations | Present; list filters incomplete |
| Health/ready | Shell pill | Implemented, unwired |
| Rate limits | OTP | Implemented |
| Metrics / backup / versioning | Settings display | Health + env; not a settings form |

---

## 11. Validation command results

Recorded 2026-10-23 from this workspace. Green checks are **not** production readiness.

### Frontend `d:\zool-go\zool-go-dashpoard`

| Command | Exit | Result |
|---|---|---|
| `npm run lint` | **0** | oxlint warnings only (fast-refresh exports, `set-state-in-effect`, static components in charts). No errors. |
| `npm run test` | **0** | Vitest **13 files, 89 tests passed** (v5.0.5) |
| `npm run build` | **0** | `tsc -b && vite build`; 1330 modules; `dist/assets/index-CElIyAfj.js` 2,426 kB (chunk size warning); built in 2m 29s |

### Backend `d:\zool-go\zool-go-backend`

| Command | Exit | Result |
|---|---|---|
| `npm run lint` | **0** | `eslint src tests --max-warnings 0` clean |
| `npm test` | **0** | Vitest **6 files, 54 tests passed** (auth-rbac 15, stage2-broker 14, http-envelope 11, stage2-policy 7, stage2-hardening 3, http-contract 4) |
| `npm run build` | **0** | `tsc -p tsconfig.build.json` |
| `npx prisma validate` | **0** | `The schemas at prisma\schema are valid` (Prisma 7 config deprecation warning) |
| `npx prisma generate` | **0** | Prisma Client **v6.19.0** generated |

### Stage 2 smoke

| Check | Result |
|---|---|
| Docker Compose | `zoolgo-mysql` healthy (`3308`), `zoolgo-mysql-test` healthy (`3307`), `zoolgo-redis` healthy (`6380`) |
| API `http://127.0.0.1:4000/api/v1/health` | **Not running** (`Unable to connect to the remote server`) |
| `node scripts/smoke-stage2.mjs` | **Not executed** — script requires a live API plus seeded `ZG-BRK-1`; starting/seeding would mutate the shared database. Per audit rules, no replacement script was created. |

---

## 12. Exact source references (index)

| Concern | Path |
|---|---|
| Router | `zool-go-dashpoard/src/app/router/index.tsx` L33–169 |
| Nav badges | `zool-go-dashpoard/src/app/shell/navigationConfig.ts` L15–45 |
| Logout alert | `zool-go-dashpoard/src/app/shell/Topbar.tsx` L149–155 |
| Permission catalog | `zool-go-backend/src/shared/constants/permissions.ts` L1–33 |
| App mounts | `zool-go-backend/src/app.ts` L52–111 |
| Admin bookings | `zool-go-backend/src/modules/bookings/bookings.routes.ts` L72–96 |
| Admin wallets / top-ups | `wallets.routes.ts` L26–36; `payments.routes.ts` L57–97 |
| Settlements | `commissions.routes.ts` L30–75; DTO `commissions.service.ts` L40–59 |
| Office suspend | `brokers.service.ts` L181–207; `authenticate-broker.ts` L33–38 |
| Money DTO | `wallets.service.ts` L14–23, L66–73; `bookings.dto.ts` L18–47 |
| Decisions | `docs/BACKEND_DECISION_REGISTER.md` |
| Booking types (UI) | `zool-go-dashpoard/src/features/bookings/types/booking.ts` L1–7 |

---

## 13. Unresolved questions (logged; not blocking this audit)

- Should `/catalog/trips` GET list already accept `companyId`? Confirm when implementing REQ-ADM-15.
- Should booking `from`/`to` filter `createdAt` or `departureAt`? D-BOOK-01 does not disambiguate date-type toggle.
- Should admin ticket PDF require `bookings.view` or a new `bookings.tickets.download`?
- D-SUS-01 list in API requirements §decision-required.
- Highest-impact product question is in the handoff, not repeated as a blocker for Milestone A.
