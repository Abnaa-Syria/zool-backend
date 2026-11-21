# Stage 2.5 — Broker path hardening

## Status

**Delivered (backend-only).** Extends Stage 2 with printable tickets, office reports, and catalog admin/search improvements. No frontend, no real WhatsApp/SMS/PSP.

## Scope delivered

### 1) Ticket dispatch → PDF

- `TicketDocument` print-ready DTO + `PdfTicketRenderer` (`pdfkit`)
- `POST /api/v1/broker/bookings/:id/dispatch` returns:
  - `document`, `pdfBase64`, `pdfContentType: application/pdf`
  - `status: READY` (download) or `RECORDED` (whatsapp/sms — same payload, deferred provider)
  - `attemptId` (persisted `TicketDispatchAttempt`)
- `GET /api/v1/broker/bookings/:id/tickets/:ticketNumber/pdf` — raw `application/pdf` bytes

### 2) Broker reports (`broker.reports.view` or manager)

Default range: last 30 days UTC when `from`/`to` omitted.

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/broker/reports/summary` | Tickets sold, gross sales, commission accrued, cancellations, refunds |
| `GET /api/v1/broker/reports/by-employee` | Per-employee ticket count / sales / commission |
| `GET /api/v1/broker/reports/by-carrier` | Per-carrier aggregates |
| `GET /api/v1/broker/reports/wallet-activity` | Top-ups / booking debits / refunds / commission payouts |

### 3) Catalog hardening

**Admin** (`catalog.manage`):

- `PATCH /api/v1/catalog/trips/:tripId` — origin/destination/departureAt/basePrice/isActive
- `POST /api/v1/catalog/trips/:tripId/seats` — append seat labels (skips duplicates)

**Broker**:

- Trip search supports `dateFrom` + `dateTo` (keeps single `date`)
- Trip detail includes `availability: { free, held, sold, total }` and commission %
- Holds return `expiresAt` + `remainingSeconds`; expired holds still released on read/write

## Out of scope (unchanged)

- Real WhatsApp/SMS provider, real PSP, frontend panels, fancy PDF branding, full GL/settlement product

## Migration

- `prisma/migrations/20261020180000_ticket_dispatch_attempts` — `TicketDispatchAttempt` table
