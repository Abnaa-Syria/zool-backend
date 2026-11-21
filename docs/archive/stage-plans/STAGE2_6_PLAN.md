# Stage 2.6 — M1 policy locks and backend gaps

## Status

**In progress / delivered as backend-only APIs.** Authority: [`docs/BACKEND_DECISION_REGISTER.md`](../docs/BACKEND_DECISION_REGISTER.md).

## Money / JSON

All money fields in JSON use explicit minor-unit names: `amountMinor`, `totalAmountMinor`, `commissionAmountMinor`, `minTopUpMinor`, `lowBalanceThresholdMinor`, `balanceMinor`, `refundedAmountMinor`. Currency is **SDG** only.

## Endpoints added or changed

### Tickets
- `POST /broker/bookings/:id/dispatch` — `channel=download` only; `whatsapp`/`sms` → `TICKET_CHANNEL_DISABLED`

### Bookings
- `GET /broker/bookings` — `companyId` filter added
- `GET /admin/bookings` — `bookings.view`
- `GET /admin/bookings/:id` — `bookings.view`
- `POST /admin/bookings/:id/cancel` — `bookings.cancel`, body `{ reason }`

### Holds
- `POST /broker/trips/:tripId/holds` — `{ mode: MANUAL, seatIds }` or `{ mode: AUTO, seatCount }`

### Top-ups
- Broker `POST /broker/wallet/top-ups/:intentId/evidence` (multipart)
- `POST /payments/webhooks/:provider` — raw-body signature
- Admin `POST /admin/wallets/:officeId/top-ups` (multipart) — `wallets.topups.create_for_office`
- Admin `GET /admin/wallets/top-ups` — view/review
- Admin `POST /admin/wallets/top-ups/:id/approve` — **no amount**
- Admin `POST /admin/wallets/top-ups/:id/reject`
- Admin `GET /admin/wallets/top-ups/:id/evidence`

### Settlements
- `POST /admin/commissions/settlements` — DRAFT reserves accruals
- `POST /admin/commissions/settlements/:id/finalize` — idempotent
- `POST /admin/commissions/settlements/:id/cancel` — releases RESERVED
- `GET /admin/commissions/settlements` / `GET /:id`
- `POST /admin/commissions/payouts` **removed** (replaced)

## Out of stage

Real Bankak/WhatsApp adapters, `bookings.override` action, settlement cron, free admin credit, production object storage, frontend.
