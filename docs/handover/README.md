# ZoolGo — Engineering Handover Package

Welcome to the ZoolGo engineering handover documentation. This package provides an evidence-based, architecture-first reference for taking engineering ownership of the ZoolGo platform without verbal briefings from the previous team.

---

## 1. Project Summary and Current Phase

**ZoolGo** is an intercity passenger bus transport platform built specifically for Sudan's intercity transit market. In an economy characterized by severe currency inflation, cash shortages, and unreliable consumer banking, ZoolGo's primary go-to-market vertical operates on a **broker office model**: authorized travel agencies and ticketing kiosks issue bus tickets on behalf of travelers using a prepaid agency wallet in **Sudanese Pounds (SDG)**, earning per-carrier commissions that are settled periodically.

### Current Phase Status

| Component | Architecture Phase | Implementation Status | Integration State | Verified Test Status |
|---|---|---|---|---|
| **Backend API** (`zool-go-backend`) | Stage 1, Stage 2, Stage 2.6, Milestone A, Milestone B | **IMPLEMENTED** (81 JSON routes, 30 Prisma models, 20 enums, multi-file schema) | Standalone API server | 9 test suites (72 tests total; 4 contract tests passing offline; 68 integration tests require local MySQL/Redis) |
| **Admin Dashboard** (`zool-go-dashpoard`) | Stage 0 UI Prototype / Design System Delivery | **MOCKED** (30 reachable pages, 11 mock services, in-memory fixtures) | Zero API calls to `/api/v1`; no login route; hardcoded persona | 13 test files (89 unit/mock tests passing, exit code 0) |
| **Broker Portal** | Stage 2 Broker Principal Backend | **BACKEND IMPLEMENTED** (`/api/v1/broker/*`); UI exists only as PDF designs / mobile mocks | No web frontend built yet | Covered by backend integration tests (`tests/stage2-broker.test.ts`) |
| **Customer App** | Vertical 2 (Direct-to-consumer) | **DESIGN ONLY** (`Zool/*.png`); backend deferred | Not started | Not started |
| **Driver / Conductor App** | Operations & QR Boarding | **DESIGN ONLY** (`Zool/*.png`); backend deferred | Not started | Not started |
| **Fleet GPS Tracking** | Telemetry Ingestion Pipeline | **MOCKED** on frontend (`telemetrySimulator.ts`); backend `D-GPS-01` is **OPEN** | Simulated in browser | Simulator tests passing (`telemetrySimulator.test.ts`) |

---

## 2. Technology Stack

### Backend (`zool-go-backend`)
- **Runtime & Language:** Node.js `>=20`, TypeScript `5.8.2`, CommonJS module format
- **HTTP Framework:** Express `4.21.2`, Helmet `8.1.0`, CORS `2.8.5`, Cookie-Parser `1.4.7`
- **Validation & Serialization:** Zod `3.24.2`, YAML `2.7.1`
- **Database & ORM:** MySQL `8.4`, Prisma ORM `6.19.0` (multi-file schema in `prisma/schema/*.prisma`)
- **Cache & Rate Limiting:** Redis `7.4` via `ioredis 5.6.1`, `express-rate-limit 7.5.0`
- **Security & Crypto:** `jsonwebtoken 9.0.2`, `bcryptjs 3.0.2`, HMAC-SHA256 with constant-time equality
- **Document Generation:** PDFKit `0.20.2` (vector bus ticket generation)
- **Logging & Diagnostics:** Pino `9.6.0`, `pino-http 10.4.0` with sensitive field redaction
- **Testing & Tooling:** Vitest `3.0.8`, Supertest `7.0.0`, Tsx `4.19.3`, ESLint `9.22.0`

### Frontend (`zool-go-dashpoard` — note spelling)
- **Runtime & Build:** Vite `8.3.4`, React `19.2.8`, React DOM `19.2.8`, TypeScript `6.0.2`
- **Routing & State:** React Router `7.18.4`, TanStack React Query `5.104.4` (configured in app tree, but currently unused by mock services)
- **Styling & UI:** Tailwind CSS `3.4.19`, PostCSS `8.5.30`, Autoprefixer `10.6.1`, Radix UI primitives (`@radix-ui/react-dialog`, `dropdown-menu`, `tabs`, `tooltip`, `slot`), Lucide React `1.59.0`, Motion `14.4.0`
- **Data Visualization & GIS:** Recharts `3.10.1`, Leaflet `1.9.4`, React-Leaflet `5.0.0`, QRCode.react `4.2.0`
- **Linter & Test:** Oxlint `1.81.0` (fast Rust-based linter), Vitest `5.0.5`

---

## 3. Critical Engineering Warnings

> [!CAUTION]
> **Source Control Status (NO GIT):**  
> As verified on 2026-11-19, neither the root workspace `d:\zool-go`, nor `zool-go-backend`, nor `zool-go-dashpoard` are under Git version control. No `.git` directory exists anywhere in the tree. Treat the filesystem with extreme caution, take filesystem backups before performing refactorings, and review [02_REPOSITORY_MAP.md](02_REPOSITORY_MAP.md) before touching any directory.

> [!WARNING]
> **Admin Dashboard is Mock-Driven:**  
> The React Admin Dashboard (`zool-go-dashpoard`) currently makes **zero network requests** to `/api/v1`. All 30 pages display in-memory fixtures. There is no login screen, no session storage, and no route protection. Frontend-to-backend integration is intentionally scheduled as **Milestone F** (the final delivery milestone) after backend capabilities are completed.

> [!WARNING]
> **Currency is Minor Units SDG Only:**  
> All financial amounts across the backend, Prisma schemas, and APIs are stored and transmitted as **integer minor units** (`amountMinor`, `balanceMinor`, `fareAmountMinor`). The only currency is Sudanese Pounds (`SDG`). The frontend currently displays floating-point major SDG units (`amount`, `balance`); conversion must happen at the adapter boundary during Milestone F.

> [!IMPORTANT]
> **Top-Up Operational Path:**  
> Under locked decision `D-TOP-01`, ZoolGo supports both automatic PSP webhooks and manual receipt reviews. However, because no Sudanese payment service provider (e.g., Bank of Khartoum / Bankak) contract is finalized, **the manual receipt review path (`MANUAL_FALLBACK`) is the only operational production top-up path**. The automatic mock confirmation endpoint (`POST /payments/mock/confirm`) is hard-blocked when `NODE_ENV=production`.

> [!WARNING]
> **Admin Phone-Change Security Gap:**  
> The self-service phone change endpoint (`POST /api/v1/auth/phone/otp/verify`) updates the admin's primary phone identity, but does **not** invalidate active refresh sessions and does **not** increment `authzVersion`. Flagged as technical debt; see [08_AUTHENTICATION_SESSIONS_AND_RBAC.md](08_AUTHENTICATION_SESSIONS_AND_RBAC.md) and [16_NEXT_ENGINEER_PLAN.md](16_NEXT_ENGINEER_PLAN.md).

---

## 4. Documentation Index and Reading Order

| Doc # | Filename | Summary | Key Focus |
|---|---|---|---|
| 01 | [01_PRODUCT_AND_SCOPE.md](01_PRODUCT_AND_SCOPE.md) | Product vision, market context, actors, surfaces, and entity boundaries | Business context & boundaries |
| 02 | [02_REPOSITORY_MAP.md](02_REPOSITORY_MAP.md) | Physical directory tree, active vs legacy files, Git audit | Filesystem & entry points |
| 03 | [03_SYSTEM_ARCHITECTURE.md](03_SYSTEM_ARCHITECTURE.md) | System topology, Mermaid sequences for core flows, lifecycle | Architectural diagrams |
| 04 | [04_FRONTEND_ARCHITECTURE.md](04_FRONTEND_ARCHITECTURE.md) | React/Vite dashboard, RTL Cairo styling, 30-route audit, mock audit | Frontend deep dive |
| 05 | [05_BACKEND_ARCHITECTURE.md](05_BACKEND_ARCHITECTURE.md) | Express modular monolith, 17 modules, layering rules, middleware | Backend deep dive |
| 06 | [06_SOLID_AND_DESIGN_PATTERNS.md](06_SOLID_AND_DESIGN_PATTERNS.md) | Evidence-based SOLID analysis and applied design patterns | Coding standards |
| 07 | [07_DOMAIN_MODEL_AND_DATABASE.md](07_DOMAIN_MODEL_AND_DATABASE.md) | MySQL schema, 30 models, 20 enums, Mermaid ERDs, invariants | Database & Prisma |
| 08 | [08_AUTHENTICATION_SESSIONS_AND_RBAC.md](08_AUTHENTICATION_SESSIONS_AND_RBAC.md) | Admin OTP auth, token rotation, Redis `authzVersion`, 32 permissions | Security & permissions |
| 09 | [09_BUSINESS_FLOWS.md](09_BUSINESS_FLOWS.md) | 34 detailed business flows (preconditions, steps, DB, audit) | Flow specifications |
| 10 | [10_API_AND_FRONTEND_COVERAGE.md](10_API_AND_FRONTEND_COVERAGE.md) | 81 mounted endpoints, contract mappings, integration readiness | API inventory |
| 11 | [11_CURRENT_STATUS_AND_GAPS.md](11_CURRENT_STATUS_AND_GAPS.md) | Truthful gap analysis across 19 domains, milestones completed | Project status |
| 12 | [12_LOCAL_SETUP_AND_RUNBOOK.md](12_LOCAL_SETUP_AND_RUNBOOK.md) | Windows development setup, Docker, MySQL, Redis, runbook | Running the project |
| 13 | [13_TESTING_AND_QUALITY.md](13_TESTING_AND_QUALITY.md) | Test suites, actual execution counts, linting, build outputs | QA & verification |
| 14 | [14_SECURITY_AND_OPERATIONS.md](14_SECURITY_AND_OPERATIONS.md) | Threat modeling, risk register, production hardening gaps | Security posture |
| 15 | [15_DECISIONS_AND_CONSTRAINTS.md](15_DECISIONS_AND_CONSTRAINTS.md) | Locked decisions register, open questions, deferred items | Product locks |
| 16 | [16_NEXT_ENGINEER_PLAN.md](16_NEXT_ENGINEER_PLAN.md) | Day 1 tasks, Week 1 milestones, contribution checklists | Implementation roadmap |
| 17 | [17_TROUBLESHOOTING.md](17_TROUBLESHOOTING.md) | Known errors, port conflicts, Prisma locks, Redis traps | Debugging guide |
| 18 | [18_GLOSSARY.md](18_GLOSSARY.md) | English and Arabic glossary of domain, financial, and tech terms | Terminology reference |
| — | [HANDOVER_CHECKLIST.md](HANDOVER_CHECKLIST.md) | Formal sign-off and verification acceptance checklist | Handover sign-off |

### Recommended Reading Schedule

- **Day 1: Orientation & Running the Code**
  1. Read [README.md](README.md) and [01_PRODUCT_AND_SCOPE.md](01_PRODUCT_AND_SCOPE.md).
  2. Inspect the filesystem using [02_REPOSITORY_MAP.md](02_REPOSITORY_MAP.md).
  3. Set up the local runtime environment using [12_LOCAL_SETUP_AND_RUNBOOK.md](12_LOCAL_SETUP_AND_RUNBOOK.md).
  4. Review the initial task plan in [16_NEXT_ENGINEER_PLAN.md](16_NEXT_ENGINEER_PLAN.md).
- **Day 2: Architecture, Security, & Domain Model**
  1. Study system diagrams in [03_SYSTEM_ARCHITECTURE.md](03_SYSTEM_ARCHITECTURE.md).
  2. Review the backend structure in [05_BACKEND_ARCHITECTURE.md](05_BACKEND_ARCHITECTURE.md).
  3. Inspect the Prisma schema and ERDs in [07_DOMAIN_MODEL_AND_DATABASE.md](07_DOMAIN_MODEL_AND_DATABASE.md).
  4. Understand OTP authentication and dynamic RBAC in [08_AUTHENTICATION_SESSIONS_AND_RBAC.md](08_AUTHENTICATION_SESSIONS_AND_RBAC.md).
  5. Trace core flows in [09_BUSINESS_FLOWS.md](09_BUSINESS_FLOWS.md).
- **Day 3: Frontend, Patterns, & Next Milestones**
  1. Inspect the React dashboard structure in [04_FRONTEND_ARCHITECTURE.md](04_FRONTEND_ARCHITECTURE.md).
  2. Review SOLID conventions and design patterns in [06_SOLID_AND_DESIGN_PATTERNS.md](06_SOLID_AND_DESIGN_PATTERNS.md).
  3. Review API and contract mismatches in [10_API_AND_FRONTEND_COVERAGE.md](10_API_AND_FRONTEND_COVERAGE.md).
  4. Understand completed vs deferred scope in [11_CURRENT_STATUS_AND_GAPS.md](11_CURRENT_STATUS_AND_GAPS.md) and [15_DECISIONS_AND_CONSTRAINTS.md](15_DECISIONS_AND_CONSTRAINTS.md).
  5. Review security risks in [14_SECURITY_AND_OPERATIONS.md](14_SECURITY_AND_OPERATIONS.md) and sign off via [HANDOVER_CHECKLIST.md](HANDOVER_CHECKLIST.md).

---

## 5. Five-Minute Project Summary

1. **Why ZoolGo exists:** Sudanese intercity bus ticketing is traditionally paper-based, fragmented, and vulnerable to cash handling risks. ZoolGo centralizes inventory across multiple transport companies (carriers) and distributes seats through established commercial travel agencies (broker offices).
2. **First vertical (Broker Office Vertical):** The core revenue-generating workflow is a broker office booking tickets for passengers. The broker deposits funds into a prepaid office wallet. Upon booking confirmation, the wallet is debited immediately, tickets are issued as signed PDFs, and an agency commission accrues per carrier assignment.
3. **Admin Platform:** Central administrators configure carriers, broker offices, trips, seats, commission rates, and policies. Central admins also audit financial transactions, review manual top-up receipt uploads, cancel bookings with refunds and commission clawbacks, and draft/finalize periodic commission settlements.
4. **Current Engineering State:** The backend has a robust, fully typed modular monolith implementing Stage 1 (admin auth & RBAC), Stage 2 (broker booking vertical), Stage 2.6 (policy locks & SDG minor-unit money), Milestone A (P0 admin core), and Milestone B (P1 admin workflows). The frontend Admin Dashboard has 30 rich, responsive pages built with Tailwind and Radix, but currently runs entirely on mock fixtures.
5. **Immediate Next Step:** Complete Milestone C (P2 reports, overview KPI aggregation, and CSV exports) or address the admin phone-change security hardening gaps before embarking on Milestone F (frontend-to-backend integration).

---

## 6. First Commands to Run

To verify both codebases immediately from the terminal:

### Frontend Verification
```powershell
cd d:\zool-go\zool-go-dashpoard
npm run lint    # Oxlint runs across 197 files (0 errors, 20 minor React warnings)
npm test        # Vitest runs 13 test files (89 tests pass in ~2.8s)
npm run build   # tsc -b && vite build compiles cleanly to dist/
```

### Backend Verification
```powershell
cd d:\zool-go\zool-go-backend
npm run lint          # ESLint runs across src and tests (0 errors, max-warnings 0)
npm run build         # tsc -p tsconfig.build.json compiles cleanly to dist/
npx prisma validate   # Validates all 12 .prisma files in prisma/schema
npx prisma generate   # Generates Prisma Client v6.19.0
```

*(Note: Running backend `npm test` requires MySQL 8.4 on port 3307 and Redis on port 6380 via Docker; see [12_LOCAL_SETUP_AND_RUNBOOK.md](12_LOCAL_SETUP_AND_RUNBOOK.md).)*

---

*Handover documentation generated on: 2026-11-19 by Principal Software Architect & Engineering Handover Lead.*
