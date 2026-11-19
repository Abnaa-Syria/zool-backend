# ZoolGo — Product and Scope

## 1. Product Context and Business Purpose

**ZoolGo** is an intercity passenger bus ticketing and transit operations platform designed specifically for the Republic of the Sudan.

### The Market Context
Intercity transport in Sudan operates across vast geographic distances (connecting major hubs such as Port Sudan, Kassala, Wad Madani, Atbara, Dongola, Kosti, and Gedaref) under extreme operational constraints:
- **Cash shortages and banking friction:** Due to ongoing economic distress and network outages, consumer-facing bank apps (notably Bank of Khartoum's *Bankak*) experience high transaction failure rates, timeouts, and settlement delays.
- **Inflationary pressure and currency:** Rapid inflation necessitates strict numeric handling in **Sudanese Pounds (SDG)**. All system calculations are performed in integer minor units (`amountMinor`) to avoid floating-point drift.
- **Broker-dominated distribution:** Most Sudanese travelers do not book tickets on personal smartphones using digital cards. Instead, they visit neighborhood ticketing kiosks, bus terminal booking desks, and private travel agencies (**Broker Offices**). These brokers collect cash or direct bank transfers from travelers and issue guaranteed, pre-printed or digital bus tickets using their agency's commercial credit.

### The Operating Model
ZoolGo operates a B2B2C model structured around three primary pillars:
1. **Central Platform (ZoolGo Admins):** Onboards transport companies, configures broker offices, sets policy constraints (minimum top-up, daily exposure ceilings, settlement cadences), verifies manual top-up bank receipts, and manages periodic commission payouts.
2. **Transport Companies (Carriers):** Fleet owners and bus operators (e.g., *Sudan Express*) that run scheduled intercity bus trips between origin and destination terminals with defined seat layouts and base ticket prices.
3. **Broker Offices (Agencies):** Commercial travel agencies holding a **prepaid agency wallet**. Brokers maintain physical offices with managers and clerks. When a traveler requests a trip, the broker holds seats, records traveler details, and confirms the booking. ZoolGo atomically debits the broker's wallet and accrues a per-carrier commission for the broker.

---

## 2. Actors and Software Support Status

Every actor interacting with ZoolGo has a clearly defined lifecycle in the product roadmap. The table below documents whether software support currently exists in code.

| Actor | Description | Implementation Status | Evidence / Authority |
|---|---|---|---|
| **Central Admin (Super Admin)** | High-privileged operator managing the entire platform, creating roles, assigning permissions, creating carriers, and configuring broker offices. | **IMPLEMENTED** | `zool-go-backend/src/modules/admins/`, `auth.service.ts`, `seed.ts` L57–130 |
| **Custom-Role Admin** | Administrative staff with granular permissions (e.g., Financial Auditor with `wallets.view` and `commissions.view`, or Dispatcher with `catalog.view`). | **IMPLEMENTED** | `zool-go-backend/src/modules/roles/`, `permissions.ts`, `requirePermission.ts` |
| **Broker Office** | The commercial agency entity owning a prepaid wallet, office policies (exposure ceiling, timezone), and carrier assignments. | **IMPLEMENTED** | `zool-go-backend/src/modules/brokers/`, `prisma/schema/broker.prisma` |
| **Broker Office Manager** | Chief administrator of a broker office who logs in via OTP, manages staff, requests wallet top-ups, and oversees agency bookings. | **IMPLEMENTED** | `zool-go-backend/src/modules/broker-auth/`, `broker-staff/`, `prisma/schema/broker.prisma` |
| **Broker Clerk / Employee** | Ticketing clerk employed by a broker office who searches trips, holds seats, and confirms bookings for walk-in travelers. | **IMPLEMENTED** | `zool-go-backend/src/modules/broker-staff/`, `broker-permissions.ts`, `bookings.service.ts` |
| **Passenger (Walk-in Traveler)** | End-user traveler whose name, phone, and optional national ID are entered by the broker clerk during ticket reservation. Has no login account. | **IMPLEMENTED** | `prisma/schema/booking.prisma` (`BookingPassenger`), `bookings.service.ts` L188–215 |
| **Direct Customer** | Traveler booking tickets independently via a consumer mobile app and paying via consumer banking (e.g., Bankak). | **OUT OF SCOPE (M1) / DESIGN ONLY** | `docs/BACKEND_DECISION_REGISTER.md` (`SCOPE-01`, `D-PAY-01`); UI in `Zool/Home.png` |
| **Transport Company (Carrier)** | Intercity bus operating company partnering with ZoolGo. Receives seat sales and provides vehicle schedules. | **IMPLEMENTED (Backend)** | `zool-go-backend/src/modules/carriers/`, `prisma/schema/carrier.prisma` |
| **Driver / Conductor** | Bus staff operating intercity routes, performing passenger check-in and QR code ticket scanning. | **DESIGN ONLY / NOT STARTED** | Mockup in `Zool/QRScanner.png`, `PassengerBoarding.png`; no backend implementation |
| **GPS Tracking Device / Phone** | Hardware telematics device or driver mobile phone broadcasting live bus coordinates. | **DESIGN ONLY / MOCKED** | Frontend simulated via `telemetrySimulator.ts`; backend decision `D-GPS-01` is **OPEN** |

---

## 3. Product Surfaces

| Surface | Target Users | Current Reality | Evidence Path |
|---|---|---|---|
| **Admin Dashboard** | Central Admins, Auditors, Operations | **IMPLEMENTED BUT NOT INTEGRATED** (30 pages built in React/Tailwind, but 100% mock-driven; zero network calls to `/api/v1`) | `zool-go-dashpoard/src/app/router/index.tsx` |
| **Broker Portal** | Broker Managers, Ticketing Clerks | **BACKEND IMPLEMENTED** (Complete `/api/v1/broker/*` API available; frontend web interface not yet developed) | `zool-go-backend/src/app.ts` L92–102, `broker-auth.routes.ts`, `bookings.routes.ts` |
| **Customer Mobile App** | General Public Travelers | **DESIGN ONLY** (Screen mockups exist in `Zool/`; no code written) | `Zool/Home.png`, `Zool/My ticket.png`, `Zool/Onboarding.png` |
| **Driver / Conductor App** | Bus Drivers, Terminal Staff | **DESIGN ONLY** (Screen mockups exist in `Zool/`; no code written) | `Zool/QRScanner.png`, `Zool/PassengerBoarding.png` |
| **Backend REST API** | Admin Dashboard, Broker Portal, Integrations | **IMPLEMENTED** (81 mounted JSON endpoints with Zod validation, JWT/cookie auth, dynamic RBAC, OpenAPI 3.0 docs) | `zool-go-backend/src/app.ts`, `docs/openapi.yaml` |
| **Fleet GIS Tracking** | Operations Dispatchers | **MOCKED** (Leaflet map rendered on frontend with simulated movement via `telemetrySimulator.ts`; backend unbuilt) | `zool-go-dashpoard/src/features/tracking/` |
| **External Integrations** | Payment Gateways, SMS, WhatsApp | **MOCKED / DEFERRED** (Payment gateway uses mock adapter; SMS/WhatsApp channels disabled under `D-TICKET-01`) | `zool-go-backend/src/modules/payments/payment-provider.ts`, `pdf-ticket-renderer.ts` |

---

## 4. Critical Product Boundaries and Entity Distinctions

To avoid common architectural pitfalls, the receiving engineer must understand the following strict domain boundaries:

### 1. Broker Office vs. Transport Company (Carrier)
- A **Broker Office** (`BrokerOffice`) is an independent commercial sales agency (e.g., "Al-Mustaqbal Travel Kiosk") that sells tickets across multiple bus companies to earn a sales commission. It owns a prepaid wallet.
- A **Transport Company** (`TransportCompany`) is a fleet carrier (e.g., "Sudan Express") that operates physical buses and defines trips. A broker can only view and book trips for carriers explicitly assigned to that broker office by Super Admins via `BrokerCarrierAssignment`.

### 2. Broker Employee vs. Passenger
- A **Broker Employee** (`BrokerEmployee`) is an authenticated user (Manager or Clerk) who logs into the broker portal using phone OTP. All booking operations record the `employeeId` for auditability.
- A **Passenger** (`BookingPassenger`) is the individual traveling on the bus. The passenger's name, phone number, and optional ID are captured during booking creation. **A broker employee never travels on their own booking; the passenger record is distinct from the broker's identity.**

### 3. Passenger Record vs. Customer Account
- In the current M1 Broker Vertical, passengers have **no user account, login credentials, or saved profiles**. They are stored simply as point-in-time passenger details tied to a specific booking line item (`BookingPassenger`).
- Direct customer accounts (CRM, KYC, customer wallets) belong to the future direct-to-consumer vertical (`D-PAY-01`, `SCOPE-01`) and are strictly out of scope for M1.

### 4. Booking vs. Ticket
- A **Booking** (`Booking`) is the top-level commercial reservation representing a single checkout event by a broker office for a specific trip. It tracks total fare, commission amount, booking status (`CONFIRMED` or `CANCELLED`), and the financial transaction reference.
- A **Ticket** (`Ticket`) is the specific boarding entitlement issued to an individual passenger for a specific physical seat (`TripSeat`). A booking containing 3 passengers generates 1 `Booking` record and 3 `Ticket` records, each with a unique alphanumeric ticket number (e.g., `TK-20261020-0001-A1`).

### 5. Trip vs. Vehicle
- A **Trip** (`Trip`) in M1 represents a scheduled route offering (origin, destination, departure timestamp, base price, and an array of individual seats `TripSeat`).
- In M1, **trips are not tied to physical vehicle assets or license plates**. Vehicle management, driver rosters, and GPS telematics belong to the deferred fleet tracking vertical (`D-GPS-01`).

### 6. Wallet Transaction vs. Payment
- A **Payment** (`TopUpIntent`) is an external funding attempt where a broker attempts to deposit money into the platform (via automatic webhook or manual bank receipt review).
- A **Wallet Transaction** (`WalletLedgerEntry`) is an immutable internal ledger record representing money movement into or out of an agency's prepaid wallet balance (Credit from approved top-up, Debit from booking confirmation, Credit from cancellation refund).

### 7. Wallet Refund vs. Customer Cash Refund
- When a booking is cancelled via ZoolGo (`POST /api/v1/broker/bookings/:id/cancel` or `POST /api/v1/admin/bookings/:id/cancel`), the full ticket fare is refunded **directly to the agency's prepaid wallet balance**.
- How the broker office returns physical cash or bank transfers to the walk-in passenger is an offline commercial matter between the agency and traveler. ZoolGo does not disburse money to passengers directly.

### 8. Commission Accrual vs. Commission Settlement vs. Wallet Credit
- **Commission Accrual (`CommissionAccrual`):** When a booking is confirmed, commission is recognized immediately as a record with status `UNSETTLED`. If the booking is cancelled, the accrual status changes to `CLAWED_BACK`.
- **Commission Settlement (`CommissionSettlement`):** At the end of a settlement period (weekly or monthly), central admins create a `DRAFT` settlement that reserves all `UNSETTLED` accruals. Once paid offline, the admin marks it `FINALIZED`.
- **Crucial Invariant:** **Finalizing a commission settlement does NOT credit the broker's prepaid wallet.** The broker's wallet is for purchasing tickets only. Commissions are paid out to the broker via external bank transfer or cash disbursement by central platform management.

### 9. OpenStreetMap Display vs. GPS Telemetry Source
- The Admin Dashboard features a live fleet map (`src/features/tracking/components/FleetMap.tsx`) rendering OpenStreetMap tiles via Leaflet.
- The moving bus markers on this map are generated by an in-memory client-side generator (`telemetrySimulator.ts`). There is **no live telemetry ingestion pipeline, no GPS device protocol, and no WebSocket server in `zool-go-backend`**.

---

*Evidence citations:*
- Broker Journey PDF Authority: `d:\zool-go\docs\BACKEND_DECISION_REGISTER.md` L5–88
- Minor units policy: `d:\zool-go\docs\BACKEND_DECISION_REGISTER.md` L249–264 (`D-POL-01`, `D-CUR-01`)
- Ticket and booking boundaries: `d:\zool-go\zool-go-backend\src\modules\bookings\bookings.service.ts` L178–320
