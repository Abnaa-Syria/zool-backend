# Admin Dashboard API Requirements

Requirements for **approved** backend capabilities that the Admin Dashboard still lacks. These are contracts, not an implementation.

**Implementation note (2026-10-23, Milestone A):** REQ-ADM-01, REQ-ADM-02, REQ-ADM-04, REQ-ADM-05, and REQ-ADM-06 are implemented in `zool-go-backend`. REQ-ADM-03 ships as settlement **summary** plus paginated `GET /admin/commissions/settlements/:id/accruals` (unbounded embed avoided). Specs below remain the contract.

**Implementation note (2026-10-23, Milestone B):** REQ-ADM-07, REQ-ADM-08, REQ-ADM-11, REQ-ADM-12, REQ-ADM-13, and carrier `q` from REQ-ADM-15 are implemented. Trip `companyId` on `GET /catalog/trips` was already present. Specs below remain the contract.

**Clarification (2026-10-23):** D-TOP-01 — M1 production enabled/usable top-up is MANUAL receipt review until a real PSP is integrated. Automatic remains architectural; mock confirm is non-production only. Manual review is not unavailable and is not backup-only for current M1 operation.

**Out of this file:** unresolved product behavior (see [Decision-required (no endpoint)](#decision-required-no-endpoint)). Do not treat Stitch, fixtures, or mock percentages as authority.

**Canonical money:** integer minor units + explicit `currency: "SDG"`. Never persist JavaScript floats.

**Canonical envelope:** existing `successResponse` / `AppError` (`zool-go-backend/src/shared/http/success-response.ts`).

**Authority:** `docs/BACKEND_DECISION_REGISTER.md` → Stage 1 / 2 / 2.6 implementations → Broker Journey PDF.

Related: [`ADMIN_DASHBOARD_BACKEND_GAP_AUDIT.md`](ADMIN_DASHBOARD_BACKEND_GAP_AUDIT.md) · [`ADMIN_DASHBOARD_ROUTE_AND_ACTION_MATRIX.md`](ADMIN_DASHBOARD_ROUTE_AND_ACTION_MATRIX.md) · [`ADMIN_BACKEND_COMPLETION_ROADMAP.md`](ADMIN_BACKEND_COMPLETION_ROADMAP.md)

---

## Already implemented (do not re-specify)

Use these as-is; dashboard integration is a later frontend milestone.

| Domain | Operations | Evidence |
|---|---|---|
| Admin auth | `POST /auth/otp/request`, `/otp/verify`, `/refresh`, `/logout`, `/logout-all`, `GET /auth/me` | `auth.routes.ts` L41–75 |
| Admins / RBAC | CRUD-ish admins, roles, permissions, sessions | `admins.routes.ts`, `roles.routes.ts`, `permissions.routes.ts`, `sessions.routes.ts` |
| Audit list | `GET /audit-logs` (page, pageSize, actorAdminId) | `audit.routes.ts` L11–16 |
| Broker offices | `POST/GET /brokers`, `GET/:id`, `PUT/:id/carriers`, `PATCH/:id/status`, `PATCH/:id` policy | `brokers.routes.ts` |
| Carriers | `POST/GET /carriers` | `carriers.routes.ts` L15–26 |
| Catalog | Admin create/list/patch trip, append seats | `catalog.routes.ts` L25–50 |
| Bookings | `GET/GET:id` admin list/get, `POST :id/cancel` | `bookings.routes.ts` L77–96 |
| Wallets | `GET /admin/wallets/:officeId` + ledger | `wallets.routes.ts` L31–36 |
| Top-ups | List, create-for-office, approve, reject, evidence | `payments.routes.ts` L62–97 |
| Commissions | Accrual list; settlement list/create/get/finalize/cancel | `commissions.routes.ts` L35–75 |
| Health | `GET /health`, `GET /ready` | `health.routes.ts` |

---

## REQ-ADM-01 — Cross-office wallet list

| Field | Spec |
|---|---|
| Domain | Wallets |
| Use case | `/financials/wallets` and overview float need every office wallet on one page |
| Actor | Central admin |
| Permission | `wallets.view` |
| Method / path | `GET /api/v1/admin/wallets` |
| Request | Query: `page`, `pageSize` (existing pagination), `status=ACTIVE\|SUSPENDED` (office), `lowBalance=true`, `q` (office code/name) |
| Response `data.items[]` | `officeId`, `officeCode`, `officeName`, `officeStatus`, `walletId`, `balanceMinor`, `currency:"SDG"`, `lowBalanceThresholdMinor`, `lowBalance`, `updatedAt` |
| Filters | As query |
| Sorting | Default `balanceMinor` desc; optional `sort=balanceMinor\|updatedAt\|officeCode` |
| Pagination | Existing `meta` |
| Validation | Zod query; `pageSize` max 100 |
| State transition | Read-only |
| Transaction | Read |
| Idempotency | n/a |
| Audit | None (read) |
| Failure | 401/403 |
| Dependencies | `Wallet`, `BrokerOffice`, `resolveOfficePolicy` |
| Acceptance | Lists all offices that have a wallet; `sum(balanceMinor)` equals sum of per-office gets; money is integer minor |
| Evidence | Matrix `/financials/wallets` list MISSING; `wallets.routes.ts` L31–36 office-id only; D-ACC-01 |

---

## REQ-ADM-02 — Admin ticket PDF

| Field | Spec |
|---|---|
| Domain | Bookings / tickets |
| Use case | Booking details ticket download/print for admins |
| Actor | Central admin |
| Permission | `bookings.view` (download of issued PDF; not `bookings.override`) |
| Method / path | `GET /api/v1/admin/bookings/:id/tickets/:ticketNumber/pdf` |
| Request | Params only |
| Response | `application/pdf` (same generator as broker route) |
| Filters | n/a |
| Validation | Existing `ticketPdfParamsSchema` |
| State transition | May record a `TicketDispatchAttempt` with channel `DOWNLOAD` if that is already the broker behavior; do not enable WhatsApp/SMS |
| Transaction | Same as broker PDF |
| Idempotency | Repeat GET returns the same artefact |
| Audit | `booking.ticket.pdf_downloaded` with `bookingId`, `ticketNumber` |
| Failure | 404 unknown booking/ticket; 403 missing permission; WhatsApp/SMS remain disabled |
| Dependencies | Existing PDF generator (`bookingsController.getTicketPdf`) |
| Acceptance | Admin with `bookings.view` can download; clerk JWT rejected; cancelled ticket policy matches broker |
| Evidence | D-TICKET-01; matrix booking PDF MISSING; `bookings.routes.ts` L65–69 broker-only vs admin L72–96 |

---

## REQ-ADM-03 — Settlement detail line items

| Field | Spec |
|---|---|
| Domain | Commissions / settlements |
| Use case | Review reserved accruals before finalize |
| Actor | Central admin |
| Permission | `commissions.view` |
| Method / path | Extend `GET /api/v1/admin/commissions/settlements/:id` |
| Request | Unchanged |
| Response | Existing settlement DTO **plus** `accruals: [{ id, bookingId, amountMinor, status, confirmedAt }]` |
| Pagination | Accrual array on the resource (period-bounded; if very large, nested page later) |
| Milestone A choice (2026-10-23) | Detail GET stays a summary (`accrualCount`, `currency: "SDG"`). Accruals are **not** embedded (no Stage 2.6 test required an array). Use `GET /admin/commissions/settlements/:id/accruals?page&pageSize` for line items. Sum of linked `amountMinor` must equal `totalAmountMinor`. |
| Validation | Existing params |
| State | Read; statuses UNSETTLED never appear on a DRAFT (they are RESERVED) |
| Transaction | Read |
| Audit | None |
| Failure | 404 |
| Dependencies | `commissionsRepository.findSettlementById` include `accruals` |
| Acceptance | DRAFT response lists every reserved accrual; sum of `amountMinor` equals `totalAmountMinor` |
| Evidence | D-SET-01; `toSettlementDto` L40–59 has `accrualCount` only; matrix PARTIAL |

---

## REQ-ADM-04 — Carrier get by id

| Field | Spec |
|---|---|
| Domain | Transport companies |
| Use case | `/companies/:id` header |
| Actor | Central admin |
| Permission | `carriers.view` |
| Method / path | `GET /api/v1/carriers/:companyId` |
| Request | Params |
| Response | `{ id, key, name, status, createdAt, assignmentCount }` — **only persisted fields**. Do not invent fleet/GPS/punctuality |
| Validation | id/key |
| Failure | 404 |
| Audit | None |
| Acceptance | Returns the same row as list item; 404 for unknown |
| Evidence | Matrix company detail MISSING; `carriers.routes.ts` has list+create only; `carrier.prisma` L6–18 |

---

## REQ-ADM-05 — Carrier update / status

| Field | Spec |
|---|---|
| Domain | Transport companies |
| Use case | Rename; suspend/activate company |
| Actor | Central admin |
| Permission | `carriers.manage` |
| Method / path | `PATCH /api/v1/carriers/:companyId` |
| Request | `{ name?: string, status?: "ACTIVE" \| "SUSPENDED" }` |
| Response | Same as REQ-ADM-04 |
| State | ACTIVE ↔ SUSPENDED. **Do not** invent effect on in-flight trips/bookings until D-SUS-01 / catalog policy is locked — document current behavior in acceptance: status flag only unless a locked rule is added |
| Transaction | Update company + audit |
| Idempotency | Repeat PATCH same status is no-op success |
| Audit | `carrier.updated` / `carrier.status_changed` |
| Failure | 404; 422 invalid status |
| Acceptance | Name change visible on list; status persisted |
| Evidence | Model already has `TransportCompanyStatus`; no PATCH route |

---

## REQ-ADM-06 — Admin trip get by id

| Field | Spec |
|---|---|
| Domain | Catalog |
| Use case | Company trips tab / booking trip pane |
| Actor | Central admin |
| Permission | `catalog.view` (Milestone A added this key; mutations stay `catalog.manage`). Super Admin receives it via catalog seed sync. Custom roles do not auto-gain it. |
| Method / path | `GET /api/v1/catalog/trips/:tripId` |
| Request | Params |
| Response | Same shape as broker `GET /broker/trips/:tripId` but **not** limited to assigned carriers; include seats + availability |
| Failure | 404 |
| Audit | None |
| Acceptance | Admin can open any trip; broker still scoped to assignment |
| Evidence | `catalog.routes.ts` admin has list/patch but no GET by id; broker GET at L64–67 |

---

## REQ-ADM-07 — Audit log query completeness

| Field | Spec |
|---|---|
| Domain | Audit |
| Use case | `/admin/audit` filters; booking activity; office audit tab |
| Actor | Central admin |
| Permission | `audit.view` |
| Method / path | Extend `GET /api/v1/audit-logs` |
| Request query | Existing `page`, `pageSize`, `actorAdminId` **plus** `action`, `resourceType`, `resourceId`, `requestId`, `from`, `to` |
| Response | Existing rows; include `ipAddress`, `userAgent`, parsed safe `metadata` object (not secrets) |
| Sorting | `createdAt` desc, `id` desc |
| Pagination | Existing |
| Validation | dates ISO; `pageSize` max 100 |
| State | Read |
| Audit | Do not audit reads |
| Failure | 422 bad dates |
| Dependencies | Indexes already on `audit.prisma` L16–19 |
| Acceptance | Filter `resourceType=booking&resourceId=:id` returns cancel/top-up-unrelated booking admin actions; empty list is 200 |
| Evidence | Matrix audit PARTIAL/MISSING; `listAuditQuerySchema` L3–7 |

Optional follow-on: `GET /audit-logs/:id` only if list payload is too large for a drawer. Not required if list already returns `metadataJson`.

---

## REQ-ADM-08 — Admin office staff manage

| Field | Spec |
|---|---|
| Domain | Broker offices / employees |
| Use case | Office employees tab: add clerk, suspend employee, set flags |
| Actor | Central admin |
| Permission | `brokers.manage` (do not invent `brokers.staff` unless splitting later) |
| Method / path | `GET /api/v1/brokers/:officeId/staff` (if GET office payload is too heavy, else document that GET office already returns employees — **read is COMPLETE**) |
| Mutations | `POST /api/v1/brokers/:officeId/staff`, `PATCH /api/v1/brokers/:officeId/staff/:employeeId` |
| Request create | Same as broker `createStaffSchema` (displayName, phone, flags) |
| Request patch | Same as broker `updateStaffSchema` |
| Response | `EmployeeDto` (`brokers.dto.ts` L7–43) |
| State | Employee ACTIVE/SUSPENDED; bump `authzVersion`; revoke sessions on suspend (mirror broker staff service) |
| Transaction | Employee + identity + audit |
| Idempotency | Phone unique per identity |
| Audit | `broker.staff.created` / `broker.staff.updated` |
| Failure | 409 duplicate phone; 404 office |
| Dependencies | Reuse `broker-staff` service rules |
| Acceptance | Admin can create a clerk without a broker session; new clerk can OTP-login |
| Evidence | Matrix employee mutations MISSING; `broker-staff.routes.ts` is broker-principal only |

---

## REQ-ADM-09 — Admin-scoped operational reports (approved records only)

| Field | Spec |
|---|---|
| Domain | Reports |
| Use case | `/reports` (bookings/wallets/commissions) without GL or carrier take-rate |
| Actor | Central admin |
| Permission | Recommend `reports.view` **new catalog key** (do not reuse `broker.reports.view`). Until added, do not hang admin reports off broker permission |
| Method / path | `GET /api/v1/admin/reports/summary` |
| Request | `from`, `to` (required), optional `officeId`, `companyId` |
| Response | `{ bookingsCount, bookingsAmountMinor, cancelledCount, refundedAmountMinor, unsettledCommissionMinor, settledCommissionMinor, walletsBalanceMinor, currency:"SDG" }` — all integers |
| Charts | Optional `GET /api/v1/admin/reports/by-office` and `.../by-carrier` mirroring broker report aggregations at platform scope |
| Sorting | n/a |
| Pagination | n/a for summary; series endpoints may page |
| Validation | `from < to`; range cap (e.g. 92 days) to protect MySQL |
| State | Read |
| Audit | None |
| Failure | 422 range |
| Dependencies | Booking, wallet, commission tables already populated |
| Acceptance | Summary for a known seed period matches summing list APIs; **no** trial-balance, **no** carrier net-payable |
| Evidence | D-ACC-01 records required; D-REV-01 / trial balance excluded; `reports.routes.ts` broker-only |

Do **not** add `/admin/reports/trial-balance` or `/admin/reports/carrier-shares`.

---

## REQ-ADM-10 — Dashboard KPI snapshot

| Field | Spec |
|---|---|
| Domain | Overview |
| Use case | `/overview` KPI row without inventing fleet/GPS |
| Actor | Central admin |
| Permission | Union of existing view keys **or** `reports.view` once added. Prefer requiring `bookings.view` and returning only sections the caller may see (omit wallets if no `wallets.view`) |
| Method / path | `GET /api/v1/admin/overview` |
| Request | `from`, `to` |
| Response | `{ bookingsCount, bookingsAmountMinor, pendingTopUpsCount, draftSettlementsCount, lowBalanceOfficesCount, walletsBalanceMinor, unsettledCommissionMinor, currency:"SDG" }` |
| Explicitly omitted | Active fleet, live map, customer GMV, insurance 88/12 split |
| Failure | 401/403 |
| Acceptance | Counts equal filtered list metas for the same window |
| Evidence | Matrix overview MISSING/PARTIAL; fixture insurance formula `financialService.ts` L37–40 is **not** policy |

---

## REQ-ADM-11 — Admin booking list search

| Field | Spec |
|---|---|
| Domain | Bookings |
| Use case | Bookings toolbar search box |
| Actor | Central admin |
| Permission | `bookings.view` |
| Method / path | Extend `GET /api/v1/admin/bookings` with `q` |
| Request | `q` max 64 chars: match `id`, `ticketNumber`, passenger `phone`, passenger `fullName` |
| Response | Unchanged list DTO (`totalAmountMinor`, `CONFIRMED\|CANCELLED`) |
| Pagination | Existing |
| Validation | Optional `q` |
| Failure | 422 |
| Acceptance | Ticket number from a known booking returns that row |
| Evidence | D-BOOK-01 filters exist but not free-text; `bookingService.ts` L26–52 |

Also document adapter (not a new API): map UI `carrierId`→`companyId`, `brokerId`→`officeId`; drop `pending/on_route/completed` and `direct_customer` until those products exist.

---

## REQ-ADM-12 — Admin revoke-all sessions for a target admin

| Field | Spec |
|---|---|
| Domain | Sessions |
| Use case | Member details “terminate all sessions” |
| Actor | Central admin |
| Permission | `sessions.revoke` |
| Method / path | `DELETE /api/v1/sessions?adminId=:id` **or** `POST /api/v1/admins/:adminId/sessions/revoke-all` |
| Request | Target `adminId` |
| Response | `{ revokedCount }` |
| State | All refresh sessions for that admin revoked; bump `authzVersion` (same as suspend) |
| Transaction | Sessions + authz |
| Idempotency | Second call `revokedCount=0` |
| Audit | `admin.sessions.revoked_all` |
| Failure | 404; protect bootstrap lockout using existing rules |
| Evidence | Matrix PARTIAL; `POST /auth/logout-all` is self-only (`auth.routes.ts` L65–68) |

---

## REQ-ADM-13 — Admin profile update (or stop advertising the permission)

| Field | Spec |
|---|---|
| Domain | Admins |
| Use case | Member details edit name / phone |
| Actor | Central admin |
| Permission | `admins.update` (catalogued, unused) |
| Method / path | `PATCH /api/v1/admins/:adminId` |
| Request | `{ displayName?: string, phone?: string }` — phone rotates `AdminIdentity` with the same uniqueness rules as create |
| Response | Existing admin DTO |
| Explicitly omitted | Email login, 2FA method, IP whitelist, department, avatar (product) |
| Transaction | Admin + identity + audit |
| Audit | `admin.updated` |
| Failure | 409 phone in use; 404 |
| Alternative | If PO does not want profile edit in M1, **remove the UI control** and keep the catalog key reserved — do not invent email/2FA here |
| Evidence | `permissions.ts` L4; no route in `admins.routes.ts` |

---

## REQ-ADM-14 — Synchronous CSV export for approved lists (P2)

Apply the same pattern to: admin bookings, broker offices, wallets list (after REQ-ADM-01), commission accruals, settlements.

| Field | Spec |
|---|---|
| Domain | Exports |
| Use case | Replace client-side fixture CSV |
| Actor | Central admin |
| Permission | Same **view** permission as the list, **or** a later `*.export` split if SoD is required (product). Default: view permission + audit |
| Method / path | `GET .../export.csv` on each list resource with the **same filters** as JSON list |
| Response | `text/csv; charset=utf-8` with UTF-8 BOM; money columns `amountMinor` + `currency` |
| Pagination | Cap rows (e.g. 10_000) or 422 `RANGE_TOO_LARGE` — **no async job** until a job product is decided |
| Audit | `*.exported` with filter snapshot |
| Failure | 422 over cap |
| Evidence | Matrix CSV rows MISSING; `/reports/export-center` async jobs are decision-required |
| Explicitly omitted | PDF report packs, trial-balance CSV, carrier-share CSV |

---

## REQ-ADM-15 — Catalog list filters used by company UI (P1/P2)

| Field | Spec |
|---|---|
| Domain | Catalog / carriers |
| Use case | Company list search; trips for one company |
| Actor | Central admin |
| Permission | `carriers.view` / `catalog.manage` |
| Method / path | Extend `GET /carriers` with `q` (key/name). Extend `GET /catalog/trips` with `companyId` if not already present (`adminTripsQuerySchema` must be verified at implementation; add if missing) |
| Response | Existing DTOs |
| Evidence | Matrix carrier search PARTIAL; trips tab PARTIAL |

---

## Non-functional requirements tied to these APIs

Only items with a concrete dashboard workflow:

| Need | Tied to | Requirement |
|---|---|---|
| Database pagination | All lists above | Reuse `parsePagination`; max 100 JSON, export cap separate |
| Stable sort | Wallet list, bookings | Explicit `orderBy` + id tie-break |
| File storage | Top-up evidence already exists | Reuse for PDF? PDFs are generated, not stored, unless current broker path stores them — keep current |
| Signed file access | Evidence GET already permissioned | Keep `wallets.topups.evidence.view` |
| Idempotency | Approve top-up, cancel booking, finalize settlement | Already implemented — do not regress |
| Optimistic concurrency | Settlement draft vs accrual change | Already 409 — keep |
| Audit coverage | Mutations in REQ-ADM-05/08/12/13/14 | Record actor + resource + requestId |
| Rate limits | OTP already limited | Export endpoints should share authenticated rate limit |
| Health/readiness | Shell connectivity pill | Already `GET /health` `/ready` |
| WebSockets | Tracking page | **Not specified** (D-GPS-01) |
| Global full-text | Topbar search | Optional later: sequential `q` across bookings/brokers/carriers; not a new search engine |
| Cache invalidation | Overview KPIs | Compute on read in M1; no Redis KPI cache unless measured |
| Soft delete | — | Not required by current admin screens |
| API versioning | All | Stay `/api/v1` |

---

## Decision-required (no endpoint)

Do **not** implement these as APIs until a locked row exists in `BACKEND_DECISION_REGISTER.md`.

| Topic | Why blocked | Decision id / source |
|---|---|---|
| Production GPS ingest, Redis latest, WebSocket, retention, provider, ping/stale | Tracking UI is a simulator | D-GPS-01 OPEN |
| Vehicle / driver / corridor entities | No Prisma models; Stitch fleet | D-GPS-01 / SCOPE-01 |
| Registered travelers, KYC, customer wallet, customer sessions | Customer vertical | D-PAY-01; SCOPE-01 |
| Direct-customer Bankak booking | Different journey | D-PAY-01 |
| Exceptional Super Admin wallet credit | PDF unauthorized | D-ADJ-01 OUT OF SCOPE |
| Full GL, journals, trial balance | Deferred | D-ACC-01 |
| Carrier revenue share / carrier payouts / carrier-shares report | Out of M1 | D-REV-01 |
| Refund review queue, % tiers, disputes, manual override | Broker cancel is wallet refund; override reserved | D-REF-01; `bookings.override` unimplemented |
| WhatsApp / SMS ticket or notify | Disabled | D-TICKET-01 |
| Runtime settings database for hold TTL, 2FA, IP whitelist, maintenance mode, VAT, SMS provider | Env or dangerous | D-POL-01; D-AUTH-01 |
| Global platform commission % | Non-authoritative | D-RATE-01 |
| Notification inbox / push | No D-NOTIF | Decision register silent |
| Async export job worker | Stitch export center | Product |
| Insurance float 88/12 | Fixture formula | `financialService.ts` L37–40 |
| Overbooking buffer | Breaks seat integrity | D-SEAT-01 |
| Office suspend effects beyond “block broker API + revoke sessions” | Login already blocked; refunds/settlements/historical broker read OPEN | D-SUS-01 OPEN |

### D-SUS-01 questions to lock before extra suspend APIs

Current implemented behavior (`authenticate-broker.ts` L33–38, `brokers.service.ts` L192–194):

- Employee login and **all** broker-principal routes fail if office is SUSPENDED (including historical read).
- Refresh sessions for the office are revoked.
- Admin can still GET office, bookings, wallets, settlements.

Still **OPEN** (do not invent): new top-ups from admin fallback while suspended; whether existing bookings can be cancelled; whether settlements can be finalized; whether a read-only broker history mode is required.
