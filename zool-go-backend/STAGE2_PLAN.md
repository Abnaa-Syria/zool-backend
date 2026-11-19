# Stage 2 Implementation Plan (M1 — Broker vertical slice)

## Status

**In progress / delivered as backend-only APIs.** No frontend coupling.

## Authority

- [`docs/BACKEND_DECISION_REGISTER.md`](../docs/BACKEND_DECISION_REGISTER.md) — LOCKED (PDF) broker decisions
- `ZoolGo_Broker_Journey.pdf` — sole product source for this vertical

## Scope

End-to-end broker office path:

1. Broker office + employees (manager/clerk permissions)
2. Wallet + ledger + top-up via **mock payment confirmation** port
3. Transport companies + Super Admin assignments + per-carrier commission %
4. Minimal trip/seat catalog + 15-minute holds
5. Atomic booking confirm (wallet debit + seats + tickets + commission accrual)
6. Cancel → full wallet refund + commission clawback
7. Manual admin commission payout + last settlement date

## Hard rules

- Backend only (`zool-go-backend`). Do not edit frontend packages.
- Domain DTOs — do not mirror dashboard mocks / ADM-* shapes.
- Stage 1 HTTP envelopes (`successResponse` / global error handler) only.
- No exceptional Super Admin wallet credit (D-ADJ-01 out of scope).
- No real PSP / WhatsApp — ports with mock/stub implementations.

## Config placeholders (§7)

| Env | Default | Meaning |
|-----|---------|---------|
| `MIN_TOP_UP_AMOUNT` | `10000` | Minimum top-up (integer minor units / SDG) |
| `DEFAULT_BOOKING_EXPOSURE_CEILING` | `100` | Max confirmed tickets per office per UTC day |
| `DEFAULT_SETTLEMENT_PERIOD` | `MONTHLY` | Default settlement cadence |
| `SEAT_HOLD_TTL_SECONDS` | `900` | 15-minute seat hold |
| `PAYMENT_PROVIDER` | `mock` | Active confirmation provider |
| `BROKER_REFRESH_COOKIE_NAME` | `zoolgo_broker_refresh` | Separate from admin refresh cookie |
| `BROKER_REFRESH_COOKIE_PATH` | `/api/v1/broker/auth` | Cookie path |

## Modules

| Module | Responsibility |
|--------|----------------|
| `brokers` | Admin: offices, carrier assignments, office status |
| `broker-auth` | Broker employee OTP login / refresh / me (like Stage 1 `auth`) |
| `broker-staff` | Broker manager: staff CRUD + permission flags |
| `wallets` | Office wallet + ledger (broker + admin views) |
| `payments` | Top-up intents + mock confirmation |
| `carriers` | Transport companies + broker assigned list |
| `catalog` | Trips / seats / holds |
| `bookings` | Quote, confirm, cancel, ticket PDF dispatch (see Stage 2.5) |
| `commissions` | Accruals + admin manual payout |
| `reports` | Office summary / by-employee / by-carrier / wallet-activity (Stage 2.5) |

See also [`STAGE2_5_PLAN.md`](./STAGE2_5_PLAN.md) for PDF tickets, reports, and catalog hardening.

## Auth

- Separate principal: `BrokerEmployee` with phone OTP
- JWT `typ: 'broker_access'`
- Middleware: `authenticateBroker` + permission checks

## Related

- [`STAGE1_PLAN.md`](STAGE1_PLAN.md)
- [`docs/HTTP_RESPONSE_AND_ERROR_STANDARD.md`](docs/HTTP_RESPONSE_AND_ERROR_STANDARD.md)
