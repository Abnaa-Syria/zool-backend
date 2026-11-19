# ZoolGo — Repository and Filesystem Map

This document details the physical structure of the ZoolGo workspace located at `d:\zool-go\`. It documents directory purposes, lifecycle statuses, configuration entry points, and source control findings.

---

## 1. Source Control and Git Audit

> [!CAUTION]
> **Source Control Status (NO GIT):**  
> An automated filesystem audit executed on 2026-11-19 verified that:
> 1. Root workspace `d:\zool-go\.git` **DOES NOT EXIST**.
> 2. Backend directory `d:\zool-go\zool-go-backend\.git` **DOES NOT EXIST**.
> 3. Frontend directory `d:\zool-go\zool-go-dashpoard\.git` **DOES NOT EXIST**.
> 4. No parent directory contains a `.git` folder (`git status` exits with code 128: `fatal: not a git repository`).
>
> **Receiving Engineer Rule:** Do not initialize Git or push commits without explicit coordination with project leadership. Maintain local backups before modifying files.

---

## 2. Sensitive Directory Naming Note

> [!IMPORTANT]
> **Notice the Directory Spelling: `zool-go-dashpoard`**  
> The React Admin Dashboard frontend is located in a folder named:
> ```text
> d:\zool-go\zool-go-dashpoard\    <-- Note the 'p' instead of 'b'
> ```
> **Do not rename this directory.** Shell scripts, Docker mounts, IDE workspace configurations, and cross-document references depend on this exact string.

---

## 3. High-Level Workspace Tree

```text
d:\zool-go\
├── docs/                                # Architecture specifications & roadmaps
│   ├── handover/                        # This engineering handover package (20 files)
│   ├── ADMIN_BACKEND_COMPLETION_ROADMAP.md
│   ├── ADMIN_DASHBOARD_API_REQUIREMENTS.md
│   ├── ADMIN_DASHBOARD_BACKEND_GAP_AUDIT.md
│   ├── ADMIN_DASHBOARD_ROUTE_AND_ACTION_MATRIX.md
│   ├── BACKEND_DECISION_REGISTER.md
│   ├── BACKEND_READINESS_AUDIT.md
│   ├── BACKEND_REQUIREMENTS.md
│   ├── FRONTEND_ARCHITECTURE.md
│   ├── IMPLEMENTATION_PLAN.md
│   ├── PROJECT_BRIEF.md
│   ├── REQUIREMENTS_AND_DECISIONS.md
│   └── SCREEN_INVENTORY.md
│
├── zool-go-backend/                     # Express/Prisma/MySQL/Redis Backend API
│   ├── prisma/                          # Multi-file Prisma schemas & migrations
│   │   ├── migrations/                  # Applied SQL migration history
│   │   ├── schema/                      # 12 domain schema files (.prisma)
│   │   └── seed.ts                      # Database seeder (Super Admin, RBAC, demo trips)
│   ├── src/                             # Backend TypeScript source code
│   │   ├── config/                      # Zod-validated environment config
│   │   ├── infrastructure/              # Database, Redis, Pino Logger, Local Storage
│   │   ├── modules/                     # 17 domain feature modules
│   │   ├── shared/                      # Middleware, errors, responses, security, utils
│   │   ├── app.ts                       # Express application assembly & route mounting
│   │   └── server.ts                    # HTTP server entry point & graceful shutdown
│   ├── tests/                           # Vitest integration & unit test suites
│   ├── docs/                            # OpenAPI YAML, HTTP specs, Authz specs
│   ├── postman/                         # Postman collections (Stage 1 & Stage 2)
│   ├── scripts/                         # Smoke test scripts (Node.js/ESM)
│   ├── uploads/                         # Local storage for receipt evidence (gitignored)
│   ├── docker-compose.yml               # Local MySQL 8.4 & Redis 7.4 services
│   ├── package.json                     # Dependencies & scripts
│   └── tsconfig.json                    # TypeScript compiler configuration
│
├── zool-go-dashpoard/                   # React 19 / Vite / Tailwind Admin Dashboard
│   ├── public/                          # Static public assets
│   ├── src/                             # Frontend source code
│   │   ├── app/                         # App shell, sidebar, topbar, React router
│   │   ├── components/                  # Shared UI components (TactileButton, etc.)
│   │   ├── features/                    # Feature modules (11 modules + tracking)
│   │   ├── lib/                         # Utility helpers (clsx, twMerge)
│   │   └── services/                    # Overview service & mock data fetchers
│   ├── index.html                       # HTML entry point (Cairo typography, RTL)
│   ├── package.json                     # Dependencies & scripts
│   ├── tailwind.config.js               # Design tokens, color palette, RTL rules
│   └── vite.config.ts                   # Vite build configuration
│
├── Zool/                                # Visual assets, mobile mockups, and authority PDF
│   ├── ZoolGo_Broker_Journey.pdf        # Sole authority document for M1 broker vertical
│   ├── logo.png                         # ZoolGo brand asset
│   └── *.png                            # 44 mobile UI screenshots (Customer & Driver apps)
│
└── stitch_zoolgo_admin_design_system/   # Raw Stitch UI design proposals & templates
    └── stitch_zoolgo_admin_design_system/ # HTML/CSS references (historical proposal only)
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
  - `prisma/schema/`: Multi-file schema directory containing 12 modular `.prisma` files.
  - `tests/`: 9 test suites covering authentication, RBAC, policy rules, broker flows, and admin milestones.

### 4.2. `zool-go-dashpoard\` (spelled with 'p')
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

*Verified from filesystem:*
- Git check command: `Test-Path "d:\zool-go\.git", "d:\zool-go\zool-go-backend\.git", "d:\zool-go\zool-go-dashpoard\.git"` -> `False, False, False`
- Frontend build output: `d:\zool-go\zool-go-dashpoard\dist\`
- Backend build output: `d:\zool-go\zool-go-backend\dist\`
