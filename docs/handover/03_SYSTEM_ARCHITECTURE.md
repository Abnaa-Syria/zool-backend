# ZoolGo — System Architecture

This document describes the high-level and detailed architecture of the ZoolGo platform. It details both the **currently implemented system** and the **planned architecture**, with clear architectural boundaries between the two.

---

## 1. High-Level System Topology (Current Implementation)

```mermaid
flowchart TB
    subgraph ClientLayer["Client & Presentation Layer"]
        Dashboard["Admin Dashboard (React 19 / Vite)\nPort: 5173\nStatus: Mock-driven UI Prototype"]
        PostmanScripts["Integration Test & Smoke Scripts\nVitest / Supertest / Node.js ESM"]
    end

    subgraph BackendAPI["ZoolGo Backend Modular Monolith (Node.js / Express 4)\nPort: 4000"]
        Router["Express App Router (/api/v1)"]
        Middleware["Security & Observability Pipeline\nHelmet, CORS, Pino HTTP, RequestID, RateLimit"]
        AuthModule["Auth & RBAC Subsystem\nAdmin OTP, JWT, Session Tracking, Invalidation"]
        BrokerSubsystem["Broker Vertical Subsystem\nOffice Auth, Staff, Catalog, Holds, Bookings"]
        FinancialSubsystem["Financial & Settlement Subsystem\nPrepaid Wallet, Top-Up Review, Commission Accruals"]
    end

    subgraph DataStorage["Data & State Persistence Layer"]
        MySQL[("MySQL 8.4 Database\nPort: 3308 / 3307\n30 Prisma Models in 12 Files")]
        Redis[("Redis 7.4 In-Memory Store\nPort: 6380\nRate Limiting, OTP Cooldowns, Authz Version Cache")]
        LocalStorage["Local Private Storage\n./uploads/receipts/\nRestricted Static Evidence Files"]
    end

    subgraph ExternalBoundary["External Provider Abstractions"]
        MockPSP["Mock Payment Provider\nAdapter Pattern (Non-Prod Only)"]
        ConsoleOTP["Console OTP Delivery Provider\nLogger Abstraction"]
        OSMTiles["OpenStreetMap Tile Servers\nExternal CDN for Leaflet"]
    end

    Dashboard -.->|"Planned Integration (Milestone F)"| Router
    PostmanScripts -->|"HTTP / REST API"| Router
    Router --> Middleware --> AuthModule & BrokerSubsystem & FinancialSubsystem
    AuthModule & BrokerSubsystem & FinancialSubsystem -->|"Prisma ORM 6.19"| MySQL
    AuthModule & BrokerSubsystem & FinancialSubsystem -->|"ioredis 5.6"| Redis
    FinancialSubsystem -->|"Node.js fs"| LocalStorage
    FinancialSubsystem -.->|"PaymentProvider Interface"| MockPSP
    AuthModule -.->|"OtpDeliveryProvider Interface"| ConsoleOTP
    Dashboard -->|"Direct Leaflet Tile Requests"| OSMTiles
```

---

## 2. Backend Request Lifecycle

Every HTTP request entering `zool-go-backend` traverses an explicit, deterministic pipeline:

```mermaid
sequenceDiagram
    autonumber
    actor Client as HTTP Client (Admin / Broker)
    participant Sec as Helmet & CORS
    participant ReqId as Request ID Middleware
    participant RawBody as Webhook Raw Body Parser
    participant Body as Express JSON & Cookie Parser
    participant Auth as Authenticate Middleware
    participant Perm as RequirePermission Guard
    participant Val as Zod Validation Middleware
    participant Ctrl as Controller
    participant Svc as Service Layer
    participant Repo as Repository Layer
    participant DB as Prisma / MySQL
    participant Cache as Redis Cache
    participant Err as Global Error Handler

    Client->>Sec: Incoming HTTP Request
    Sec->>ReqId: Apply HTTP Headers (X-Request-Id)
    ReqId->>RawBody: Is Webhook Route?
    alt Is Webhook Route
        RawBody->>RawBody: Capture raw bytes for HMAC check
    end
    RawBody->>Body: Parse JSON Body & Signed Cookies
    Body->>Auth: Extract Bearer JWT / Cookie
    alt Route Requires Authentication
        Auth->>Auth: Verify JWT signature & expiration
        Auth->>Cache: Check authz:version:{id} matches token 'av'
        alt Version Mismatch or Inactive
            Auth-->>Client: 401 Unauthorized
        end
    end
    Auth->>Perm: Check caller permissions
    alt Missing Required Permission
        Perm-->>Client: 403 Forbidden
    end
    Perm->>Val: Validate params, query, and body via Zod
    alt Schema Validation Fails
        Val-->>Client: 422 Unprocessable Entity (ValidationErrorResponse)
    end
    Val->>Ctrl: Invoke Controller Method
    Ctrl->>Svc: Call Service Business Logic
    Svc->>Repo: Data Access Request
    Repo->>DB: Prisma Query / $transaction
    DB-->>Repo: Database Entity
    Repo-->>Svc: Domain Model
    Svc-->>Ctrl: DTO / Business Result
    Ctrl-->>Client: 200 / 201 Success (SuccessResponse<T>)
    opt Exception Thrown
        Svc-->>Err: AppError / Prisma Error
        Err-->>Client: Formatted JSON Error Envelope
    end
```

---

## 3. Authentication and Session Lifecycle

Admin and broker authentication uses phone OTP, short-lived JWT access tokens, rotating refresh cookies, and fail-closed Redis authorization versioning.

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Admin User
    actor Attacker as Malicious Replay
    participant API as Auth Controller & Service
    participant SMS as OTP Delivery Adapter
    participant MySQL as MySQL Database
    participant Redis as Redis Cache

    Admin->>API: POST /api/v1/auth/otp/request { phone }
    API->>Redis: Check resend cooldown & rate limit
    API->>MySQL: Find active AdminUser & AdminIdentity
    API->>API: Generate 6-digit numeric OTP & compute HMAC-SHA256
    API->>MySQL: Insert OtpChallenge (status: PENDING, maxAttempts: 5)
    API->>SMS: Deliver OTP (Console logger / devOtp if enabled)
    API-->>Admin: 200 OK { challengeId, devOtp (non-prod only) }

    Admin->>API: POST /api/v1/auth/otp/verify { phone, code, challengeId }
    API->>Redis: Check verify rate limit
    API->>MySQL: Lock & verify OtpChallenge (HMAC constant-time check)
    API->>MySQL: Mark challenge CONSUMED & create RefreshSession
    API->>Redis: Set authz:version:{adminId} = admin.authzVersion
    API-->>Admin: 200 OK + Body: accessToken (15 min) + Cookie: zoolgo_refresh (7 days, HttpOnly)

    Note over Admin,API: Normal Refresh Rotation
    Admin->>API: POST /api/v1/auth/refresh (Cookie: zoolgo_refresh)
    API->>MySQL: Find RefreshSession & verify sha256(refreshToken)
    API->>MySQL: Invalidate old session & create new session
    API-->>Admin: 200 OK + New accessToken + Rotated zoolgo_refresh Cookie

    Note over Attacker,API: Reuse Detection
    Attacker->>API: POST /api/v1/auth/refresh (Stolen old Cookie)
    API->>MySQL: Look up token hash -> STATUS IS REVOKED!
    API->>MySQL: Revoke ALL active sessions for this admin & increment authzVersion
    API->>Redis: Update authz:version:{adminId} (Immediately invalidates active JWTs)
    API-->>Attacker: 401 Unauthorized (TOKEN_REUSED)
```

---

## 4. Broker Booking Transaction

The booking transaction is an atomic operation executed within a single MySQL transaction (`getPrisma().$transaction`).

```mermaid
sequenceDiagram
    autonumber
    actor Clerk as Broker Clerk
    participant BookAPI as Bookings Service
    participant CatAPI as Catalog / Seat Service
    participant WalletAPI as Wallets Service
    participant MySQL as MySQL Database ($transaction)

    Clerk->>CatAPI: POST /api/v1/broker/trips/:id/holds { mode: MANUAL, seatIds: ["seat_1"] }
    CatAPI->>MySQL: Verify trip active, seat available, carrier assigned to office
    CatAPI->>MySQL: Create SeatHold (status: HELD, expiresAt: now + 15m)
    CatAPI-->>Clerk: 201 Created { holdToken, seats, expiresAt }

    Clerk->>BookAPI: POST /api/v1/broker/bookings/confirm { tripId, seatIds, passengers, idempotencyKey }
    BookAPI->>MySQL: Check IdempotencyKey (return existing booking if found)
    BookAPI->>MySQL: Read & Lock Broker Office Policy (check daily exposure ceiling)
    BookAPI->>MySQL: Lock Wallet (SELECT FOR UPDATE)
    BookAPI->>BookAPI: Check Wallet Balance >= Total Fares
    alt Insufficient Balance
        BookAPI-->>Clerk: 402 Payment Required (INSUFFICIENT_BALANCE)
    end
    BookAPI->>MySQL: Verify SeatHold is valid and belongs to this clerk
    BookAPI->>MySQL: Update Wallet: balance = balance - totalAmount
    BookAPI->>MySQL: Insert WalletLedgerEntry (type: DEBIT, ref: booking:{id})
    BookAPI->>MySQL: Update TripSeat status to SOLD
    BookAPI->>MySQL: Delete SeatHold
    BookAPI->>MySQL: Insert Booking (status: CONFIRMED)
    BookAPI->>MySQL: Insert BookingPassenger & Ticket records
    BookAPI->>MySQL: Insert CommissionAccrual (status: UNSETTLED, amountMinor: carrier.commission)
    BookAPI->>MySQL: Insert AuditLog
    BookAPI-->>Clerk: 201 Created (BookingDto with confirmed tickets)
```

---

## 5. Wallet Top-Up Confirmation Architecture (Dual Path)

Under locked decision `D-TOP-01`, ZoolGo supports two confirmation paths for the same `TopUpIntent`.

```mermaid
flowchart TD
    subgraph Initiation["1. Intent Creation"]
        Broker["Broker Office\nPOST /broker/wallet/top-ups"]
        AdminProxy["Central Admin (on behalf)\nPOST /admin/wallets/:id/top-ups"]
        Intent[("TopUpIntent Record\nstatus: PENDING\nfixed: amountMinor")]
    end

    subgraph AutomaticPath["2. Automatic Confirmation Path (Architectural)"]
        PSP["External Payment Provider\ne.g., Future Bankak Gateway"]
        WebhookRoute["POST /payments/webhooks/:provider\nRaw Body HMAC Verification"]
        MockEndpoint["POST /payments/mock/confirm\n(Non-Prod Dev/Test Only)"]
    end

    subgraph ManualPath["3. Manual Receipt Review Path (Enabled M1 Production)"]
        Upload["Multipart Evidence Upload\nBroker or Admin attaches bank transfer slip"]
        Evidence[("TopUpEvidence Record\nLocal Private Disk Storage")]
        Queue["Admin Review Queue\nGET /admin/wallets/top-ups"]
        ReviewAction{"Central Admin Review\nwallets.topups.approve / reject"}
    end

    subgraph Execution["4. Atomic Credit Execution ($transaction)"]
        LockIntent["Lock TopUpIntent (Check PENDING)"]
        CreditWallet["Credit Wallet: balance = balance + intent.amountMinor\n(Approve NEVER alters amount)"]
        LedgerEntry["Create WalletLedgerEntry\ntype: CREDIT, ref: topup:{intentId}"]
        Audit["Record Audit Log"]
    end

    Broker --> Intent
    AdminProxy --> Intent
    Intent --> AutomaticPath
    Intent --> ManualPath

    PSP -->|"Signed Webhook"| WebhookRoute
    MockEndpoint -.->|"DEV ONLY"| WebhookRoute
    WebhookRoute -->|"providerEventId Check"| LockIntent

    Upload --> Evidence --> Queue --> ReviewAction
    ReviewAction -->|"Approve"| LockIntent
    ReviewAction -->|"Reject (with reason)"| RejectIntent[("TopUpIntent: REJECTED")]

    LockIntent --> CreditWallet --> LedgerEntry --> Audit
```

---

## 6. Commission Settlement Lifecycle

```mermaid
stateDiagram-v2
    [*] --> UNSETTLED: Booking Confirmed (CommissionAccrual created)
    
    UNSETTLED --> CLAWED_BACK: Booking Cancelled (Commission automatically reversed)
    CLAWED_BACK --> [*]

    UNSETTLED --> RESERVED: Admin creates DRAFT settlement\nPOST /admin/commissions/settlements\n(Overlapping drafts blocked with 409)
    
    RESERVED --> UNSETTLED: Admin cancels DRAFT settlement\nPOST /admin/commissions/settlements/:id/cancel\n(Accruals released back to pool)

    RESERVED --> SETTLED: Admin finalizes payout\nPOST /admin/commissions/settlements/:id/finalize\n(Idempotent; creates CommissionPayout)\nCRITICAL: Does NOT touch prepaid wallet!
    
    SETTLED --> [*]
```

---

## 7. Current vs. Future Fleet GPS Architecture

### Current Implementation (M1 Prototype)
```mermaid
flowchart LR
    subgraph BrowserRuntime["Client Browser Runtime"]
        Sim["telemetrySimulator.ts\nMath-based physics & coordinate interpolator"]
        Leaflet["React-Leaflet Map Component\nFleetMap.tsx"]
        Pins["Rendered Bus Markers\nMock telemetry points"]
    end
    Sim -->|"Simulated tick events (2000ms)"| Leaflet --> Pins
    Note["NO backend API endpoints, NO database models, NO ingestion server exists."]
```

### Planned Future Architecture (Decision `D-GPS-01` Required)
```mermaid
flowchart TD
    subgraph EdgeDevices["Edge Telematics Sources"]
        BusTracker["Hardware OBD/GPS Tracker on Bus"]
        DriverPhone["Driver / Conductor Mobile App"]
    end

    subgraph IngestionPipeline["Ingestion & State Pipeline (Planned)"]
        Gateway["MQTT / HTTPS Telemetry Ingestion Gateway"]
        AuthFilter["Device Authentication & Timestamp Sanitizer"]
        RedisGeo["Redis 7.4 GEO Hashes & Stream\nTransient vehicle coordinate buffer (TTL 24h)"]
        WSServer["WebSocket / SSE Push Server"]
    end

    subgraph StorageAndDisplay["Persistence & Client"]
        PrismaVehicle["PostgreSQL / MySQL Vehicle Location History"]
        DashboardClient["Admin Dashboard Live Tracking Client"]
    end

    BusTracker & DriverPhone -->|"MQTT / CoAP / HTTPS"| Gateway
    Gateway --> AuthFilter --> RedisGeo
    RedisGeo -->|"Pub/Sub"| WSServer -->|"WebSocket push"| DashboardClient
    RedisGeo -.->|"Batched writes"| PrismaVehicle
```

---

*Evidence citations:*
- App assembly: `d:\zool-go\zool-go-backend\src\app.ts` L32–125
- Request ID: `d:\zool-go\zool-go-backend\src\shared\middleware\request-id.ts` L1–15
- Auth middleware: `d:\zool-go\zool-go-backend\src\shared\middleware\authenticate.ts` L12–42
- Booking transaction: `d:\zool-go\zool-go-backend\src\modules\bookings\bookings.service.ts` L178–320
- Top-up locking: `d:\zool-go\zool-go-backend\src\modules\payments\payments.service.ts` L150–290
- Commission settlement: `d:\zool-go\zool-go-backend\src\modules\commissions\commissions.service.ts` L90–215
