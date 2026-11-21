# Admin Backend Completion Roadmap

Dependency-ordered backend work so the Admin Dashboard can integrate against **approved** contracts. Frontend integration is the **last** milestone. Do not implement this roadmap in the same change as the audit.

**Status (2026-11-21):** Milestones A **and B** are implemented in `zool-go-backend` (`tests/milestone-a-admin.test.ts`, `tests/milestone-b-admin.test.ts`). Milestone C (KPIs, admin reports summary, CSV export) is **not** started. Original scope text is retained. The overall project sequence now lives in `docs/MASTER_PLAN.md`.

Authority: `docs/BACKEND_DECISION_REGISTER.md` → Stage 1 / 2 / 2.6 code → Broker Journey PDF.

Related: [`ADMIN_DASHBOARD_BACKEND_GAP_AUDIT.md`](ADMIN_DASHBOARD_BACKEND_GAP_AUDIT.md) · [`ADMIN_DASHBOARD_ROUTE_AND_ACTION_MATRIX.md`](ADMIN_DASHBOARD_ROUTE_AND_ACTION_MATRIX.md) · [`ADMIN_DASHBOARD_API_REQUIREMENTS.md`](ADMIN_DASHBOARD_API_REQUIREMENTS.md)

---

## How to read this

- **P0** — financial/operational correctness for admin M1 (broker vertical).
- **P1** — main admin workflows on approved entities.
- **P2** — reporting, counters, CSV, overview snapshot.
- **P3** — proposals; no code until a decision register lock.

Percentages in the gap audit are **unweighted row counts**, not effort.

After each milestone the listed screens stay **mocked** until Milestone F.

---

## Milestone A — P0 Admin M1 correctness gaps

**Recommended next backend milestone.**

### Scope

Close holes that would make an integrated admin **wrong** about money, tickets, carriers, or settlements — without GL, GPS, travelers, or refund queues.

### Included API requirements

- REQ-ADM-01 Cross-office wallet list
- REQ-ADM-02 Admin ticket PDF
- REQ-ADM-03 Settlement accrual line items
- REQ-ADM-04 Carrier get by id
- REQ-ADM-05 Carrier patch name/status

### Prisma / data

- No new money models.
- Carrier PATCH uses existing `TransportCompanyStatus`.
- Settlement GET include `accruals` (relation already on `CommissionSettlement`).
- Wallet list is a query over existing `Wallet` + `BrokerOffice`.

### Permissions

- `wallets.view`, `bookings.view`, `commissions.view`, `carriers.view`, `carriers.manage` — already in `PERMISSION_CATALOG`.
- Do **not** add `bookings.override`.
- Do **not** add exceptional credit.

### Cross-domain dependencies

- Ticket PDF reuses broker PDF generator (D-TICKET-01).
- Wallet list must use `resolveOfficePolicy` for `lowBalance` (D-POL-01).
- Carrier suspend is a **flag only** until D-SUS-01 is locked for catalog effects.

### Tests required

- Wallet list pagination, `lowBalance` filter, sum of `balanceMinor`.
- Admin PDF 200 for `bookings.view`; 403 without; broker token rejected.
- Settlement GET: sum of accrual `amountMinor` = `totalAmountMinor` for DRAFT.
- Carrier GET 404; PATCH status idempotent; audit row written.
- Regression: Stage 2.6 cancel, top-up approve, settlement finalize **does not debit/credit wallet**.

### Completion gate

- Lint/test/build/prisma validate green.
- OpenAPI + Postman updated for the five operations.
- No change to D-ADJ-01 / D-SET-01 / D-REV-01 posture.

### Still mocked afterward

Overview KPIs, tracking, travelers, GL, refunds, reports/export center, settings, global search, nav badges, CSV, office staff mutations, audit extra filters, admin profile PATCH.

---

## Milestone B — P1 Admin workflows on approved entities

### Scope

Make office, booking, catalog, audit, and staff screens operable without inventing domains.

### Included API requirements

- REQ-ADM-06 Admin trip GET
- REQ-ADM-07 Audit query filters (`action`, `resourceType`, `resourceId`, `requestId`, `from`, `to`)
- REQ-ADM-08 Admin office staff POST/PATCH
- REQ-ADM-11 Booking `q` search
- REQ-ADM-12 Revoke-all sessions for a target admin
- REQ-ADM-13 Admin profile PATCH **or** explicit PO decision to leave `admins.update` unused and strip the UI later
- REQ-ADM-15 Carrier `q` + trip `companyId` filter (if missing)

### Prisma / data

- Audit indexes already exist — expose them.
- Staff reuses `BrokerEmployee` / identities.
- Optional: `admins.update` mutates `displayName` + primary phone identity only.

### Permissions

- Staff mutations: `brokers.manage`.
- Sessions: `sessions.revoke`.
- Profile: `admins.update`.
- Consider adding `catalog.view` only if PO wants list/get without `catalog.manage`; otherwise keep current key.

### Cross-domain

- Staff suspend must bump broker `authzVersion` (existing cache helpers).
- Booking search must not add `direct_customer` channel.
- Audit filter `resourceType=booking` supports the activity page **for admin-actor events only**. Broker employee actions are not `AuditLog.actorAdminId` — do not fake them as admin audit.

### Tests required

- Audit filter combinations + index-backed queries.
- Admin creates clerk; clerk OTP login works.
- Booking `q` by ticket number.
- Revoke-all does not lock out the last bootstrap admin beyond existing protections.

### Completion gate

- OpenAPI updated.
- Stage 1 auth-rbac tests still pass.

### Still mocked afterward

Overview composed KPIs, reports, CSV, GPS, travelers, GL, refunds, settings, notifications, global search.

---

## Milestone C — P2 Productivity (derived from approved records)

### Scope

Dashboard snapshot, admin reports that are sums of M1 tables, synchronous CSV.

### Included API requirements

- REQ-ADM-09 Admin reports summary / by-office / by-carrier (no TB, no carrier shares)
- REQ-ADM-10 Overview snapshot (no fleet)
- REQ-ADM-14 Sync CSV for bookings, offices, wallets, accruals, settlements
- New permission `reports.view` added to catalog + super_admin seed

### Prisma / data

- No CoA. No new fact tables. SQL aggregates over `bookings`, `wallets`, `commission_accruals`, `top_up_intents`.

### Permissions

- `reports.view` for REQ-ADM-09.
- Overview: omit sections the caller cannot view.
- CSV: reuse view permission + audit (or split `*.export` if PO requires SoD).

### Cross-domain

- Nav badges can bind to overview counts (pending top-ups, DRAFT settlements, low-balance offices).
- Health/readiness already exist for the connectivity pill (frontend-only wiring later).

### Tests required

- Summary equals brute-force sums on a seeded period.
- CSV cap returns 422.
- `reports.view` 403 without permission.
- Range cap (e.g. 92 days).

### Completion gate

- No trial-balance route.
- No GPS fields on overview DTO.

### Still mocked afterward

Tracking, travelers, GL pages, refunds, settings mutations, export-center job worker, notifications inbox, Stitch insurance split.

---

## Milestone D — P3 Deferred / decision-blocked (do not schedule as engineering)

No APIs until the register is updated.

| Slice | Blocked by |
|---|---|
| Live tracking vertical (ingest, Redis, WS, vehicles, drivers, retention, provider) | D-GPS-01 OPEN |
| Travelers CRM / KYC / customer wallet | SCOPE-01, D-PAY-01 |
| Full GL / trial balance | D-ACC-01 deferred |
| Carrier shares / carrier Bankak disbursement | D-REV-01 |
| Refund queue, % tiers, disputes, override | D-REF-01, `bookings.override` reserved |
| Exceptional wallet credit | D-ADJ-01 |
| Runtime settings DB, maintenance mode, IP allowlist, SMS/WhatsApp toggles | D-POL-01, D-TICKET-01, D-AUTH-01 |
| Notification inbox | no decision |
| Async export jobs | no decision |
| Office suspend fine-grained policy | D-SUS-01 OPEN |

**What remains mocked if M1 admin integration proceeds without D:** those entire route groups.

---

## Milestone E — Contract freeze for frontend adapters (backend docs only)

Not new runtime behavior: publish a short **Admin UI adapter note** (can live in backend OpenAPI examples) listing:

- `amount` / `*Sdg` → `*Minor` integer
- `brokerId` → `officeId`, `carrierId` → `companyId`
- Booking status UI `confirmed` → `CONFIRMED` (drop pending/on_route/completed)
- Settlement UI `pending_approval` → `DRAFT`
- Top-up queue is the **enabled M1 production path** (MANUAL receipt review) until a real PSP; automatic remains architectural; mock confirm is non-production (D-TOP-01 clarification 2026-10-23)
- Finalize settlement does **not** credit wallets
- `bookings.override` hidden
- Deposit modal must call create-for-office + evidence, never `recordTopUp` free credit

This can be a subsection of OpenAPI; **do not** change dashboard source in this milestone.

---

## Milestone F — Frontend integration (last)

Only after A (required) and B (strongly recommended). C may land before or with F.

### Scope

- Login route (OTP) + cookie refresh + `GET /auth/me` + logout
- Route guards from effective permissions (UI hide ≠ authorization)
- Replace mock services **module by module** starting with brokers, bookings, wallets/top-ups, settlements, admin RBAC, audit
- Adapter layer for remaining CONTRACT_MISMATCH names
- Keep GPS / travelers / GL / refunds / settings **mocked or hidden** unless a register lock landed

### Explicitly not in F

- Rewriting Stitch into policy
- Connecting exceptional credit, carrier payouts, trial balance, live GPS

### Completion gate

- Dashboard talks only to `/api/v1` for integrated modules
- Stage 2.6 tests still green
- No Prisma changes in F unless a bug is found

---

## Suggested sequence

```text
A (P0 correctness) → B (P1 workflows) → C (P2 reports/CSV)
        ↘ optional E (adapter note) ↙
                    F (frontend integration last)
D never starts without a decision-register lock
```

Do not merge A–C into one “finish the backend” stage.

---

## What the dashboard can integrate **now** (before A)

If the team chooses a thin slice immediately after adapters (still **frontend**, not this roadmap):

| Ready now (COMPLETE or adapter-only mismatch) | Blocked until A+ |
|---|---|
| Admin OTP login / me / logout / roles / permissions / sessions revoke-one | Wallet **list** page (needs REQ-ADM-01) |
| Admin freeze | Ticket PDF in booking details |
| Broker office list/get/create/status/policy/carriers | Settlement review of reserved lines |
| Per-office wallet get + ledger | Carrier detail / status |
| Top-up list/approve/reject/evidence/create-for-office | Overview KPIs |
| Booking list/get/cancel | Tracking, travelers, GL, refunds, TB, carrier shares, settings |
| Accrual list; settlement draft/finalize/cancel | |
| Audit list (actor + page only) | |
| Health/ready | |
