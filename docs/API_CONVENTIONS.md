# ZoolGo API Conventions (v1)

Binding rules for every endpoint and every client: admin dashboard, broker web panel, and the broker, customer and driver mobile apps. New endpoints must follow them; deviations need an entry in `BACKEND_DECISION_REGISTER.md`.

Detailed error and envelope internals: `zool-go-backend/docs/HTTP_RESPONSE_AND_ERROR_STANDARD.md`.

---

## 1. Base URL, versioning and surfaces

- Base: `/api/v1`. Only additive changes inside v1 (new endpoints, new optional fields, new enum values that clients must tolerate). Breaking changes require `/api/v2`.
- One API, separated by surface prefix and principal type:

| Surface | Prefix | Principal | Auth middleware |
|---|---|---|---|
| Admin dashboard | `/auth`, `/admins`, `/roles`, `/brokers`, `/carriers`, `/catalog`, `/admin/*`, … | `AdminUser` | `authenticate` + `requirePermission` |
| Broker web + broker mobile | `/broker/*` | `BrokerEmployee` | `authenticateBroker` + `requireBrokerPermission` |
| Customer mobile | `/customer/*` | `Customer` | `authenticateCustomer` (new) |
| Driver mobile | `/driver/*` | `Driver` | `authenticateDriver` (new) |
| Public (no login) | `/public/*` | none | rate limited |

A token issued to one principal type is never accepted on another surface.

## 2. Authentication

- Login is **phone + 6-digit OTP** for every principal. Phone numbers are E.164 (`+2499…`); the default country is Sudan (+249).
- **Access token:** short-lived JWT in `Authorization: Bearer <token>`.
- **Refresh token:** rotating, single use, reuse detection, and server-side revocation.
  - **Web clients** (admin and broker web) receive it as an `HttpOnly` cookie scoped to their auth path. This is the current behaviour.
  - **Mobile clients** send `X-Client-Platform: ios|android`. They receive `refreshToken` in the response body, store it in secure storage, and send it in the body of `POST …/auth/refresh` and `…/auth/logout`. The cookie is not set for them.
- Credential change, suspension, role change and logout-all bump `authzVersion`. Existing access tokens then fail with `401 AUTH_AUTHZ_STALE`.
- Customers have no separate "register" call. `POST /customer/auth/otp/verify` creates the account on first login (`isNewCustomer: true`), and the app then calls `PATCH /customer/me` to set the name.

## 3. Envelopes

Success:
```json
{ "success": true, "statusCode": 200, "message": "Trips retrieved", "data": {}, "meta": { "requestId": "…" } }
```
Error:
```json
{ "success": false, "statusCode": 409, "code": "SEAT_UNAVAILABLE", "message": "Seat already taken", "details": {}, "requestId": "…" }
```
- Status codes: `201` for creates, `204` with no body, `422 VALIDATION_ERROR` with `details: [{ path, message }]`.
- **Clients branch on `code`, never on `message`.** `message` is English, for developers and logs. Apps show their own localized text per `code`.
- Binary responses (ticket PDF, CSV export) are the only non-envelope success bodies. Their errors still use the error envelope.

## 4. Naming and types

| Kind | Rule | Example |
|---|---|---|
| JSON fields | camelCase | `departureAt`, `seatsAvailable` |
| IDs | opaque strings (cuid); never parse them | `"cmwq…"` |
| Human references | separate field, stable, shown to users | `bookingRef: "ZG-20261122-0007"`, `ticketNumber` |
| Enums | UPPER_SNAKE strings; clients must tolerate unknown values | `CONFIRMED`, `IN_PROGRESS` |
| Booleans | `is…` / `has…` / `can…` | `isDirect`, `isWomenOnly` |
| Phones | E.164 | `+249912345678` |

## 5. Money

- **Integers in minor units, always.** 1 SDG = 100 minor. Fields end in `Minor`: `priceMinor`, `totalAmountMinor`, `balanceMinor`.
- Every money object or response carries `currency: "SDG"` (D-CUR-01). Clients format it and never compute fees themselves: the server returns every line of a price breakdown (`subtotalMinor`, `discountMinor`, `totalMinor`, `commissionMinor`, `walletBalanceAfterMinor`).
- **Broker money flow (locked):** the wallet is debited the full ticket price at confirmation. Commission is accrued and paid out later through settlements (D-SET-01). It is never netted from the debit. The review screen shows `debitMinor` = ticket total, and `commissionMinor` as "earned".

## 6. Dates and times

- Instants are ISO 8601 UTC with `Z`, for example `2026-11-22T06:30:00.000Z`. Clients display them in **Africa/Khartoum** time, or the office time zone when one is given.
- Date-only parameters (`date`, `dateFrom`, `dateTo`) are `YYYY-MM-DD` **Sudan calendar days**, converted with `zonedDayRange(date, PLATFORM_TIMEZONE)`. Never use UTC midnight.
- Durations are integer minutes (`durationMinutes`).

## 7. Lists: pagination, filtering, sorting

- Query: `page` (≥1, default 1) and `pageSize` (1–100, default 20).
- Response: `meta: { page, pageSize, total, totalPages }`.
- Filters are plain query params (`status=CONFIRMED&carrierId=…`). Repeat a param for multi-value filters.
- Sorting: `sort=departureAt` or `sort=-priceMinor` (a leading `-` means descending). Each endpoint documents its allowed keys; unknown keys return `422`.
- Free-text search: `q`.

## 8. Writes, idempotency and concurrency

- Money-moving or booking-creating `POST`s accept an `Idempotency-Key` header (UUID), which mobile clients must send. Replaying the same key returns the original result and never moves money twice. On the ledger side this matches `WalletLedgerEntry.idempotencyKey`.
- Seat selection uses **holds**: `POST …/trips/:id/holds` returns `{ holdId, expiresAt }`. If someone else took the seat the response is `409 SEAT_UNAVAILABLE`. Confirm without a valid hold returns `HOLD_REQUIRED` / `HOLD_EXPIRED`.
- `PATCH` is partial and uses `.strict()` schemas, so unknown fields return `422`.

## 9. Localization

- `Accept-Language: ar|en` (default `ar`) affects only server-generated user text: notifications, SMS and PDFs. Reference data with display names returns `nameAr` and `nameEn`.

## 10. Files

- Uploads use `multipart/form-data` with an explicit size and MIME allow-list. Downloads use stable URLs behind the same auth, or short-lived signed URLs once object storage is in place.

## 11. Rate limits and security

- OTP request/verify and public endpoints are rate limited, and return `429 RATE_LIMITED` or `OTP_COOLDOWN` with `details.retryAfterSeconds`.
- Never return secrets, token hashes, OTP codes (except `devOtp` outside production), raw receipt bytes without permission, or other principals' PII.
- Driver position ingestion accepts only positions for the trip currently assigned to that driver.

## 12. Real-time

- Live tracking for v1 is **polling**: `GET …/trips/:id/live` every 10–15 s, returning the last position, progress, ETA and next stop. A WebSocket/SSE channel may be added later as an optional optimisation with the same payload shape.

## 13. OpenAPI

- `zool-go-backend/docs/openapi.yaml` is the published contract, served at `/docs`. Every endpoint added or changed updates it in the same PR.
- `tests/architecture/openapi-parity.test.ts` (runs in CI) fails if a served route is undocumented or a documented route is not served. Request and response schemas in the YAML are still maintained by hand; generating them from Zod is optional future work.
