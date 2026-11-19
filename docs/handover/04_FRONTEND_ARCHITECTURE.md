# ZoolGo — Frontend Architecture

This document provides a comprehensive technical audit of the Admin Dashboard frontend located at `d:\zool-go\zool-go-dashpoard\`. It details the technology stack, application shell, component design patterns, mock data reality, build characteristics, and conventions to preserve during integration.

---

## 1. Technical Stack and Core Dependencies

- **Framework & Build:** React `19.2.8`, React DOM `19.2.8`, Vite `8.3.4`
- **Language:** TypeScript `~6.0.2` (configured via `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`)
- **Routing:** React Router `7.18.4` (`createBrowserRouter`, `RouterProvider`, `Navigate`, `Outlet`, `useParams`, `useNavigate`)
- **State Management & Caching:**
  - TanStack React Query `5.104.4` (`QueryClient`, `QueryClientProvider` configured at root in `src/main.tsx`, but **currently unused** by feature services).
  - Local component state via React `useState`, `useReducer`, `useEffect`, and `useMemo`.
- **Styling & Design System:**
  - Tailwind CSS `3.4.19`, PostCSS `8.5.30`, Autoprefixer `10.6.1`.
  - Design tokens in `tailwind.config.js`: Custom transit palette (`emerald`, `crimson`, `amber`, `slate`), border radii, custom shadow tokens.
  - Tactile physical UI styling: Beveled borders, physical push-button active states, receipt paper styling.
- **Headless UI Primitives:** Radix UI primitives (`@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-slot`, `@radix-ui/react-tabs`, `@radix-ui/react-tooltip`).
- **Icons & Animation:** Lucide React `1.59.0` (directional arrows, physical status glyphs), Motion `14.4.0` (`framer-motion` evolution).
- **Data Visualization & GIS:**
  - Recharts `3.10.1` (`AreaChart`, `BarChart`, `PieChart`, `ResponsiveContainer`).
  - Leaflet `1.9.4`, React-Leaflet `5.0.0` (`MapContainer`, `TileLayer`, `Marker`, `Popup`, `Polyline`).
  - QRCode.react `4.2.0` (`QRCodeSVG`).

---

## 2. Layout, Shell, RTL, and Typography

### 2.1. Right-to-Left (RTL) Implementation
Intercity transit administration in Sudan is conducted in Modern Standard Arabic. The frontend is configured for native RTL rendering:
- `index.html` sets `<html lang="ar" dir="rtl">`.
- CSS layouts use logical margin and padding classes (`ms-*`, `me-*`, `ps-*`, `pe-*`) or explicit Tailwind RTL modifiers (`rtl:space-x-reverse`).
- Icons indicating direction (e.g., transit route paths, navigation arrows) are inverted for RTL context.

### 2.2. Arabic Typography
- The primary typeface is **Cairo** (Google Fonts), injected via `<link>` in `index.html` and configured as the default sans font in `tailwind.config.js`:
  ```javascript
  fontFamily: {
    sans: ['Cairo', 'system-ui', 'sans-serif'],
    mono: ['JetBrains Mono', 'monospace'],
  }
  ```
- Numbers in tables and ledger lines use monospace styling (`font-mono`) to ensure tabular alignment of financial figures.

### 2.3. Application Shell (`src/app/shell/`)
The main layout is managed by `AppShell.tsx`:
- `Sidebar.tsx`: Collapsible side navigation menu bound to `navigationConfig.ts`. Displays navigation badges (e.g., `142` bookings, `14` low balance warnings, `4` pending settlements).
- `Topbar.tsx`: Search bar, server connectivity status pill, current date badge, static notifications bell dropdown, and admin profile card.
- **Critical Audit Finding:** The topbar hardcodes the logged-in administrator as **أحمد السر (Super Admin)** (`Topbar.tsx` L135–138). There is no active session context, token lookup, or dynamic profile fetch.

---

## 3. Forms, Validation, and State Management Reality

### 3.1. Forms and Validation
- **No Schema Validation Library:** The frontend does not currently use Zod, Yup, or React Hook Form.
- Forms (e.g., `AddBrokerModal.tsx`, `WalletDepositModal.tsx`, `CreateTripModal.tsx`) use raw controlled React state (`useState`) with manual button disable logic or simple `required` HTML attributes.
- Validation errors are presented via local error state strings or browser `alert()` popups.

### 3.2. Data Fetching and Services
- All 11 feature modules under `src/features/` import an in-memory mock service (e.g., `brokerService.ts`, `bookingService.ts`, `financialService.ts`).
- These services simulate asynchronous network latency using `await new Promise(r => setTimeout(r, 300))` and manipulate module-scoped in-memory JavaScript arrays.
- **Network Reality:** The dashboard makes **zero HTTP requests** to the backend API (`/api/v1`). There is no centralized `axios` or `fetch` client, no auth header interceptor, and no error response mapper.

### 3.3. Route Guards and Permissions
- There are **no route guards or permission checks** in `router/index.tsx`. Every route is publicly accessible within the browser.
- The UI does not check permissions before rendering action buttons (e.g., "Add Broker", "Top Up", "Finalize Settlement" are always visible).

---

## 4. Route Inventory and Backend Alignment

The frontend router (`src/app/router/index.tsx`) defines **30 reachable pages** (plus `/` and `*` redirects to `/overview`).

| Route | Page Component | Feature Module | Current Data Source | Backend API Support | Integration Readiness |
|---|---|---|---|---|---|
| `/overview` | `OverviewPage` | `overview` | `overviewService.ts` | **PARTIAL** (No admin aggregate API; REQ-ADM-10 needed) | Needs backend KPI endpoint |
| `/tracking` | `LiveTrackingPage` | `tracking` | `telemetrySimulator.ts` | **NONE** (`D-GPS-01` OPEN; backend unbuilt) | Deferred (P3) |
| `/tracking/vehicles/:id` | `VehicleDetailsPage` | `tracking` | `telemetrySimulator.ts` | **NONE** (No vehicle entities) | Deferred (P3) |
| `/bookings` | `BookingsListPage` | `bookings` | `bookingService.ts` | **COMPLETE** (`GET /api/v1/admin/bookings`) | **Ready to Integrate** |
| `/bookings/:id` | `BookingDetailsPage` | `bookings` | `bookingService.ts` | **COMPLETE** (`GET /api/v1/admin/bookings/:id`) | **Ready to Integrate** |
| `/bookings/:id/activity` | `BookingActivityPage` | `bookings` | `bookingService.ts` | **PARTIAL** (`GET /api/v1/audit-logs?resourceType=booking`) | Needs audit actor mapping |
| `/companies` | `CarriersListPage` | `carriers` | `carrierService.ts` | **COMPLETE** (`GET /api/v1/carriers`) | **Ready to Integrate** |
| `/companies/:id` | `CarrierDetailsPage` | `carriers` | `carrierService.ts` | **COMPLETE** (`GET/PATCH /api/v1/carriers/:id`) | **Ready to Integrate** |
| `/brokers` | `BrokersListPage` | `brokers` | `brokerService.ts` | **COMPLETE** (`GET/POST /api/v1/brokers`) | **Ready to Integrate** |
| `/brokers/:id` | `BrokerDetailsPage` | `brokers` | `brokerService.ts` | **COMPLETE** (`GET /api/v1/brokers/:id`, wallet, staff) | **Ready to Integrate** |
| `/travelers` | `TravelersListPage` | `travelers` | `travelerService.ts` | **NONE** (Direct customer CRM out of M1 scope) | Deferred (P3) |
| `/travelers/:id` | `TravelerDetailsPage` | `travelers` | `travelerService.ts` | **NONE** (No customer identity model) | Deferred (P3) |
| `/financials/wallets` | `WalletsOverviewPage` | `financials` | `financialService.ts` | **COMPLETE** (`GET /api/v1/admin/wallets`) | **Ready to Integrate** |
| `/financials/ledger` | `GeneralLedgerPage` | `financials` | `financialService.ts` | **NONE** (Full GL deferred under `D-ACC-01`) | Proposals only |
| `/financials/ledger/:id` | `JournalEntryDetailsPage` | `financials` | `financialService.ts` | **NONE** (Double-entry journal deferred) | Proposals only |
| `/financials/topup-queue` | `TopUpQueuePage` | `financials` | `financialService.ts` | **COMPLETE** (`GET/POST /api/v1/admin/wallets/top-ups/*`) | **Ready to Integrate** |
| `/financials/settlements` | `SettlementsPage` | `settlements` | `settlementService.ts` | **COMPLETE** (`GET/POST /api/v1/admin/commissions/settlements/*`) | **Ready to Integrate** |
| `/refunds/queue` | `RefundsQueuePage` | `refunds` | `refundService.ts` | **OUT OF SCOPE** (Broker cancel refunds wallet; no admin queue) | Mock to be removed |
| `/refunds/policies` | `CancellationPoliciesPage`| `refunds` | `refundService.ts` | **OUT OF SCOPE** (No time-tiered retention in M1) | Mock to be removed |
| `/refunds/disputes/:id` | `DisputeDossierPage` | `refunds` | `refundService.ts` | **OUT OF SCOPE** (Dispute workflow unapproved) | Mock to be removed |
| `/reports` | `FinancialReportsPage` | `reports` | `reportsService.ts` | **PARTIAL** (Needs Milestone C admin reports endpoint) | Blocked on Milestone C |
| `/reports/trial-balance`| `TrialBalancePage` | `reports` | `reportsService.ts` | **NONE** (Full GL deferred under `D-ACC-01`) | Proposals only |
| `/reports/carrier-shares`| `CarrierSharesPage` | `reports` | `reportsService.ts` | **OUT OF SCOPE** (Carrier disbursement `D-REV-01` out of M1) | Proposals only |
| `/reports/export-center` | `ReportsExportCenterPage`| `reports` | `reportsService.ts` | **PARTIAL** (Needs Milestone C sync CSV endpoint) | Blocked on Milestone C |
| `/admin/team` | `AdminTeamPage` | `admin` | `adminService.ts` | **COMPLETE** (`GET/POST /api/v1/admins`) | **Ready to Integrate** |
| `/admin/team/:id` | `AdminMemberDetailsPage` | `admin` | `adminService.ts` | **COMPLETE** (`GET/PATCH /api/v1/admins/:id`, roles, sessions) | **Ready to Integrate** |
| `/admin/roles` | `RolesPermissionsPage` | `admin` | `adminService.ts` | **COMPLETE** (`GET/POST /api/v1/roles`, permissions) | **Ready to Integrate** |
| `/admin/audit` | `AuditTrailPage` | `admin` | `adminService.ts` | **COMPLETE** (`GET /api/v1/audit-logs`) | **Ready to Integrate** |
| `/admin/settings` | `GeneralSettingsPage` | `admin` | `settingsService.ts` | **PARTIAL** (No runtime settings table; env driven) | Read-only / static |

*(For line-by-line interaction mapping of all 222 UI actions, refer to [ADMIN_DASHBOARD_ROUTE_AND_ACTION_MATRIX.md](../ADMIN_DASHBOARD_ROUTE_AND_ACTION_MATRIX.md)).*

---

## 5. Build Characteristics and Bundle Size Warning

Running `npm run build` in `zool-go-dashpoard` compiles successfully via `tsc -b && vite build`.
Output analysis:
- `dist/index.html`: `1.19 kB`
- `dist/assets/index-*.css`: `100.68 kB` (gzip: `20.81 kB`)
- `dist/assets/index-*.js`: **`2,426.09 kB` (gzip: `583.16 kB`)**

> [!WARNING]
> **Vite Bundle Chunk Warning (> 500 kB):**  
> Vite outputs a warning during build:  
> `(!) Some chunks are larger than 500 kB after minification.`  
> This is caused by importing large charting (`recharts`), mapping (`leaflet`), and icon (`lucide-react`) libraries into a single monolithic bundle without dynamic `React.lazy()` route splitting. Addressing this code-splitting debt is recommended during Milestone F.

---

## 6. Frontend Engineering Conventions to Preserve

When the receiving engineer begins Milestone F (Frontend Integration), the following architectural conventions must be preserved:

1. **Feature Module Boundaries:** Components belonging to a domain stay in `src/features/<domain>/components/`. Pages stay in `src/features/<domain>/pages/`. Only truly generic primitives live in `src/components/shared/`.
2. **Tactile Styling Tokens:** Maintain the visual design language (amber warning badges for low balance, emerald for confirmed transit tickets, physical button press styling via `TactileButton.tsx`).
3. **Money Formatting Helper:** Always use `formatMoney` or `formatSdg` from `src/lib/utils.ts`. During integration, wrap backend minor units (`amountMinor / 100`) at the service or query boundary before rendering.
4. **Thermal Ticket Paper Component:** Preserve `ThermalTicketPaper.tsx` for printing physical boarding passes. It formats barcodes, passenger names, trip departure times, and seat labels.

---

*Evidence citations:*
- Route definitions: `d:\zool-go\zool-go-dashpoard\src\app\router\index.tsx` L42–163
- Topbar hardcoded admin: `d:\zool-go\zool-go-dashpoard\src\app\shell\Topbar.tsx` L135–138
- Telemetry simulator: `d:\zool-go\zool-go-dashpoard\src\features\tracking\services\telemetrySimulator.ts` L1–65
- Vite build metrics: verified via `npm run build` command execution on 2026-11-19
