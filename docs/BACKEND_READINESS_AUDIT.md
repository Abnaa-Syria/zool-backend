# ZoolGo Backend Readiness Audit

**Date:** 2026-10-20  
**Scope:** Verify implemented frontend against product evidence. No backend scaffolding.  
**Primary PDF extract:** local `pdf-parse` on [`Zool/ZoolGo_Broker_Journey.pdf`](../Zool/ZoolGo_Broker_Journey.pdf) (3 pages, ~6291 chars). Rules below cite that extract unless marked second-hand.

---

## 1. Verified implementation coverage

### Workspace reality

| Area | Status |
|---|---|
| Admin dashboard | Implemented mock SPA: [`zool-go-dashpoard/`](../zool-go-dashpoard/) |
| Customer / driver apps | PNG evidence only under [`Zool/`](../Zool/) — **no application source** |
| Backend | [`zool-go-backend/`](../zool-go-backend/) is **empty** |
| Stitch designs | [`stitch_zoolgo_admin_design_system/`](../stitch_zoolgo_admin_design_system/) — design assets |

### Admin routes (implemented)

Source: [`zool-go-dashpoard/src/app/router/index.tsx`](../zool-go-dashpoard/src/app/router/index.tsx)

| Route | Module |
|---|---|
| `/` → `/overview` | Overview |
| `/tracking`, `/tracking/vehicles/:vehicleId` | Live fleet (simulated GPS) |
| `/bookings`, `/bookings/:id`, `/bookings/:id/activity` | Bookings (read-oriented) |
| `/companies`, `/companies/:id` | Carriers |
| `/brokers`, `/brokers/:id` | Broker offices |
| `/travelers`, `/travelers/:id` | Travelers |
| `/financials/wallets`, `/ledger`, `/ledger/:id`, `/topup-queue`, `/settlements` | Financials |
| `/refunds/queue`, `/policies`, `/disputes/:ticketId` | Refunds / disputes |
| `/reports`, `/trial-balance`, `/carrier-shares`, `/export-center` | Reports |
| `/admin/team`, `/team/:id`, `/roles`, `/audit`, `/settings` | Admin governance |

**No login route. No route guards.** App boots into `AppShell`.

### Mock services (all domain I/O)

In-memory fixtures + mutable service classes; artificial latency in places. No ZoolGo API client.

| Service | Path | Mutations (simulated) |
|---|---|---|
| Overview | `src/services/overviewService.ts` | State variants only |
| Bookings | `features/bookings/services/bookingService.ts` | List/filter/CSV — **no cancel/refund mutation** |
| Tracking | `features/tracking/services/telemetrySimulator.ts` | Simulated motion; `isSimulated() === true` |
| Carriers | `features/carriers/services/carrierService.ts` | Add carrier; assign broker + rate |
| Brokers | `features/brokers/services/brokerService.ts` | Add broker; **instant** `topUpBrokerWallet` |
| Travelers | `features/travelers/services/travelerService.ts` | KYC, suspend, notes, session terminate |
| Financials | `features/financials/services/financialService.ts` | `recordTopUp`, approve/reject top-up queue, ledger |
| Settlements | `features/settlements/services/settlementService.ts` | Approve batch; credit commission; Bankak CSV |
| Refunds | `features/refunds/services/refundService.ts` | Manual override; dispute decision; policy toggles |
| Reports | `features/reports/services/reportsService.ts` | Fixture charts; fake export trigger |
| Admin / settings | `features/admin/services/*` | Team/RBAC/settings; fake gateway pings |

### Forms and validation

[`docs/FRONTEND_ARCHITECTURE.md`](FRONTEND_ARCHITECTURE.md) recommends React Hook Form + Zod. **Neither is installed.** Forms use local state + ad-hoc checks (e.g. email `@`, amount `> 0`, seat hold 1–60 min, platform commission 0–50%).

### Permissions

RBAC **screens** exist (`RolesPermissionsPage`, fixtures). **Runtime authorization is absent:** no authn, no ProtectedRoute, approval caps not enforced on money mutations.

### Financial calculations (frontend)

| Behavior | Nature |
|---|---|
| Wallet credit / queue approve | Local `balance += amount`; optional mock double-entry legs |
| Instant top-up on brokers/wallets | Parallel path; **not synced** with financial wallet state |
| Commission amounts | Fixture rates (samples ~3–12%); **no live GMV→commission engine** |
| Refund / dispute | Local `% of fare` (e.g. 100% / 85%); does **not** update booking or ledger services |
| Settlements | Status flips + CSV; operator-triggered |

### Tracking

- **Real:** Leaflet + OpenStreetMap tiles  
- **Simulated:** corridor waypoints + `telemetrySimulator`  
- **Missing:** device protocol, WebSocket ingest, Teltonika production feed  

---

## 2. Mock versus real versus missing

| Capability | UI | Simulated | Real external | Missing |
|---|---|---|---|---|
| Admin shell / RTL | Yes | Data | Fonts CDN | Auth |
| All listed admin routes | Yes | Fixtures/services | — | API |
| Live map | Yes | Bus motion | OSM tiles | Device GPS |
| Wallet / top-up / ledger UI | Yes | In-memory | — | Payment rails |
| Settlements / refunds / disputes | Yes | Local formulas | — | Policy authority |
| RBAC / settings / gateway test | Yes | Always-success pings | — | Enforcement |
| Customer app | Screenshots | — | — | Codebase |
| Driver / conductor app | Screenshots | — | — | Codebase |
| Backend API | — | — | — | Empty folder |

**Green tests ≠ production readiness.** Checks only exercise mock services and TypeScript compile.

---

## 3. Unconfirmed product expansions (keep as proposals)

Do **not** treat Stitch screens, AI docs, or implemented buttons as PO approval.

| Expansion | Source | Frontend |
|---|---|---|
| Manual Bankak receipt-review queue | Stitch `_24`; elevated in [`REQUIREMENTS_AND_DECISIONS.md`](REQUIREMENTS_AND_DECISIONS.md) §4.5; **conflicts with PDF** (see Decision Register) | `TopUpQueuePage` |
| Exceptional admin wallet credit | Stitch `_22` label; UI drawers | `recordTopUp` / broker instant top-up |
| Full CoA / journals / trial balance | Stitch `_23`/`_25`/`_27` | Ledger + trial-balance pages |
| Tiered refund retention matrix | Stitch `_35` (90/70/50 cited in docs); frontend **100/85/50/0** | `CancellationPoliciesPage` |
| Dispute dossier workspace | Stitch `_37`; Project Brief framing | `DisputeDossierPage` |
| Admin 2FA / five-role RBAC matrix | Stitch `_32`/`_33`; settings UI | Mock only |
| Teltonika 10s IoT pings | Stitch / architecture proposal | Simulator IMEIs |
| Global platform commission % (8%) | Frontend settings fixture | Conflicts with PDF per-carrier broker commission |
| Carrier revenue-share formula | Project Brief (not PDF §) | Reports fixtures (incl. residual SAPTCO samples) |

---

## 4. Existing validation results

Commands run in `zool-go-dashpoard/` on 2026-10-20:

| Check | Command | Exit | Result |
|---|---|---|---|
| Lint | `npm run lint` (`oxlint`) | **0** | **Pass with warnings** — 20 warnings (set-state-in-effect, static-components, only-export-components, one exhaustive-deps). No errors. |
| Test | `npm run test` (`vitest run`) | **0** | **13 files / 89 tests passed** (~2.4s). Service-level unit tests only; no E2E. |
| Build | `npm run build` (`tsc -b && vite build`) | **0** | **Success** (~16s). Chunk size warning (>500 kB). |

**Interpretation:** The mock dashboard compiles and its in-memory services meet unit expectations. That does not validate payment rails, concurrency, auth, or production business rules.

---

## 5. Source integrity notes

| Claim class | How to read |
|---|---|
| PDF primary | Extracted text from [`Zool/ZoolGo_Broker_Journey.pdf`](../Zool/ZoolGo_Broker_Journey.pdf) |
| Second-hand | [`REQUIREMENTS_AND_DECISIONS.md`](REQUIREMENTS_AND_DECISIONS.md) paraphrases; use only when cross-checked or explicitly labeled |
| Mobile observation | [`Zool/*.png`](../Zool/) present (boarding, QR, map, trips) |
| Stitch proposal | Design export + screen inventory |
| Frontend assumption | Fixtures, settings defaults, hardcoded dispute % |

[`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) Stage 6 checkboxes are **stale** relative to code (UI exists; plan still unchecked).

---

## Related deliverables

- [`BACKEND_REQUIREMENTS.md`](BACKEND_REQUIREMENTS.md) — evidence-backed operations and data  
- [`BACKEND_DECISION_REGISTER.md`](BACKEND_DECISION_REGISTER.md) — unresolved decisions and blockers by milestone slice  
