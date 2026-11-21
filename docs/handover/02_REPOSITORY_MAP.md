# ZoolGo — Repository and Filesystem Map

Updated 2026-11-21. ZoolGo lives in **two Git repositories**:

| Repository | Local folder (suggested) | Contents |
|---|---|---|
| https://github.com/Abnaa-Syria/zool-backend | `zool_BE/` | Backend API, all docs, designs, AI-assistant rules |
| https://github.com/Abnaa-Syria/zool-dashboard | `zool_dashboard/` | Admin dashboard (React) |

The former `QeemaTech/zool_BE` / `QeemaTech/zool_dashboard` repos and the old `d:\zool-go\` layout (with the misspelled `zool-go-dashpoard` folder) are **retired**; older documents may still mention them.

Workflow: commit and push directly to `main`; run lint, typecheck and tests locally first. CI (`.github/workflows/`) re-runs them on every push.

---

## 1. Backend Repository Tree (`zool-backend`)

```text
zool_BE/
├── README.md                     # Repo index
├── CLAUDE.md, AGENTS.md, .cursorrules, .windsurfrules, .cursor/, .agents/
│                                 # AI coding rules — single copy, repo root only
├── .github/
│   ├── copilot-instructions.md
│   └── workflows/backend-ci.yml  # lint, typecheck, build, migrate deploy, drift check, tests
├── docs/
│   ├── MASTER_PLAN.md            # Project plan (authoritative sequence)
│   ├── BACKEND_DECISION_REGISTER.md
│   ├── handover/                 # Engineering handover package
│   └── archive/stage-plans/      # Historical STAGE*_PLAN.md files
├── Zool/                         # Mobile screen exports + ZoolGo_Broker_Journey.pdf
├── stitch_zoolgo_admin_design_system/  # Admin design proposals (reference only)
└── zool-go-backend/
    ├── prisma.config.ts          # Prisma CLI config (schema + migrations path + seed)
    ├── prisma/
    │   ├── schema/*.prisma       # Multi-file schema
    │   ├── schema/migrations/    # THE ONLY migrations folder
    │   └── seed.ts
    ├── src/{config,infrastructure,modules,shared}, app.ts, server.ts
    ├── tests/                    # Vitest integration suites (+ architecture/)
    ├── docs/openapi.yaml         # Served at /docs (Swagger UI)
    ├── postman/, scripts/        # Postman collections, smoke + db:test:prepare scripts
    ├── .env.example, .env.test.example
    └── docker-compose.yml        # Optional: MySQL dev 3308 / test 3307, Redis 6380
```

## 2. Dashboard Repository Tree (`zool-dashboard`)

```text
zool_dashboard/
├── .github/workflows/ci.yml      # lint, typecheck, tests, build
├── src/{app,components,features,lib,mocks,services}
├── index.html, vite.config.ts, tailwind.config.js, package.json
```

---

## 4. Directory Inventory and Details

### 4.1. `zool-go-backend\`
- **Status:** **ACTIVE / SOURCE CODE**
- **Purpose:** Production-grade modular monolith providing the complete REST API for central administration, broker operations, authentication, payments, catalog, and settlements.
- **Entry Points:**
  - `src/server.ts`: Starts HTTP server on `PORT` (default 4000), initiates DB and Redis connections, registers OS signals (`SIGINT`, `SIGTERM`) for graceful shutdown.
  - `src/app.ts`: Assembles Express middleware (Helmet, CORS, Pino HTTP, Request IDs), mounts raw-body webhook parsers, registers all 17 feature routers, mounts Swagger UI at `/docs`.
- **Key Configuration Files:**
  - `package.json`: CommonJS module, Node `>=20`, scripts for `dev`, `build`, `test`, `prisma:*`.
  - `tsconfig.json` & `tsconfig.build.json`: Strict TypeScript configuration.
  - `docker-compose.yml`: Spins up MySQL 8.4 (`3308`), Test MySQL 8.4 (`3307`), and Redis 7.4 (`6380`).
  - `.env.example`: Template for local environment variables.
- **Key Directories:**
  - `src/modules/`: 17 isolated domain modules (e.g., `auth/`, `admins/`, `brokers/`, `bookings/`, `payments/`, `commissions/`).
  - `src/infrastructure/`: Low-level database connections (`database/prisma.ts`), Redis client (`redis/redis.ts`), Pino structured logging (`observability/logger.ts`), and local disk storage provider (`storage/local-disk-storage.ts`).
  - `src/shared/`: Cross-cutting concerns including `asyncHandler`, `errorHandler`, `validate` (Zod), `requirePermission`, and standard envelopes (`successResponse`, `AppError`).
  - `prisma/schema/`: Multi-file schema directory containing 12 modular `.prisma` files; migrations in `prisma/schema/migrations/`.
  - `tests/`: 9 test suites covering authentication, RBAC, policy rules, broker flows, and admin milestones.

### 4.2. `zool-dashboard` repository
- **Status:** **ACTIVE / PROTOTYPE SOURCE CODE**
- **Purpose:** Single-page administrative dashboard for desktop operators, displaying operational metrics, broker management, booking inspections, and financial queues.
- **Entry Points:**
  - `index.html`: Configures HTML document root, injects Google Fonts (Cairo Arabic font family), and mounts `src/main.tsx`.
  - `src/main.tsx`: React 19 root bootstrap, wraps app in `QueryClientProvider` and `BrowserRouter`.
  - `src/app/router/index.tsx`: Declarative route definitions for 30 admin pages nested inside `<AppShell />`.
- **Key Configuration Files:**
  - `package.json`: ES module, Vite 8, React 19, Tailwind CSS 3.
  - `tailwind.config.js`: Custom color tokens (Transit Emerald, Crimson, Amber), Cairo font definitions.
  - `vite.config.ts`: React plugin configuration.
- **Key Directories:**
  - `src/app/shell/`: UI chrome including `Sidebar.tsx`, `Topbar.tsx`, and `navigationConfig.ts`.
  - `src/features/`: 11 feature domains (e.g., `bookings/`, `brokers/`, `carriers/`, `financials/`, `settlements/`, `tracking/`, `admin/`). Each feature encapsulates its own pages, components, and mock service (`*Service.ts`).
  - `src/features/tracking/services/telemetrySimulator.ts`: In-memory physics-based vehicle coordinate generator simulating live bus pings across Sudanese transit corridors.

### 4.3. `docs\`
- **Status:** **ACTIVE / DOCUMENTATION**
- **Purpose:** Primary architectural specifications, decision logs, API audit matrices, and handover documentation.
- **Key Files:**
  - `BACKEND_DECISION_REGISTER.md`: The supreme authority on approved vs rejected product choices.
  - `ADMIN_BACKEND_COMPLETION_ROADMAP.md`: Dependency-ordered milestone roadmap (Milestones A–F).
  - `ADMIN_DASHBOARD_ROUTE_AND_ACTION_MATRIX.md`: Comprehensive audit of all 222 UI interactions.
  - `ADMIN_DASHBOARD_BACKEND_GAP_AUDIT.md`: Quantitative gap analysis between frontend and backend.
  - `handover/`: This complete 20-document engineering handover package.

### 4.4. `Zool\`
- **Status:** **ACTIVE ASSET & HISTORICAL DESIGN**
- **Purpose:** Contains visual assets, mobile screen exports, and the primary business authority document.
- **Key Files:**
  - `ZoolGo_Broker_Journey.pdf`: **The sole source of truth for the first business vertical (Broker Office)**. Overrules all informal chat logs and conflicting wireframes.
  - `*.png`: 44 mobile screenshot designs depicting the planned customer booking app and driver boarding scanner. (Used as visual reference only).

### 4.5. `stitch_zoolgo_admin_design_system\`
- **Status:** **LEGACY / DESIGN PROPOSAL ONLY**
- **Purpose:** Contains initial HTML/CSS template mockups generated during early UX exploration.
- **Engineering Guidance:** Do not treat screens in this directory as business requirements. Features depicted here (such as complex General Ledger trial balance sheets or manual receipt queues as the primary checkout path) are explicitly designated as **proposals** or **superseded** unless locked in `BACKEND_DECISION_REGISTER.md`.

---

*Verified from the working copies on 2026-11-21.*
