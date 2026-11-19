# Admin Dashboard Route and Action Matrix

Evidence-based frontend ↔ backend coverage for every meaningful Admin Dashboard interaction.

**Clarification (2026-10-23, Milestone A):** D-TOP-01 — M1 production enabled/usable top-up is **MANUAL receipt review** until a real PSP is integrated. Automatic remains architectural; mock confirm is non-production only. Original finding that Stitch queue-as-normal is SUPERSEDED is unchanged.

**Authority order:** `BACKEND_DECISION_REGISTER.md` → implemented Stage 1 / 2 / 2.6 contracts → `Zool/ZoolGo_Broker_Journey.pdf` → `BACKEND_REQUIREMENTS.md` → `REQUIREMENTS_AND_DECISIONS.md` → implemented admin frontend → Stitch / fixtures as proposals only.

**This document does not approve product policy.** A mock button is not a backend requirement.

## Coverage totals

Derived by counting matrix rows whose **Coverage** cell is exactly one of the eight allowed values. Denominator for “how much of the dashboard has real backend support” is defined in `ADMIN_DASHBOARD_BACKEND_GAP_AUDIT.md`.

Counted from data rows that end in `| P0 |`–`| P3 |` (header/legend tables excluded).

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
| **Total rows** | **222** |

Router inventory (`zool-go-dashpoard/src/app/router/index.tsx`): **30** reachable page routes, plus `/` → `/overview` and `*` → `/overview` redirects. Global shell is inventoried as route `(shell)`.

Mounted backend JSON operations (`zool-go-backend/src/app.ts`): **81** (including broker-principal and webhook routes). Admin-principal subset used by this dashboard: **50**.

---

## Classification rules used

| Value | Meaning |
|---|---|
| COMPLETE | Backend operation exists and satisfies the approved UI need. Frontend may still be unwired. |
| PARTIAL | Relevant backend capability exists; filters, fields, nested data, or side effects are incomplete. |
| CONTRACT_MISMATCH | Backend exists; names, enums, money units, or pagination differ. |
| MISSING | Approved behavior has no backend implementation. |
| PRODUCT_DECISION_REQUIRED | UI / Stitch / fixture proposes behavior without approved authority. Not missing engineering. |
| UI_ONLY | No backend needed (layout, tabs, navigation, print, client clock). |
| DEV_ONLY | Simulated latency, persona, state switcher, always-succeed gateway test. |
| OUT_OF_SCOPE | Customer, GPS production, carrier revenue settlement, exceptional credit, or other non-admin-M1 surface. |

Priority: **P0** financial/operational correctness · **P1** main admin workflows · **P2** reporting/productivity · **P3** proposals / deferred.

---

## (shell) AppShell / Sidebar / Topbar

| Admin route | Screen/interaction | Frontend source | Current data source | Expected operation | Existing backend API | Permission | Coverage | Missing part | Decision source | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| (shell) | Sidebar navigation | `src/app/shell/Sidebar.tsx`; `navigationConfig.ts` L15–45 | Hardcoded `navigationConfig` | Render nav | — | — | UI_ONLY | None | Implemented frontend | P3 |
| (shell) | Sidebar collapse / mobile menu | `AppShell.tsx` L8–16; `Sidebar.tsx` | Local React state | — | — | — | UI_ONLY | None | Implemented frontend | P3 |
| (shell) | Bookings nav badge `142` | `navigationConfig.ts` L21 | Hardcoded string | Count of bookings matching admin filters | `GET /api/v1/admin/bookings` meta.total | `bookings.view` | MISSING | Dedicated counter or reuse list `meta.total`; badge is fixture | D-ADMIN-BOOK-01; `bookings.routes.ts` L77–82 | P2 |
| (shell) | Brokers nav badge `14 تنبيه` | `navigationConfig.ts` L23 | Hardcoded | Count of low-balance offices | `GET /api/v1/brokers` + wallet `lowBalance` on `GET /admin/wallets/:officeId` | `brokers.view` / `wallets.view` | PARTIAL | No office-list flag for low-balance; per-office wallet only | D-POL-01; `wallets.service.ts` L66–73 | P2 |
| (shell) | Settlements nav badge `4 معلقة` | `navigationConfig.ts` L31 | Hardcoded | Count of DRAFT settlements | `GET /api/v1/admin/commissions/settlements?status=DRAFT` | `commissions.view` | MISSING | No dashboard counter; list meta can supply it | D-SET-01; `commissions.routes.ts` L35–39 | P2 |
| (shell) | Refunds nav badge `2 مراجعة` | `navigationConfig.ts` L32 | Hardcoded | Refund review queue count | None | — | PRODUCT_DECISION_REQUIRED | Broker cancel is wallet refund, not an admin refund queue | D-REF-01 | P3 |
| (shell) | Tracking live badge | `navigationConfig.ts` L20 | Hardcoded `مباشر` | Live fleet presence | None | — | PRODUCT_DECISION_REQUIRED | GPS vertical not approved | D-GPS-01 OPEN | P3 |
| (shell) | Global search (booking / broker / company) | `Topbar.tsx` L59–67 | Local `searchQuery`; no submit | Cross-entity search | None | — | MISSING | No global search API. Per-resource `q` exists on brokers only | `brokers.validation.ts`; `Topbar.tsx` L61 | P2 |
| (shell) | Connectivity pill | `Topbar.tsx` L70–74 | Hardcoded “مزامنة الخوادم: نشطة” | Health/readiness | `GET /api/v1/health`, `GET /api/v1/ready` | public | PARTIAL | APIs exist; UI does not call them | `health.routes.ts` L10–44 | P2 |
| (shell) | Date badge `24 أكتوبر 2024` | `Topbar.tsx` L80–83 | Frozen demo date | Client clock | — | — | DEV_ONLY | Frozen fixture date, not a backend clock | Implemented frontend | P3 |
| (shell) | Notifications inbox (static 4 items) | `Topbar.tsx` L85–118 | Hardcoded JSX | Notification list / mark-read | None | — | PRODUCT_DECISION_REQUIRED | No notification product decision; pending top-up/settlement counts are derivable without an inbox | Decision register (no D-NOTIF) | P3 |
| (shell) | Current admin display | `Topbar.tsx` L135–138 | Hardcoded “أحمد السر” | Current principal | `GET /api/v1/auth/me` | authenticated | COMPLETE | Frontend not wired; API exists | Stage 1; `auth.routes.ts` L71–75 | P1 |
| (shell) | Effective roles / permissions | `Topbar.tsx` L137 | Hardcoded Super Admin | Union of role permissions | `GET /api/v1/auth/me` | authenticated | COMPLETE | Frontend not wired | Stage 1 | P1 |
| (shell) | Profile settings alert | `Topbar.tsx` L140–143 | `alert(...)` | — | — | — | DEV_ONLY | Demo alert | Implemented frontend | P3 |
| (shell) | Security log alert | `Topbar.tsx` L144–147 | `alert(...)` | Session list | `GET /api/v1/sessions` | `sessions.view` | DEV_ONLY | Alert is demo; real sessions API is complete | Stage 1; `sessions.routes.ts` L13–24 | P3 |
| (shell) | Logout | `Topbar.tsx` L149–155 | `alert` “هوية محاكاة” | Invalidate refresh cookie | `POST /api/v1/auth/logout` | cookie | COMPLETE | Frontend not wired | Stage 1; `auth.routes.ts` L60–63 | P0 |
| (shell) | Admin OTP login | No route in `router/index.tsx` | Dashboard assumes logged-in persona | Request/verify OTP, cookies | `POST /api/v1/auth/otp/request`, `/otp/verify`, `/refresh` | public + rate limit | COMPLETE | **No login page** on the dashboard (frontend gap, not backend) | Stage 1; `auth.routes.ts` L41–57 | P0 |
| (shell) | Logout-all | Not in UI | — | Revoke own sessions | `POST /api/v1/auth/logout-all` | authenticated | COMPLETE | Not exposed in shell | `auth.routes.ts` L65–68 | P1 |

---

## `/overview`

| Admin route | Screen/interaction | Frontend source | Current data source | Expected operation | Existing backend API | Permission | Coverage | Missing part | Decision source | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| /overview | Date range filter | `OverviewPage.tsx` L17; `OverviewHeader` | `mockOverviewDataByPreset` | Aggregates by range | None admin; broker `GET /broker/reports/summary` is office-scoped | — | MISSING | Admin-scoped KPI aggregation over approved records | D-ACC-01 (records exist); no admin report API | P2 |
| /overview | Simulated state switcher | `OverviewPage.tsx` L18, L51–52 | `populated/loading/empty/error` | — | — | — | DEV_ONLY | Dev inspector | `overviewService.ts` L8–35 | P3 |
| /overview | Loading skeleton | `OverviewPage.tsx` L36–57 | Fake 350ms / infinite loading | HTTP in-flight | Any authenticated GET | — | UI_ONLY | Caused by pending HTTP | `overviewService.ts` L24 | P3 |
| /overview | Empty state | `OverviewPage.tsx` L65–74 | `mockEmptyOverviewData` | Empty aggregates | Missing admin KPI API | — | UI_ONLY | Return empty totals | `overviewService.ts` L30–32 | P3 |
| /overview | Error state | `OverviewPage.tsx` L58–64 | Thrown Error | 5xx envelope | Standard error handler | — | UI_ONLY | `{success:false}` envelope | `http-envelope.test.ts` | P3 |
| /overview | KPI: ticket/booking count | `OverviewMetricsRow` | Fixture `totalBookings` | Count CONFIRMED bookings in range | `GET /admin/bookings` (page, not aggregate) | `bookings.view` | PARTIAL | Can scan pages; no summary endpoint | D-ADMIN-BOOK-01 | P2 |
| /overview | KPI: revenue / GMV | `OverviewMetricsRow` | Fixture SDG floats | Sum `totalAmount` | Booking `totalAmountMinor` on list/get | `bookings.view` | PARTIAL | No admin sum; money must stay `*Minor` | D-CUR-01; `bookings.dto.ts` L34 | P2 |
| /overview | KPI: active fleet | `OverviewMetricsRow` | Fixture | Live vehicle count | None (no Vehicle model) | — | PRODUCT_DECISION_REQUIRED | Fleet/GPS not in M1 | D-GPS-01 OPEN | P3 |
| /overview | KPI: pending operations | `ImmediateActionsQueue` | Fixture queue | Compose pending top-ups + DRAFT settlements | `GET /admin/wallets/top-ups`, `GET /admin/commissions/settlements` | split keys | PARTIAL | No composed dashboard DTO | D-ADMIN-TOPUP-01; D-SET-01 | P2 |
| /overview | Wallet totals / float | `FinancialSeparationSummary` | Fixture; 88/12 insurance split | Sum office `balanceMinor` | Per-office `GET /admin/wallets/:officeId` | `wallets.view` | MISSING | No cross-office wallet list; insurance split is a fixture formula | D-ACC-01; `financialService.ts` L37–40 | P0 |
| /overview | Commission totals | `FinancialSeparationSummary` | Fixture | Sum UNSETTLED accruals | `GET /admin/commissions` | `commissions.view` | PARTIAL | Paginated list, no dashboard sum | D-COM-01 | P2 |
| /overview | Booking distribution charts | `BookingDistributionCharts` | Fixture | Series by channel/carrier | None admin | — | MISSING | Admin report series; customer channel is out of M1 | D-BOOK-01; D-PAY-01 | P2 |
| /overview | Recent bookings table | `RecentBookingsTable` | Overview fixture bookings | Latest bookings | `GET /admin/bookings` | `bookings.view` | CONTRACT_MISMATCH | Status/money/source fields differ | `booking.ts` vs `bookings.dto.ts` | P1 |
| /overview | Drill-down links | Overview components | Client routes | Navigation | — | — | UI_ONLY | None | Implemented frontend | P3 |
| /overview | Refresh | `OverviewHeader` `onRefresh` | Refetch fixtures | Re-fetch KPIs | Missing admin KPI API | — | MISSING | Same as date-range KPIs | — | P2 |

---

## `/tracking` and `/tracking/vehicles/:vehicleId`

| Admin route | Screen/interaction | Frontend source | Current data source | Expected operation | Existing backend API | Permission | Coverage | Missing part | Decision source | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| /tracking | Leaflet / OSM map canvas | `FleetMap.tsx` | Client map | Render map | — | — | UI_ONLY | Map chrome only | Implemented frontend | P3 |
| /tracking | Subscribe to moving markers | `LiveTrackingPage.tsx` L39; `telemetrySimulator.ts` `subscribe` L341 | In-memory simulator, `setInterval` | Telemetry stream | None | — | PRODUCT_DECISION_REQUIRED | Entire GPS vertical (ingest, Redis latest, WS, retention, provider) is OPEN | D-GPS-01 OPEN | P3 |
| /tracking | Vehicle list | `LiveTrackingPage.tsx` L93; `mockVehicles` | Fixtures | List vehicles on trips | None (no Vehicle/Driver models) | — | PRODUCT_DECISION_REQUIRED | Catalog has trips/seats only (`catalog.prisma`) | D-GPS-01; SCOPE-01 | P3 |
| /tracking | Search (bus / plate / driver / trip) | `LiveTrackingPage.tsx` L98–106 | Client filter | Server search | None | — | PRODUCT_DECISION_REQUIRED | Depends on vehicle domain | D-GPS-01 | P3 |
| /tracking | Carrier filter | `LiveTrackingPage.tsx` L108–111 | Client filter | Filter by company | `GET /carriers` exists for companies, not vehicles | `carriers.view` | PRODUCT_DECISION_REQUIRED | No vehicle-company assignment API | D-GPS-01 | P3 |
| /tracking | Corridor filter | `LiveTrackingPage.tsx` L114–116 | Client filter | Filter corridor | None | — | PRODUCT_DECISION_REQUIRED | Corridor is a UI concept | D-GPS-01 | P3 |
| /tracking | Operational / GPS status filters | `LiveTrackingPage.tsx` L119–127 | Simulated status | Stale/offline detection | None | — | PRODUCT_DECISION_REQUIRED | Ping frequency / stale policy not decided | D-GPS-01 | P3 |
| /tracking | Vehicle detail drawer | tracking drawer components | Fixtures + simulator | Vehicle snapshot | None | — | PRODUCT_DECISION_REQUIRED | Same GPS slice | D-GPS-01 | P3 |
| /tracking | Empty filtered overlay | `LiveTrackingPage.tsx` L208 | Client | Empty list | — | — | UI_ONLY | Client empty | Implemented frontend | P3 |
| /tracking/vehicles/:vehicleId | Full vehicle page | `VehicleDetailsPage.tsx` | `telemetryService.subscribe` + fixtures | Vehicle + trip + driver | None | — | PRODUCT_DECISION_REQUIRED | No vehicle page contract | D-GPS-01 | P3 |
| /tracking/vehicles/:vehicleId | Speed / heading / last update | `VehicleDetailsPage.tsx` | Simulator | Telemetry fields | None | — | PRODUCT_DECISION_REQUIRED | Provider + retention OPEN | D-GPS-01 | P3 |
| /tracking/vehicles/:vehicleId | Route history | vehicle page | Fixtures | Historical positions | None | — | PRODUCT_DECISION_REQUIRED | MySQL history not designed | D-GPS-01 | P3 |

---

## `/bookings`

| Admin route | Screen/interaction | Frontend source | Current data source | Expected operation | Existing backend API | Permission | Coverage | Missing part | Decision source | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| /bookings | List table | `BookingsListPage`; `bookingService.getBookings` L19 | `bookingFixtures.ts`; 150ms delay | Paginated booking list | `GET /api/v1/admin/bookings` | `bookings.view` | CONTRACT_MISMATCH | Frontend statuses `pending/on_route/completed`; money `totalAmount` major SDG; `source` customer vs broker | D-ADMIN-BOOK-01; `bookings.dto.ts` L18–47; `booking.ts` L1–7 | P0 |
| /bookings | Search (id / passenger / ticket / carrier) | `bookingService.ts` L26–52 | Client string match | Server search | Admin list: `officeId, employeeId, companyId, status, from, to` only | `bookings.view` | PARTIAL | No free-text passenger/ticket search | D-BOOK-01; `adminListBookingsQuerySchema` | P1 |
| /bookings | Source filter broker vs direct customer | `BookingsFiltersToolbar` | Fixture `direct_customer` \| `broker_office` | Channel filter | All persisted bookings are broker-office | `bookings.view` | OUT_OF_SCOPE | Direct-customer bookings are a different vertical | D-PAY-01 OPEN; SCOPE-01 | P3 |
| /bookings | Booking status filter | toolbar | `confirmed/pending/cancelled/on_route/completed` | Filter status | `status=CONFIRMED\|CANCELLED` | `bookings.view` | CONTRACT_MISMATCH | Enum mismatch; pending/on_route/completed not in Prisma `BookingStatus` | `booking.prisma` L1–4 | P0 |
| /bookings | Payment status filter | toolbar | `paid/pending_verification/refunded/failed` | Filter payment | No payment status on booking (wallet debit) | `bookings.view` | CONTRACT_MISMATCH | Broker path has no PSP at checkout | D-COM-01 | P1 |
| /bookings | Ticket issuance filter | toolbar | `issued/pending_issue/issue_failed/cancelled` | Filter tickets | Ticket `CONFIRMED\|CANCELLED` | `bookings.view` | CONTRACT_MISMATCH | Enum mismatch | `booking.prisma` TicketStatus | P1 |
| /bookings | Carrier filter | toolbar | Fixture carrierId | Filter company | `companyId` query | `bookings.view` | COMPLETE | Frontend name `carrierId` vs `companyId` (adapter) | D-BOOK-01 | P1 |
| /bookings | Broker office filter | toolbar | Fixture brokerId | Filter office | `officeId` query | `bookings.view` | COMPLETE | Name adapter `brokerId` → `officeId` | D-BOOK-01 | P1 |
| /bookings | Route filter | toolbar | Fixture routeId | Filter route | Trips have origin/destination, no Route entity | `bookings.view` | MISSING | No route id; would filter trip origin/destination or tripId | `catalog.prisma` Trip | P2 |
| /bookings | Date type booking_created vs trip_departure | `bookingService.ts` L89–128 | Hardcoded `2024-10-24` presets | Date range | `from`/`to` on list | `bookings.view` | PARTIAL | Need confirmed whether `from/to` is createdAt vs departureAt | D-BOOK-01 | P1 |
| /bookings | Sort | `bookingService.ts` L132–147 | Client sort | Stable server sort | Default createdAt desc in repository | `bookings.view` | PARTIAL | No `sortBy` query | pagination helper | P2 |
| /bookings | Pagination | `bookingService.ts` L153–156 | Client slice | `page`/`pageSize` | Yes, max 100 | `bookings.view` | COMPLETE | Envelope `meta` vs frontend `totalCount` | Stage 2.6 | P1 |
| /bookings | KPI cards | list page metrics | `mockInitialBookingsMetrics` | Aggregates | None | `bookings.view` | MISSING | Summary over filtered set | D-ADMIN-BOOK-01 | P2 |
| /bookings | CSV export | `bookingService.exportBookingsCsv` L178 | Current fixture page | Server-filtered export | None | — | MISSING | Client downloads unsynchronized fixtures; permission for export not catalogued | Implemented frontend; no `bookings.export` | P2 |
| /bookings | Row open details | `BookingsTable` | Client navigate | — | — | — | UI_ONLY | — | Implemented frontend | P3 |
| /bookings | Loading / empty / error | list hook | Fake latency | HTTP states | Standard envelopes | — | UI_ONLY | — | `bookingService.ts` L21 | P3 |

---

## `/bookings/:id` and `/bookings/:id/activity`

| Admin route | Screen/interaction | Frontend source | Current data source | Expected operation | Existing backend API | Permission | Coverage | Missing part | Decision source | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| /bookings/:id | Get booking | `useBooking` → `getBookingById` L169 | Fixtures | Get by id | `GET /api/v1/admin/bookings/:id` | `bookings.view` | CONTRACT_MISMATCH | `fullName` vs `name`; `totalAmountMinor` vs `totalAmount`; no QR/barcode/VIP class; no `source` | `bookings.dto.ts` L4–47; `booking.ts` | P0 |
| /bookings/:id | Tabs (overview/passengers/financials/tickets/activity) | `BookingDetailsPage.tsx` L14, L77 | Local tab state | — | — | — | UI_ONLY | — | Implemented frontend | P3 |
| /bookings/:id | Passenger list | details passengers tab | Fixture `Passenger` | Passengers + seats | Nested `passengers` + ticket `seatLabel` | `bookings.view` | PARTIAL | No `seatClass`/`passengerType`/`maskedNationalId` | `bookings.dto.ts` L40–45 | P1 |
| /bookings/:id | Ticket preview modal / demo QR | `TicketPreviewModal`; `IssuedTicket.isDemoQr` | Fixture QR | Secure ticket document | Broker `GET /broker/bookings/:id/tickets/:ticketNumber/pdf` | `broker.book` only | MISSING | **No admin ticket PDF route** | D-TICKET-01; `bookings.routes.ts` L65–69 vs admin L72–96 | P0 |
| /bookings/:id | `window.print()` | `BookingDetailsPage.tsx` L29–31 | Browser print | Print | PDF download preferred | — | UI_ONLY | Print of HTML is not the locked PDF artefact | D-TICKET-01 | P3 |
| /bookings/:id | WhatsApp / SMS dispatch | not a primary admin control; fixtures mention SMS | Fixture events | Dispatch | Broker dispatch rejects WhatsApp/SMS | — | OUT_OF_SCOPE | Disabled until provider selected | D-TICKET-01; Stage 2.6 tests | P3 |
| /bookings/:id | Financial ledger table on booking | `FinancialLedgerTable` | Fixture `FinancialLedgerEntry.amount` | Wallet + commission movements for booking | Wallet ledger by office; accrual on booking DTO `commissionStatus` | `wallets.view` / `commissions.view` | PARTIAL | No booking-scoped ledger API; GL legs are proposals | D-ACC-01 | P1 |
| /bookings/:id | Broker financial hero | `BrokerFinancialSeparationHero` | Fixture percents | Show debit + accrual | `totalAmountMinor`, `commissionAmountMinor` | `bookings.view` | CONTRACT_MISMATCH | Major-unit SDG vs `*Minor` | D-CUR-01 | P0 |
| /bookings/:id | Direct-customer section | `CustomerBookingSection` | Fixture `customerMeta` | Customer identity / Bankak | None | — | OUT_OF_SCOPE | Customer vertical | D-PAY-01 | P3 |
| /bookings/:id | Admin cancel | **No mutate in `bookingService`** | Read-only mock | Cancel + wallet refund + clawback | `POST /api/v1/admin/bookings/:id/cancel` `{reason}` | `bookings.cancel` | COMPLETE | UI does not call it; backend is implemented and tested | D-ADMIN-BOOK-01; `bookings.routes.ts` L91–96 | P0 |
| /bookings/:id | Override passenger/seat/fare | none in service | — | Forbidden in M1 | `bookings.override` catalogued, **no route** | `bookings.override` | PRODUCT_DECISION_REQUIRED | Reserved unimplemented — do not build | D-ADMIN-BOOK-01 | P3 |
| /bookings/:id | Activity timeline | `BookingActivityTimeline` | Fixture events | Timeline | `GET /audit-logs` (admin actor only, `actorAdminId` filter) | `audit.view` | PARTIAL | No `resourceType=booking&resourceId=`; broker employee actions not in admin audit table | `audit.validation.ts` L3–7; `audit.prisma` | P1 |
| /bookings/:id | Loading / not found | `BookingDetailsPage.tsx` L33–60 | Null fixture | 404 envelope | `GET` 404 | `bookings.view` | UI_ONLY | Map 404 | Stage 2 | P3 |
| /bookings/:id/activity | Dedicated activity page | `BookingActivityPage` | Same fixtures | Same as timeline | Same audit gap | `audit.view` | PARTIAL | Same as timeline | D-ADMIN-BOOK-01 | P1 |

---

## `/companies` and `/companies/:id`

| Admin route | Screen/interaction | Frontend source | Current data source | Expected operation | Existing backend API | Permission | Coverage | Missing part | Decision source | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| /companies | List | `carrierService.getCarriers` L20 | `carrierFixtures`; 120ms | Paginated companies | `GET /api/v1/carriers` | `carriers.view` | CONTRACT_MISMATCH | Backend `{id,key,name,status}`; UI commercial name, city, fleet, GPS, punctuality | `carrier.prisma` L6–18; `carriers.routes.ts` L22–26 | P1 |
| /companies | Search | `carrierService.ts` L25–34 | Client | `q` search | List has `status` + pagination only | `carriers.view` | PARTIAL | No `q` on carriers | `listCarriersQuerySchema` | P1 |
| /companies | Status filter | toolbar | `under_review` and others | Filter | `ACTIVE\|SUSPENDED` | `carriers.view` | CONTRACT_MISMATCH | Enum mismatch | `TransportCompanyStatus` | P1 |
| /companies | State / city / active-trips / linked-brokers filters | `carrierService.ts` L41–51 | Client | Extra filters | None | `carriers.view` | MISSING | No city/trips/broker-count on company | `carrier.prisma` | P2 |
| /companies | Sort fleet/routes | `carrierService.ts` L55–68 | Client | Server sort | Default unspecified | `carriers.view` | PARTIAL | No sort query; fleet/routes not persisted | `carrier.prisma` | P2 |
| /companies | Pagination | L75–79 | Client slice | page/pageSize | Yes | `carriers.view` | COMPLETE | — | Stage 2 | P1 |
| /companies | Metrics cards | list page | `mockCarriersMetrics` | Aggregates | None | `carriers.view` | MISSING | No company KPI API | — | P2 |
| /companies | Create company | `addCarrier` L96 | In-memory | Create | `POST /api/v1/carriers` `{key,name}` | `carriers.manage` | PARTIAL | UI sends commercial registration, city, fleet; backend stores key+name+status only | `createCarrierSchema`; `addCarrier` L96–141 | P1 |
| /companies | CSV export | `exportCarriersCsv` L181 | Fixtures | Server export | None | — | MISSING | Client-only | — | P2 |
| /companies/:id | Get by id | `getCarrierById` L88 | Fixtures | Get company | **No** `GET /carriers/:id` | `carriers.view` | MISSING | List-only; detail must be synthesized or new GET | `carriers.routes.ts` L15–27 | P1 |
| /companies/:id | Update profile | not in service except assign | — | Patch name/status | No PATCH | `carriers.manage` | MISSING | No update route | `carriers.routes.ts` | P1 |
| /companies/:id | Suspend / activate | UI status labels | Fixture status | Patch status | No PATCH | `carriers.manage` | MISSING | Status enum exists on model but no mutation route | `carrier.prisma` L1–4 | P1 |
| /companies/:id | Routes tab | carrier details | Fixture routes | Route catalog | Trip origin/destination only | `catalog.manage` | PRODUCT_DECISION_REQUIRED | Persistent Route entity not approved | Catalog is trips, not named routes | P3 |
| /companies/:id | Trips tab | details | Fixture trips | List trips for company | `GET /api/v1/catalog/trips` | `catalog.manage` | PARTIAL | Admin list exists; no get-by-id for admin; UI fields (vehicle, driver) missing | `catalog.routes.ts` L32–37 | P1 |
| /companies/:id | Create / patch trip / append seats | not clearly a primary button set | — | Catalog mutations | `POST /catalog/trips`, `PATCH /catalog/trips/:tripId`, `POST .../seats` | `catalog.manage` | COMPLETE | Frontend carrier page does not call them | Stage 2.5; `catalog.routes.ts` L25–50 | P1 |
| /companies/:id | Vehicles tab | details | Fixture fleet | Vehicle CRUD | None | — | PRODUCT_DECISION_REQUIRED | No Vehicle model | D-GPS-01 / catalog scope | P3 |
| /companies/:id | Drivers tab | details | Fixture drivers | Driver CRUD | None | — | PRODUCT_DECISION_REQUIRED | No Driver model | same | P3 |
| /companies/:id | Staff tab | details | Fixture contacts | Carrier staff | None | — | PRODUCT_DECISION_REQUIRED | Contacts are UI-only | — | P3 |
| /companies/:id | Assign broker + commission % | `assignBrokerToCarrier` L143 | Mutates carrier fixture only, not broker fixture | Replace office assignments | `PUT /api/v1/brokers/:officeId/carriers` | `brokers.manage` | PARTIAL | Authority is **office → carriers**, not carrier → brokers; mock does not sync `brokerService` | D-RATE-01; `brokers.routes.ts` L45–49 | P0 |
| /companies/:id | Documents / license | fixture docs | Fixture | File store | Top-up evidence storage only | — | PRODUCT_DECISION_REQUIRED | Carrier KYC documents not approved | — | P3 |
| /companies/:id | Operational / financial stats | details | Fixture punctuality, GMV | Stats | None | — | PRODUCT_DECISION_REQUIRED | Carrier take-rate/settlement out of M1 | D-REV-01 | P3 |

---

## `/brokers` and `/brokers/:id`

| Admin route | Screen/interaction | Frontend source | Current data source | Expected operation | Existing backend API | Permission | Coverage | Missing part | Decision source | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| /brokers | List offices | `brokerService.getBrokers` L19 | `brokerFixtures`; 120ms | Paginated offices | `GET /api/v1/brokers` | `brokers.view` | CONTRACT_MISMATCH | UI `walletBalance` major SDG, city, clerksCount, todaySales; API `balanceMinor`, policy fields, no city | `brokers.dto.ts` L46–67 | P0 |
| /brokers | Search | L24–33 | Client | `q` | `q` on list | `brokers.view` | COMPLETE | Search fields differ (branch/manager vs code/name) | `brokers.service.ts` L23–39 | P1 |
| /brokers | Status filter | L35–41 | `low_balance` pseudo-status | Filter ACTIVE/SUSPENDED | `status` query | `brokers.view` | PARTIAL | `low_balance` is not an office status | D-POL-01 | P1 |
| /brokers | State / carrier filters | L44–52 | Client | Extra filters | None | `brokers.view` | MISSING | No state; carrier filter would need assignment join | — | P2 |
| /brokers | Sort wallet/sales/clerks | L55–70 | Client | Server sort | Default unspecified | `brokers.view` | PARTIAL | todaySales not a stored field | — | P2 |
| /brokers | Pagination | L75–78 | Client | page/pageSize | Yes | `brokers.view` | COMPLETE | — | Stage 2 | P1 |
| /brokers | Metrics | list | `mockBrokersMetrics` | Aggregates | None | `brokers.view` | MISSING | — | — | P2 |
| /brokers | Create office | `addBroker` L96 | In-memory random code | Create office + manager | `POST /api/v1/brokers` | `brokers.manage` | CONTRACT_MISMATCH | Request/response fields and money units | `brokers.routes.ts` L24–28 | P1 |
| /brokers | CSV | `exportBrokersCsv` L147 | Fixtures | Export | None | — | MISSING | Client-only | — | P2 |
| /brokers/:id | Get office | `getBrokerById` L88 | Fixtures | Detail + employees + assignments | `GET /api/v1/brokers/:officeId` | `brokers.view` | CONTRACT_MISMATCH | Nested employees/carriers exist; UI extra POS, city, todaySales | `toOfficeDetailDto` L70–80 | P0 |
| /brokers/:id | Suspend / activate | UI status | Fixture | Patch status + revoke broker sessions | `PATCH /api/v1/brokers/:officeId/status` | `brokers.manage` | COMPLETE | Side effects: office SUSPENDED blocks **all** broker API including history (`authenticate-broker.ts` L36–38). Remaining ops policy OPEN | D-SUS-01 OPEN; `brokers.service.ts` L181–207 | P0 |
| /brokers/:id | Replace assigned carriers + % | UI assignment | Fixture `carrierLinks` | PUT assignments | `PUT /api/v1/brokers/:officeId/carriers` | `brokers.manage` | COMPLETE | Frontend field names | D-RATE-01 | P0 |
| /brokers/:id | Policy overrides (min top-up, exposure, low-balance, TZ, settlement period) | settings-like fields on office | Fixture thresholds in major SDG | Patch policy | `PATCH /api/v1/brokers/:officeId` | `brokers.manage` | CONTRACT_MISMATCH | `*Minor` + IANA TZ vs UI major units | D-POL-01; `brokers.service.ts` L211 | P0 |
| /brokers/:id | Wallet balance display | office fixture `walletBalance` | Separate from `financialService` | Get wallet | Nested `wallet.balanceMinor` or `GET /admin/wallets/:officeId` | `wallets.view` | CONTRACT_MISMATCH | Major vs minor; mock `topUpBrokerWallet` does not update financial fixtures | D-CUR-01; `brokerService.ts` L117–145 | P0 |
| /brokers/:id | Exceptional wallet credit modal | `topUpBrokerWallet` L117 | Immediate credit, no intent | Forbidden free credit | Unauthorized | — | OUT_OF_SCOPE | Conflicts with PDF; do not implement | D-ADJ-01 OUT OF SCOPE | P0 |
| /brokers/:id | Admin-initiated evidence top-up | not the same as exceptional credit | — | Create MANUAL_FALLBACK intent | `POST /api/v1/admin/wallets/:officeId/top-ups` multipart | `wallets.topups.create_for_office` | COMPLETE | UI currently credits immediately instead of this flow | D-ADMIN-TOPUP-01 | P0 |
| /brokers/:id | Employees read | office clerks | Fixture clerks | Nested employees | Included on GET office | `brokers.view` | COMPLETE | Field names (`displayName` vs clerk) | `brokers.dto.ts` L7–43 | P1 |
| /brokers/:id | Employee create / patch / suspend | no admin service method | — | Admin staff CRUD | Broker-principal ` /broker/staff` only | `broker.staff.manage` | MISSING | Admin cannot manage office staff | D-AUTH-BROKER; `broker-staff.routes.ts` | P1 |
| /brokers/:id | Booking history tab | details | Fixture | List by office | `GET /admin/bookings?officeId=` | `bookings.view` | CONTRACT_MISMATCH | Same booking contract gaps | D-BOOK-01 | P1 |
| /brokers/:id | Top-up history | details | Fixture ledger | List intents | `GET /admin/wallets/top-ups` (office filter if present) | `wallets.topups.view` | PARTIAL | Confirm query filter vs UI; money units | D-ADMIN-TOPUP-01 | P1 |
| /brokers/:id | Accruals / last settlement | details | Fixture | Accruals + `lastSettledAt` | `GET /admin/commissions?officeId=`; office `lastSettledAt` | `commissions.view` / `brokers.view` | COMPLETE | Adapter for `*Minor` and dates | D-SET-01; D-COM-01 | P1 |
| /brokers/:id | Settlement history | details | Fixture | List settlements | `GET /admin/commissions/settlements?officeId=` | `commissions.view` | CONTRACT_MISMATCH | UI batch/Bankak vs DRAFT/RESERVED/FINALIZED | D-SET-01 | P1 |
| /brokers/:id | Audit trail | details | Fixture | Resource-filtered audit | `GET /audit-logs?actorAdminId=` only | `audit.view` | PARTIAL | Indexes exist on `resourceType/resourceId` but query schema omits them | `audit.prisma` L16–18; `audit.validation.ts` | P1 |

---

## `/travelers` and `/travelers/:id`

| Admin route | Screen/interaction | Frontend source | Current data source | Expected operation | Existing backend API | Permission | Coverage | Missing part | Decision source | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| /travelers | List / KPIs / search / filters | `travelerService.getTravelers` L49 | `travelerFixtures` | Customer CRM | None | — | OUT_OF_SCOPE | Admin screens ≠ customer app backend | SCOPE-01; D-PAY-01 | P3 |
| /travelers | CSV export | `exportTravelersCsv` L257 | Fixtures; `toFixed(2)` money | Export customers | None | — | OUT_OF_SCOPE | Floating money also violates D-CUR-01 if ever built | D-CUR-01 | P3 |
| /travelers/:id | Profile | `getTravelerById` | Fixtures | Customer identity | Booking passengers are PII snapshots only | `bookings.view` | OUT_OF_SCOPE | Passenger on booking ≠ registered traveler | D-AUTH-BROKER (traveler is booking PII) | P3 |
| /travelers/:id | Trip history | `getTravelerTrips` | Fixtures | Customer bookings | None by customer id | — | OUT_OF_SCOPE | — | — | P3 |
| /travelers/:id | KYC approve/reject | `verifyTravelerKyc` L164 | In-memory | KYC workflow | None | — | PRODUCT_DECISION_REQUIRED | No customer KYC decision | — | P3 |
| /travelers/:id | Suspend account | `updateAccountStatus` L200 | In-memory; does not kill sessions | Customer suspend | None | — | PRODUCT_DECISION_REQUIRED | Mock does not revoke sessions | `travelerService.ts` L200–227 | P3 |
| /travelers/:id | Terminate device session | `terminateSession` L133 | In-memory | Session revoke | Admin sessions API is for **admins**, not travelers | `sessions.revoke` (admin) | OUT_OF_SCOPE | Wrong principal | Stage 1 sessions | P3 |
| /travelers/:id | Notes | `addTravelerNote` L229 | In-memory | CRM notes | None | — | PRODUCT_DECISION_REQUIRED | — | — | P3 |
| /travelers/:id | Wallet / reward points | traveler type fields | Fixture `walletBalanceSdg` floats | Customer wallet | Broker wallets only | — | OUT_OF_SCOPE | — | D-ACC-01 | P3 |

---

## `/financials/wallets`, ledger, top-up queue

| Admin route | Screen/interaction | Frontend source | Current data source | Expected operation | Existing backend API | Permission | Coverage | Missing part | Decision source | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| /financials/wallets | List all office wallets | `financialService.getWallets` L45 | `mockBrokerWallets` (AG-882 copy 1) | Cross-office wallet list | **No list**; only `GET /admin/wallets/:officeId` | `wallets.view` | MISSING | Required for this screen | D-ACC-01; `wallets.routes.ts` L31–36 | P0 |
| /financials/wallets | Liquidity metrics / 88–12 split | `getWalletsMetrics` L25 | Fixture formula | Platform float | None | `wallets.view` | PRODUCT_DECISION_REQUIRED | Insurance/reserve split is a fixture, not policy | `financialService.ts` L37–40 | P3 |
| /financials/wallets | Filters (status/tier/state/search) | L54–75 | Client | Server filters | None on a list API | `wallets.view` | MISSING | Depends on list API | — | P1 |
| /financials/wallets | Exceptional deposit modal | `recordTopUp` L106; `WalletDepositModal` | Immediate credit + fake GL legs | Free admin credit | Unauthorized | — | OUT_OF_SCOPE | Same as D-ADJ-01 | D-ADJ-01 | P0 |
| /financials/wallets | CSV | `exportWalletsCsv` L293 | Fixtures | Export | None | — | MISSING | — | — | P2 |
| /financials/ledger | General ledger list | `getLedgerEntries` L201 | `mockLedgerEntries` (AG-882 copy 2) | CoA / journals | Wallet ledger is **not** a GL | `wallets.view` | PRODUCT_DECISION_REQUIRED | Full GL deferred | D-ACC-01 LOCKED deferred | P3 |
| /financials/ledger | Filters / CSV / metrics | ledger toolbar | Fixtures | GL query | None | — | PRODUCT_DECISION_REQUIRED | — | D-ACC-01 | P3 |
| /financials/ledger/:id | Journal double-entry | `DoubleEntryBreakdownCard` | Fixture legs | Journal get | None | — | PRODUCT_DECISION_REQUIRED | — | D-ACC-01 | P3 |
| /financials/wallets | Immutable wallet statement (approved need) | UI mixes GL with wallet | Separate store | Paginated wallet ledger | Included in `GET /admin/wallets/:officeId` | `wallets.view` | CONTRACT_MISMATCH | Exists per office; UI wants platform GL; `amountMinor` vs `amountSdg` | `wallets.service.ts` L14–23, L77 | P0 |
| /financials/topup-queue | List review queue | `getTopUpQueue` L251 | `mockTopUpQueue` | List PENDING_REVIEW | `GET /api/v1/admin/wallets/top-ups` | `wallets.topups.view` or `.review` | CONTRACT_MISMATCH | Stitch queue-as-normal is SUPERSEDED; **M1 production enabled path is MANUAL** until a real PSP; automatic remains architectural; money units | D-TOP-01 clarification 2026-10-23; D-ADMIN-TOPUP-01; `payments.routes.ts` L62–67 | P0 |
| /financials/topup-queue | Approve | `approveTopUpRequest` L255 | Credits `walletsState` only | Approve without amount | `POST /admin/wallets/top-ups/:intentId/approve` | `wallets.topups.approve` | COMPLETE | Mock amount editable vs API forbids amount; mock does not share broker fixture | D-ADMIN-TOPUP-01 | P0 |
| /financials/topup-queue | Reject | `rejectTopUpRequest` L279 | Status only | Reject + note | `POST .../reject` | `wallets.topups.reject` | COMPLETE | — | D-ADMIN-TOPUP-01 | P0 |
| /financials/topup-queue | View/download evidence | queue UI | Fixture receipt | Signed download | `GET .../top-ups/:intentId/evidence` | `wallets.topups.evidence.view` | COMPLETE | Frontend not wired | D-ADMIN-TOPUP-01; `payments.routes.ts` L92–97 | P0 |
| /financials/topup-queue | Create intent for office | not clearly separated from deposit modal | — | Multipart create | `POST /admin/wallets/:officeId/top-ups` | `wallets.topups.create_for_office` | COMPLETE | UI deposit modal is exceptional credit, not this | D-ADMIN-TOPUP-01 | P0 |

---

## `/financials/settlements`

| Admin route | Screen/interaction | Frontend source | Current data source | Expected operation | Existing backend API | Permission | Coverage | Missing part | Decision source | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| /financials/settlements | Accrual list | `getBrokerItems` L160 | `initialBrokerItems` | List accruals | `GET /api/v1/admin/commissions` | `commissions.view` | CONTRACT_MISMATCH | Status/money names; UI mixes carrier+broker | D-COM-01; `commissions.routes.ts` L70–75 | P0 |
| /financials/settlements | Settlement batch list | `getBatches` L26 | `initialSettlementBatches` `pending_approval/draft` | List settlements | `GET /admin/commissions/settlements` | `commissions.view` | CONTRACT_MISMATCH | Status `DRAFT/FINALIZED/CANCELLED` vs UI pending_approval; Bankak target | D-SET-01 | P0 |
| /financials/settlements | Create draft / reserve accruals | UI approval drawer invents batch | — | POST draft | `POST /admin/commissions/settlements` | `commissions.payout` | COMPLETE | UI does not send `officeId/periodFrom/periodTo` | D-SET-01; `createSettlementSchema` | P0 |
| /financials/settlements | Get settlement | `getBatchDetails` L70 | Fixture batch | Get by id | `GET /admin/commissions/settlements/:id` | `commissions.view` | PARTIAL | DTO has `accrualCount` but **no accrual line items** (`toSettlementDto` L40–59) | D-SET-01 | P0 |
| /financials/settlements | Finalize + payout evidence | `approveAndDisburseBatch` L74 | Disburses Bankak + credits wallet | Finalize | `POST .../finalize` `{payoutReference,note}` | `commissions.payout` | CONTRACT_MISMATCH | **Finalize must not touch wallet** (Stage 2 test); UI credits wallet | D-SET-01; `stage2-broker.test.ts` settlement case | P0 |
| /financials/settlements | Cancel draft / release accruals | not mirrored in mock (disburse-only) | — | Cancel | `POST .../cancel` | `commissions.payout` | COMPLETE | UI missing cancel vs disburse | D-SET-01 | P0 |
| /financials/settlements | `creditCommissionToBrokerWallet` | `settlementService.ts` L118 | Credits fixture wallet | Not approved | None (and must not) | — | OUT_OF_SCOPE | Conflicts with D-SET-01 / D-COM-01 payout semantics | D-SET-01 | P0 |
| /financials/settlements | Carrier payouts tab | `disburseCarrierPayout` L146; `CarrierPayoutsTable` | Fixtures | Carrier settlement | None | — | OUT_OF_SCOPE | Carrier revenue share | D-REV-01 OUT OF SCOPE | P3 |
| /financials/settlements | Bankak CSV | `exportBatchBankakCsv` L164 | Fixtures | Payout file | `payoutReference` string only | `commissions.payout` | PRODUCT_DECISION_REQUIRED | File format / bank integration not decided | D-SET-01 (evidence string exists) | P3 |
| /financials/settlements | Summary CSV | `exportSettlementsSummaryCsv` L205 | Fixtures | Export | None | — | MISSING | Server export of settlement list | D-SET-01 | P2 |
| /financials/settlements | Metrics cards | `SettlementsMetricsCards` | Fixture pending sums | Sum DRAFT totals | List meta + `totalAmountMinor` | `commissions.view` | PARTIAL | No summary DTO | D-SET-01 | P2 |

---

## `/refunds/*`

| Admin route | Screen/interaction | Frontend source | Current data source | Expected operation | Existing backend API | Permission | Coverage | Missing part | Decision source | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| /refunds/queue | Refund review queue | `refundService.getQueue` L22 | `refundsFixtures` | Separate refund cases | Broker/admin **cancel** already refunds wallet + clawback | `bookings.cancel` | PRODUCT_DECISION_REQUIRED | Queue + % override is not the locked broker path | D-REF-01 | P3 |
| /refunds/queue | Manual override drawer | `executeManualOverride` L70 | Updates refund fixtures only — **not** bookings/wallets (`postLedger` unused) | Override | `bookings.override` reserved, no route | `bookings.override` | PRODUCT_DECISION_REQUIRED | Do not implement as M1; mock is split-brain | D-ADMIN-BOOK-01; D-REF-01 | P3 |
| /refunds/queue | CSV | `exportRefundsCsv` L214 | Fixtures | Export | None | — | PRODUCT_DECISION_REQUIRED | — | D-REF-01 | P3 |
| /refunds/policies | Time-tier % cards | `getPolicyTiers` / `updatePolicyTier` | Fixture percentages | Retention matrix | None | — | PRODUCT_DECISION_REQUIRED | PDF silent on %; do not invent | D-REF-01 LOCKED | P3 |
| /refunds/policies | Carrier fault rules | `toggleCarrierFaultRule` L207 | Fixture | Fault policy | None | — | PRODUCT_DECISION_REQUIRED | — | D-REF-01 | P3 |
| /refunds/disputes/:ticketId | Dispute dossier | `DisputeDossierPage`; `submitDisputeDecision` L149 | Fixtures | Dispute case | None | — | PRODUCT_DECISION_REQUIRED | — | Stitch proposal | P3 |
| /refunds/* | Broker cancel already implemented | (not this UI) | — | Cancel → wallet CREDIT_REFUND + CLAWED_BACK | `POST /admin/bookings/:id/cancel` | `bookings.cancel` | COMPLETE | Refund **queue UI** is not that operation | D-REF-01; D-ADMIN-BOOK-01 | P0 |

---

## `/reports/*`

| Admin route | Screen/interaction | Frontend source | Current data source | Expected operation | Existing backend API | Permission | Coverage | Missing part | Decision source | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| /reports | Financial dashboard / charts | `getDashboardMetrics` L23 | Frozen fixtures | Admin reports | Broker-only `GET /broker/reports/*` | `broker.reports.view` | MISSING | No admin report routes; broker reports are office-scoped | `reports.routes.ts` L9–37 | P2 |
| /reports | Channel mix including direct customer | `SalesChannelDonutChart` | Fixture | Channel series | Customer channel out of M1 | — | OUT_OF_SCOPE | — | D-PAY-01 | P3 |
| /reports | Filters quarter/state/carrier | `FinancialReportsPage` | Client tweaks fixture | Filters | None admin | — | MISSING | — | — | P2 |
| /reports/trial-balance | Trial balance table | `getTrialBalance` L46 | Frozen TB; `isBalanced` float compare | CoA TB | None | — | PRODUCT_DECISION_REQUIRED | Full GL deferred | D-ACC-01 | P3 |
| /reports/trial-balance | CSV | `exportTrialBalanceCsv` L119 | Fixtures | Export TB | None | — | PRODUCT_DECISION_REQUIRED | — | D-ACC-01 | P3 |
| /reports/carrier-shares | Carrier share chart/table | `getCarrierShares` L68 | Fixture platform take-rate | Carrier settlement report | None | — | OUT_OF_SCOPE | — | D-REV-01 | P3 |
| /reports/carrier-shares | CSV | `exportCarrierSharesCsv` L164 | Fixtures | Export | None | — | OUT_OF_SCOPE | — | D-REV-01 | P3 |
| /reports/export-center | Catalog + fake jobs | `triggerReportExport` L94 | `setTimeout` history | Async export jobs | None | — | PRODUCT_DECISION_REQUIRED | Job system not decided; some CSV could be sync P2 | Stitch `_29` | P3 |
| /reports/export-center | Export history | `getExportHistory` L90 | Fixture | Job list | None | — | PRODUCT_DECISION_REQUIRED | — | — | P3 |

---

## `/admin/team`, `/admin/team/:id`, `/admin/roles`

| Admin route | Screen/interaction | Frontend source | Current data source | Expected operation | Existing backend API | Permission | Coverage | Missing part | Decision source | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| /admin/team | List admins | `getAdminTeam` L28 | `adminFixtures` | Paginated admins | `GET /api/v1/admins` | `admins.view` | CONTRACT_MISMATCH | UI status `online/restricted/leave`; department; email; 2FA; API `ACTIVE/SUSPENDED`, phone identity | `admin.ts` L8–63; `admins.service.ts` L15–36 | P1 |
| /admin/team | Filters search/role/status/dept | L31–53 | Client | Query filters | `page/pageSize` only | `admins.view` | PARTIAL | `listAdminsQuerySchema` L22–25 | Stage 1 | P2 |
| /admin/team | Metrics (2FA %, online now) | L55–71 | Fixture + `Math.max(..., 7)` | Aggregates | None | `admins.view` | PRODUCT_DECISION_REQUIRED | 2FA strength OPEN; “online” not a stored status | D-AUTH-01 OPEN | P3 |
| /admin/team | Invite admin | `inviteAdminUser` L172 | In-memory email invite | Create admin + phone + roles | `POST /api/v1/admins` | `admins.create` | CONTRACT_MISMATCH | Phone OTP identity, not email invite | `createAdminSchema`; D-AUTH-01 | P1 |
| /admin/team | Freeze / unfreeze | `freezeAdminAccount` L129 | In-memory | Patch status | `PATCH /admins/:adminId/status` | `admins.suspend` | COMPLETE | Enum adapter; backend also bumps authz + sessions (Stage 1 tests) | Stage 1; `admins.routes.ts` L40–45 | P0 |
| /admin/team | CSV | `exportAdminTeamCsv` L281 | Fixtures | Export | None | — | MISSING | — | — | P2 |
| /admin/team/:id | Get admin | `getAdminUser` L76 | Fixtures | Get | `GET /admins/:adminId` | `admins.view` | CONTRACT_MISMATCH | Extra UI fields | `admins.routes.ts` L33–37 | P1 |
| /admin/team/:id | Update profile (name/phone/email) | `updateAdminUser` L80 | In-memory | Patch admin | **No route**; `admins.update` catalog only | `admins.update` | MISSING | Permission exists, unused | `permissions.ts` L4; no PATCH profile | P1 |
| /admin/team/:id | Assign roles (multi) | UI | Fixture single `roleId` | Replace roles | `PUT /admins/:adminId/roles` | `roles.assign` | CONTRACT_MISMATCH | UI one role vs API `roleIds[]` | Stage 1; D-AUTH multiple roles tested | P0 |
| /admin/team/:id | List sessions | nested `activeSessions` | Fixture device/IP | List sessions | `GET /api/v1/sessions?adminId=` | `sessions.view` | CONTRACT_MISMATCH | Field names (device/os vs stored session) | `sessions.routes.ts` L13–24 | P1 |
| /admin/team/:id | Revoke one session | `terminateAdminSession` L111 | In-memory | Revoke | `DELETE /sessions/:sessionId` | `sessions.revoke` | COMPLETE | — | Stage 1 | P0 |
| /admin/team/:id | Revoke all for user | `terminateAllAdminSessions` L122 | In-memory | Revoke others | `POST /auth/logout-all` is **self** only | `sessions.revoke` | PARTIAL | No admin-initiated revoke-all-by-adminId | `auth.routes.ts` L65–68 | P1 |
| /admin/team/:id | Nested audit | `auditTrail` on user | Fixture hashes | Filter audit by actor | `GET /audit-logs?actorAdminId=` | `audit.view` | PARTIAL | No before/after drawer; metadata JSON only | `audit.prisma` | P1 |
| /admin/team/:id | 2FA / IP whitelist / password days | admin type | Fixture | 2FA policy | OTP already used for login; 2FA OPEN | — | PRODUCT_DECISION_REQUIRED | — | D-AUTH-01 OPEN | P3 |
| /admin/roles | List roles | `getRoleArchetypes` L229 | Fixture archetypes | List | `GET /api/v1/roles` | `roles.view` | CONTRACT_MISMATCH | Archetype cards vs `{key,name,permissions}` | `roles.routes.ts` L18–21 | P1 |
| /admin/roles | Create / update / delete role | `createRoleArchetype` L233 | In-memory | CRUD | `POST/PATCH/DELETE /roles/:roleId` | `roles.create/update/delete` | COMPLETE | System role protection is backend; UI must not delete super_admin | Stage 1 tests lockout | P0 |
| /admin/roles | Permission catalog | `getRbacMatrix` L262 | Fixture matrix columns per archetype | List keys | `GET /api/v1/permissions` | `permissions.view` | CONTRACT_MISMATCH | Fixture keys ≠ `PERMISSION_CATALOG` | `permissions.ts` L1–33 | P0 |
| /admin/roles | Assign permissions to role | `updateRbacPermission` L266 | Mutates fixture boolean columns | Replace keys | `PUT /roles/:roleId/permissions` | `permissions.assign` | COMPLETE | Adapter from matrix cells to key array | Stage 1 | P0 |
| /admin/roles | SoD / financial cap on role | `RoleArchetype.financialApprovalCapSdg` | Fixture | SoD policy | None | — | PRODUCT_DECISION_REQUIRED | Not in Stage 1 model | Stitch | P3 |

---

## `/admin/audit`

| Admin route | Screen/interaction | Frontend source | Current data source | Expected operation | Existing backend API | Permission | Coverage | Missing part | Decision source | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| /admin/audit | List | `AuditTrailPage` via `adminService` fixtures | Fixtures | Paginated audit | `GET /api/v1/audit-logs` | `audit.view` | PARTIAL | Query only `page/pageSize/actorAdminId` | `audit.routes.ts` L11–16; `audit.validation.ts` | P1 |
| /admin/audit | Filter action / entity / date / requestId | page filters | Client | Matching query params | Columns+indexes exist | `audit.view` | MISSING | Schema not exposed on query | `audit.prisma` L16–19 | P1 |
| /admin/audit | Detail drawer before/after | page | Fixture | Get by id | No GET by id | `audit.view` | PARTIAL | `metadataJson` on list rows may suffice if returned | `audit.prisma` L10–11 | P2 |
| /admin/audit | IP / user-agent | UI if shown | Fixture | Fields on row | Model has `ipAddress`, `userAgent` | `audit.view` | PARTIAL | Confirm DTO exposes them | `audit.prisma` L8–9 | P2 |
| /admin/audit | Export | page | Fixture | Export | None | — | MISSING | Permission not split | — | P2 |
| /admin/audit | Retention | settings also | Fixture 365d | Retention job | None | — | PRODUCT_DECISION_REQUIRED | Retention policy OPEN | settings `auditRetentionDays` | P3 |

---

## `/admin/settings`

Each field is classified. Runtime-editable database settings are **not** implied. Coverage uses the eight matrix values; the settings-specific label is in **Missing part**.

| Admin route | Screen/interaction | Frontend source | Current data source | Expected operation | Existing backend API | Permission | Coverage | Missing part | Decision source | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| /admin/settings | Load form | `settingsService.getSettings` | `settingsFixtures` | Read config | Env via `src/config/env.ts` | — | PRODUCT_DECISION_REQUIRED | DISPLAY/ENV — no settings GET | D-POL-01 | P3 |
| /admin/settings | Save `updateSettings` | L11 | In-memory merge | Persist | None | — | PRODUCT_DECISION_REQUIRED | Do not auto-create a settings table | D-POL-01 | P3 |
| /admin/settings | Reset defaults | `resetToDefaults` L46 | Fixtures | — | — | — | DEV_ONLY | — | — | P3 |
| /admin/settings | `testGatewayConnection` always succeeds | L51 | `Math.random` latency | Probe SMS/WhatsApp/Bankak | Mock PSP for **broker top-up** only | — | DEV_ONLY | Always-green; not a production probe | D-PAY-01 / D-TICKET-01 | P3 |
| /admin/settings | `seatHoldMinutes` | `settings.ts` L2 | Fixture 15 | Hold TTL | Env / hold expiry in catalog | — | PRODUCT_DECISION_REQUIRED | ENVIRONMENT CONFIG (M1 default), not runtime DB | D-POL-01; D-SEAT-01 | P3 |
| /admin/settings | `maxSeatsPerBooking` | L3 | Fixture 6 | Cap | Zod max 20 on seatIds | — | PRODUCT_DECISION_REQUIRED | ENVIRONMENT / validation constant | `quoteBookingSchema` | P3 |
| /admin/settings | `cancellationCutoffHours` | L4 | Fixture | Retention window | None | — | PRODUCT_DECISION_REQUIRED | Conflicts with D-REF-01 (no invented %) | D-REF-01 | P3 |
| /admin/settings | `manifestLockMinutesBeforeDeparture` | L5 | Fixture | Manifest lock | None | — | PRODUCT_DECISION_REQUIRED | — | — | P3 |
| /admin/settings | `allowOverbookingBuffer` | L6 | Fixture | Overbook | Seats FREE/HELD/SOLD atomic | — | PRODUCT_DECISION_REQUIRED | Dangerous vs seat integrity | D-SEAT-01 | P3 |
| /admin/settings | `emergencyRoutingMode` / notice | L7–8 | Fixture | Ops banner | None | — | PRODUCT_DECISION_REQUIRED | FRONTEND-ONLY until decided | — | P3 |
| /admin/settings | `primaryCurrency` / symbol | L12–13 | `SDG` | Currency | Hard SDG | — | COMPLETE | DISPLAY-ONLY; must not be editable | D-CUR-01 | P0 |
| /admin/settings | `platformCommissionPercent` / `brokerCommissionPercent` | L14–15 | Fixture 8 / 3 | Global rates | Per-assignment % only | — | PRODUCT_DECISION_REQUIRED | Non-authoritative | D-RATE-01 | P0 |
| /admin/settings | `brokerMinWalletThreshold` | L16 | Major SDG | Low-balance default | Env + office override minor | — | CONTRACT_MISMATCH | ENVIRONMENT + office PATCH; UI major units | D-POL-01 | P1 |
| /admin/settings | `sodThresholdAmount` | L17 | Fixture | SoD | None | — | PRODUCT_DECISION_REQUIRED | — | — | P3 |
| /admin/settings | `autoSettlementCycle` | L18 | weekly/biweekly/monthly | Scheduler | Office `settlementPeriod` WEEKLY/MONTHLY; **no scheduler** | `brokers.manage` | PRODUCT_DECISION_REQUIRED | D-SET-01 no auto scheduler; biweekly extra | D-SET-01 | P3 |
| /admin/settings | `defaultDisbursementBank` | L19 | Bankak label | Bank dest | `payoutReference` free string | — | PRODUCT_DECISION_REQUIRED | — | D-SET-01 | P3 |
| /admin/settings | VAT fields | L20–21 | Fixture | Tax | None | — | PRODUCT_DECISION_REQUIRED | — | D-ACC-01 | P3 |
| /admin/settings | SMS provider / sender / enabled | L25–28 | Fixture | SMS | Disabled | — | PRODUCT_DECISION_REQUIRED | DANGEROUS/SHOULD NOT be runtime until provider locked | D-TICKET-01 | P3 |
| /admin/settings | WhatsApp enable / provider | L29–30, L33 | Fixture | WhatsApp | Disabled | — | PRODUCT_DECISION_REQUIRED | Same | D-TICKET-01 | P3 |
| /admin/settings | `brokerLowBalanceAlert` | L32 | Fixture | Alerting | `lowBalance` boolean on wallet DTO | `wallets.view` | PARTIAL | Flag exists; no push/notification | D-POL-01 | P2 |
| /admin/settings | `sessionTimeoutMinutes` | L36 | Fixture | JWT/session TTL | Env JWT/refresh | — | PRODUCT_DECISION_REQUIRED | ENVIRONMENT CONFIG | Stage 1 env | P3 |
| /admin/settings | `enforce2FAForAdmins/Finance` | L37–38 | Fixture | 2FA | OTP exists; extra 2FA OPEN | — | PRODUCT_DECISION_REQUIRED | — | D-AUTH-01 | P3 |
| /admin/settings | `maxLoginAttempts` | L39 | Fixture | OTP lock | Env OTP max attempts | — | PRODUCT_DECISION_REQUIRED | ENVIRONMENT CONFIG | Stage 1 tests | P3 |
| /admin/settings | `auditRetentionDays` | L40 | Fixture 365 | Retention job | None | — | PRODUCT_DECISION_REQUIRED | — | — | P3 |
| /admin/settings | `ipWhitelistingEnabled` | L41 | Fixture | IP allowlist | None | — | PRODUCT_DECISION_REQUIRED | DANGEROUS | — | P3 |
| /admin/settings | `maintenanceMode` / message | L45–46 | Fixture | Kill switch | None | — | PRODUCT_DECISION_REQUIRED | DANGEROUS/SHOULD NOT be a casual runtime toggle without ops design | — | P3 |
| /admin/settings | `autoBackupHour` | L47 | Fixture | Backup schedule | None | — | PRODUCT_DECISION_REQUIRED | Ops/environment | — | P3 |
| /admin/settings | `systemVersion` / `environment` / `lastBackupTimestamp` / `databaseStatus` | L48–51 | Fixture | Display | `/health` `/ready` | — | PARTIAL | DISPLAY-ONLY from health; not settings form | `health.routes.ts` | P2 |

---

## Cross-module mock split-brain (not extra routes)

These are fixture-synchronization defects. They are cited from screens above and do not add coverage rows.

| Mock mutation | Updates | Leaves stale | Files |
|---|---|---|---|
| `brokerService.topUpBrokerWallet` | Broker office `walletBalance` | `financialService` wallets/ledger/queue | `brokerService.ts` L117–145 vs `financialService.ts` |
| `financialService.recordTopUp` / `approveTopUpRequest` | `walletsState` + fake GL | `brokerService` offices | `financialService.ts` L106–184, L255 |
| `refundService.executeManualOverride` | Refund queue | Bookings, tickets, wallets, commissions | `refundService.ts` L70 |
| `settlementService.approveAndDisburseBatch` / `creditCommissionToBrokerWallet` | Settlement fixture + optional wallet credit | Accrual lock, GL, D-SET-01 wallet isolation | `settlementService.ts` L74, L118 |
| `carrierService.assignBrokerToCarrier` | Carrier `assignedBrokers` | Broker `carrierLinks` | `carrierService.ts` L143 |
| `settingsService.updateSettings` | Settings object | Hold TTL, rates, tickets, SMS | `settingsService.ts` L11 |
| `travelerService.updateAccountStatus` | Traveler status | Sessions | `travelerService.ts` L200 |

---

## Permission coverage (summary; full table in gap audit)

| Permission | UI action | Backend route | Enforced | Missing/mismatch | Recommended action |
|---|---|---|---|---|---|
| `admins.view` | Team list/detail | `GET /admins`, `GET /admins/:id` | Yes | Contract mismatch | Adapter |
| `admins.create` | Invite modal | `POST /admins` | Yes | Email vs phone | Adapter |
| `admins.update` | Profile edit | **none** | Catalog only | Unused key | Implement PATCH or remove from UI |
| `admins.suspend` | Freeze | `PATCH /admins/:id/status` | Yes | — | Use |
| `roles.*` / `permissions.*` | Roles page | roles + permissions routes | Yes | Fixture matrix keys | Map to catalog |
| `sessions.view` / `sessions.revoke` | Member sessions | `GET/DELETE /sessions` | Yes | — | Use |
| `audit.view` | Audit page | `GET /audit-logs` | Yes | Filters incomplete | Extend query |
| `brokers.view` / `brokers.manage` | Brokers module | `/brokers` | Yes | — | Use |
| `carriers.view` / `carriers.manage` | Companies | `GET/POST /carriers` | Yes | No GET/PATCH by id | Add if P1 |
| `wallets.view` | Wallet screens | `GET /admin/wallets/:officeId` | Yes | No list-all | Add list |
| `wallets.topups.*` (6 keys) | Queue | `/admin/wallets/top-ups*` | Yes | UI may collapse keys | Honor split keys |
| `commissions.view` / `commissions.payout` | Settlements | `/admin/commissions*` | Yes | UI disburse≠finalize | Adapter + hide wallet credit |
| `catalog.manage` | Company trips | `/catalog/trips*` | Yes | UI fixture trips | Wire later |
| `bookings.view` / `bookings.cancel` | Bookings | `/admin/bookings*` | Yes | UI has no cancel call | Wire cancel |
| `bookings.override` | Refund override | **none** | Reserved | Must stay unimplemented | Do not ship UI as API |
| (none) | Exports / global search / GPS / travelers / GL | none | — | — | Decision or P2 endpoints |
| Screen visibility | All mock pages | none | **No** | UI has **no route guards** | Never treat UI hide as authz |
