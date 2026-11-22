# ZoolGo — Screen → API Map (MASTER_PLAN phase 1)

Every mobile screen in Figma (`sz5wZeoY4Bz4rOVhnFpkWq`, page "Test Design", 54 frames), and the endpoint(s) that serve it. Rules for all endpoints: `API_CONVENTIONS.md`. This map is the backlog for phases 2, 3 and 6.

**Status legend:**
- ✅ exists and fits the screen
- ⚠️ exists but is missing fields or behaviour
- ❌ missing
- 🎨 design gap (the screen or state must be added or fixed in Figma; the API is specified anyway)

Updated 2026-11-22: phase 6 implemented every endpoint below (customer, driver, broker); 🎨 marks are design gaps only. Avatar upload and saved cards wait for phase 7 (S3, PSP).

---

## 0. What the current backend can and cannot carry

> Historical (phase 1 analysis). Everything in the right column was delivered in phase 2 (2026-11-21).

| Area | Today | Needed (phase 2 schema) |
|---|---|---|
| `Trip` | `origin`/`destination` are free text; `departureAt`, `basePrice`, `companyId` | Station refs, `arrivalAt`/`durationMinutes`, ordered `TripStop[]`, `vehicleId`, `driverId`, `serviceClass`, amenities, `tripNumber`, lifecycle `status` (`SCHEDULED`/`BOARDING`/`IN_PROGRESS`/`COMPLETED`/`CANCELLED`) |
| Seats | `TripSeat` labels created per trip | Seat **layout** from `Vehicle` (rows, columns, aisle, driver position, `isWomenOnly`) copied onto `TripSeat` |
| `SeatHold` | **requires** `officeId` + `employeeId` | Owner is either a broker employee or a customer (nullable FKs + `customerId`) |
| `Booking` | **requires** `officeId` + `employeeId`; statuses `CONFIRMED`/`CANCELLED` | `channel` (`BROKER`/`DIRECT`), nullable office/employee, `customerId`, `bookingRef`, `PENDING_PAYMENT` status, coupon and discount fields |
| `BookingPassenger` | `fullName`, `phone`, `idNumber` | + `gender` (women-only seats) |
| `Ticket` | per passenger + seat | + signed QR payload, `boardingStatus` (`PENDING`/`BOARDED`/`NO_SHOW`), `boardedAt` |
| `TransportCompany` | `key`, `name`, `status` | + `legalName`, `shortName`, `logoUrl`, rating aggregate |
| New tables | — | `Customer` (+ identity/OTP/session), `Driver` (+ identity/OTP/session), `Vehicle`, `City`, `Station`, `Route`/`RouteStop`, `TripStop`, `Amenity`, `PaymentIntent` (customer), `Coupon`, `CarrierRating`, `Notification`, `DeviceToken`, `VehiclePosition`, `BoardingScan`, `SystemSetting`, `ContentPage` |

All of these are additive: existing columns are made nullable or kept, and nothing is renamed (MASTER_PLAN rule 2).

---

## 1. Customer app (34 frames)

### Shared / bootstrap
| Need | Endpoint | Status |
|---|---|---|
| App config: supported languages, default country +249, currency, OTP resend seconds, min app version, support contacts | `GET /public/app-config` | ✅ |
| Cities and stations for the from/to pickers | `GET /public/cities?q=` (each city with its stations) | ✅ |
| Legal pages (privacy) | `GET /public/content/:slug` → `{ title, sections[], updatedAt }` | ✅ |

### Splash ×4, Onboarding ×6
Static. Splash calls `app-config` and, if a refresh token is stored, `POST /customer/auth/refresh`.

### Login (3074:2136, 3074:4082)
| Need | Endpoint | Status |
|---|---|---|
| Request OTP for a phone | `POST /customer/auth/otp/request { phone }` → `{ challengeId, resendAfterSeconds }` | ✅ |
| Verify OTP; creates the customer on first login | `POST /customer/auth/otp/verify { phone, code, challengeId }` → `{ accessToken, refreshToken, customer, isNewCustomer }` | ✅ |
| Refresh / logout | `POST /customer/auth/refresh`, `POST /customer/auth/logout` | ✅ |

🎨 The default country must be **+249**. Drop the **email** tab for v1 (phone OTP only). "Create account" is not a separate flow: show a one-field "your name" step when `isNewCustomer`.

### Home (3074:2225)
| Need | Endpoint | Status |
|---|---|---|
| Greeting name, avatar | `GET /customer/me` | ✅ |
| Unread notifications dot | `GET /customer/notifications/unread-count` | ✅ |
| Recent searches | `GET /customer/recent-searches` (saved server-side on each search, so they survive a reinstall) | ✅ |
| Popular destinations with "from" price | `GET /public/destinations/popular` → `{ city, imageUrl, fromPriceMinor }[]` | ✅ |
| Search (one-way or **round trip**, D-RT-01) | → Results; for a round trip the app searches the outbound date, then the return date (`GET /customer/trips?…&date=<return>&fromCityId=<to>&toCityId=<from>`) | ✅ |

### Results (3074:2473), Loading (2718), Empty (2814), Error (2839)
| Need | Endpoint | Status |
|---|---|---|
| Search trips (all active carriers, no broker assignment filter) | `GET /customer/trips?fromCityId&toCityId&date&passengers&sort&carrierId&departureFrom&departureTo&amenity&serviceClass` | ✅ |
| Card fields | carrier `{ shortName, legalName, logoUrl }`, `departureAt`, `arrivalAt`, `durationMinutes`, origin/destination station, `isDirect`, `seatsAvailable`, amenity codes, `priceMinor` | ✅ |
| Sort | `sort=recommended` (default), `departureAt`, `priceMinor`, `durationMinutes` | ✅ |
| Filter sheet data | `GET /customer/trips/filters?…same query` → carriers, price range, amenities, classes present in the results | ✅ |

🎨 Filter sheet and sort menu are not designed. Result cards must match the searched route and date: the API returns **only the searched date**.

### Trip Detail (3074:2864)
| Need | Endpoint | Status |
|---|---|---|
| Carrier + rating/reviews, class, times, ordered stops (city, station, time), amenities (code, label, optional value such as luggage kg), price, seats available | `GET /customer/trips/:id` | ✅ |

### Seat selection (3074:3265) + "seat not available" modal (3074:4249)
| Need | Endpoint | Status |
|---|---|---|
| Seat map: layout grid, driver position, each seat `{ label, state: AVAILABLE/HELD/SOLD, isWomenOnly }` | `GET /customer/trips/:id/seats` | ✅ |
| Hold the selected seats | `POST /customer/trips/:id/holds { seatLabels[] }` → `{ holdId, expiresAt }`. `409 SEAT_UNAVAILABLE` → show the modal. Round trip: one hold per leg | ✅ |
| Release | `DELETE /customer/holds/:id` | ✅ |

🎨 Seat labels: the layout defines them and every screen shows the same label. The design mixes `8`, `A12` and `12A`. Show the hold countdown.

### Passenger details — 🎨 **screen missing**
| Need | Endpoint | Status |
|---|---|---|
| One form per seat: `fullName`, `gender` (required if the seat is women-only), optional `phone` and `idNumber` | sent in the booking create body | ✅ |

### Booking Review / Checkout (3074:3175) + processing modal (3074:4255)
| Need | Endpoint | Status |
|---|---|---|
| Price breakdown, coupon validation, cash eligibility | `POST /customer/bookings/quote { holdIds[1-2], passengers[], couponCode? }` → per leg + total `{ subtotalMinor, discountMinor, totalMinor, coupon, cashAllowed, cashBlockedReason? }` | ✅ |
| Create booking(s) + payment | `POST /customer/bookings { holdIds[1-2], passengers[], couponCode?, paymentMethod: ONLINE\|CASH_ON_BOARD }` + `Idempotency-Key` → `{ group?, bookings[], payment }`. ONLINE → `PENDING_PAYMENT` + `{ intentId, nextAction }`; CASH → `CONFIRMED` + `UNPAID_CASH` (D-CASH-01) | ✅ |
| Payment completes | provider webhook `POST /payments/webhooks/:provider` (exists for broker top-ups) → booking `CONFIRMED`, tickets issued, notification | ✅ (customer intents are dispatched from the same webhook) |
| App polls the result | `GET /customer/bookings/:id` | ✅ |

🎨 Payment success/failure screens, the card/wallet provider page and the "hold expired" state are missing. Payment methods are provider-agnostic until D-PAY-01 picks the PSP.

### My Trips (3074:3697 upcoming, 3992 ongoing, 4036 past)
| Need | Endpoint | Status |
|---|---|---|
| Tabs | `GET /customer/bookings?tab=UPCOMING\|ONGOING\|PAST\|CANCELLED` | ✅ |
| Ongoing card: next station, ETA, progress % | `GET /customer/bookings/:id/live` for the ONGOING card | ✅ |
| Cancel | `GET /customer/bookings/:id/cancellation-quote` → refund amount; `POST /customer/bookings/:id/cancel` | ✅ |
| "تعديل الرحلة" (D-CHG-01) | Change seat: `POST /customer/bookings/:id/change-seat { from, to }`. Change trip: `GET /customer/bookings/:id/change-options?date=` → `POST /customer/bookings/:id/change-quote { newTripId, seatLabels[] }` → `{ priceDiffMinor, changeFeeMinor, payMinor \| refundMinor }` → `POST /customer/bookings/:id/change` + `Idempotency-Key` | ✅ |
| "Book again" | client re-runs the search with the same cities | — |

🎨 Not designed: the cancelled tab, the cancel confirmation (with refund amount), the **modify flow** (choose seat or new date → difference → pay/refund), round-trip cards (two legs under one booking group) and empty states.

### Rate carrier modal (3074:4230)
| Need | Endpoint | Status |
|---|---|---|
| Rate after a completed trip (one per booking) | `POST /customer/bookings/:id/rating { stars, comment? }` | ✅ |

### My Ticket (3074:3503)
| Need | Endpoint | Status |
|---|---|---|
| One ticket per passenger: number, status, passenger, seat, trip number, class, date, carrier, QR payload | `GET /customer/bookings/:id` (tickets[]) and `GET /customer/tickets/:ticketNumber` | ✅ |
| PDF / share | `GET /customer/tickets/:ticketNumber/pdf` | ✅ |

🎨 Show a **QR code**, not a 1-D barcode. The payload is a server-signed token that the driver app verifies. Design the cancelled/used/expired badges.

### Live tracking map (3074:3620)
| Need | Endpoint | Status |
|---|---|---|
| Position, route polyline, progress %, remaining km, ETA, next station, timeline | `GET /customer/bookings/:id/live` (polled every 10–15 s; only while the trip is `BOARDING`/`IN_PROGRESS`) | ✅ |
| Support | `support` contacts from `app-config` | ✅ |

### Notifications (3074:3942)
| Need | Endpoint | Status |
|---|---|---|
| Feed grouped by day | `GET /customer/notifications?page` → `{ id, type, title, body, data(deepLink), isRead, createdAt }` | ✅ |
| Mark read / all read | `POST /customer/notifications/:id/read`, `POST /customer/notifications/read-all` | ✅ |
| Push | `POST /customer/devices { platform, pushToken }`, `DELETE /customer/devices/:token` | ✅ |
| Types | `TICKET_ISSUED`, `PAYMENT_SUCCEEDED`, `PAYMENT_FAILED`, `DEPARTURE_REMINDER`, `TRIP_RESCHEDULED`, `TRIP_CANCELLED` (carrier suspension, D-SUS-01), `RATE_TRIP`, `PROMO` | ✅ |

### Profile (3074:2394)
| Need | Endpoint | Status |
|---|---|---|
| Name, phone, email, avatar, stats (trips count, destinations count) | `GET /customer/me` | ✅ |
| Edit name/email/avatar | `PATCH /customer/me` (avatar upload `POST /customer/me/avatar` → phase 7 with S3) | ✅ |
| Trip alerts toggle | `PATCH /customer/me/preferences { tripAlerts, language }` | ✅ |
| Delete account | `DELETE /customer/me` (anonymise PII; keep bookings for accounting) | ✅ |

🎨 "تقييمك 4.8" (the customer's own rating): nobody rates customers in this product. Remove it or replace it with something like "وجهات".

### Payment methods (3074:3017)
| Need | Endpoint | Status |
|---|---|---|
| Saved methods | `GET /customer/payments/methods` → always includes `CASH_ON_BOARD` (with `eligible` + reason); saved cards are **blocked on D-PAY-01** (tokenisation depends on the PSP) | ✅ |

🎨 Checkout must offer **cash to driver** (D-CASH-01) and show why it is unavailable when blocked (limit reached, too close to departure, carrier disabled).

### Privacy (3074:3059), Settings (3074:3132)
`GET /public/content/privacy` (✅). Language is saved through `PATCH /customer/me/preferences`. Theme is local only.

---

## 2. Driver app (8 frames)

| Screen | Need | Endpoint | Status |
|---|---|---|---|
| Login 🎨 not designed | Phone OTP | `POST /driver/auth/otp/request`, `/otp/verify`, `/refresh`, `/logout` | ✅ |
| Home (3043:2004) | Name, company, today KPIs (trips, booked seats), current trip, today's/next trips | `GET /driver/me`, `GET /driver/dashboard` | ✅ |
| Trips list (3043:3652) | Tabs upcoming / current / completed | `GET /driver/trips?tab=UPCOMING\|CURRENT\|COMPLETED` | ✅ |
| Trip details (3043:3170) | Trip number, stops timeline with progress, company, driver, vehicle plate + model, boarded count, live position | `GET /driver/trips/:id` | ✅ |
| 🎨 Trip lifecycle (missing buttons) | Start boarding, depart, arrive at stop, complete | `POST /driver/trips/:id/status { status: BOARDING\|IN_PROGRESS\|COMPLETED }`, `POST /driver/trips/:id/stops/:stopId { event: ARRIVED|DEPARTED }` | ✅ |
| GPS (D-GPS-01) | Background location while `IN_PROGRESS` | `POST /driver/trips/:id/positions { positions: [{ lat, lng, speedKmh, heading, recordedAt }] }` (batched, ≤100) | ✅ |
| Passenger boarding (3043:3234) | Manifest: seat, name, phone, boarding status; boarded/booked counts | `GET /driver/trips/:id/manifest` | ✅ |
| QR scanner (3043:3291) + result card (3043:3312) | Verify a code without boarding the passenger yet | `POST /driver/trips/:id/scan { code }` → `VALID \| ALREADY_BOARDED \| WRONG_TRIP \| CANCELLED \| INVALID` + passenger, seat, route, departure | ✅ |
| "Register & continue" | Board | `POST /driver/trips/:id/boardings { ticketNumber, cashCollectedMinor? }` (idempotent). For `UNPAID_CASH` tickets the scan result shows the amount to collect and boarding records the `CashCollection` (D-CASH-01) | ✅ |
| Cash summary for the trip | `GET /driver/trips/:id/cash` → expected vs collected | ✅ |
| 🎨 Manual check-in / no-show | Board without a QR; mark no-show after departure | same endpoint with `method: MANUAL`; `POST /driver/trips/:id/no-shows { ticketNumber }` | ✅ |
| Profile (3043:4049) | Name, driver code, phone, company, license expiry/status | `GET /driver/me` | ✅ |

🎨 The driver app also needs: a login screen, start/complete trip actions, invalid-scan states, manual check-in, a call-passenger action, and empty states. The company name is inconsistent between Home and Profile.

---

## 3. Broker app (12 frames) — same API for broker web (D-BROKER-CHANNEL-01)

| Screen | Need | Endpoint | Status |
|---|---|---|---|
| Login 🎨 not designed | Phone OTP | `POST /broker/auth/otp/request`, `/otp/verify`, `/refresh`, `/logout`, `GET /broker/auth/me` | ✅ (web cookie; mobile body token with `X-Client-Platform`) |
| Home (3083:1840) | Agent name, office name, today's bookings / sales / commission, wallet balance | `GET /broker/dashboard`: today's `ticketsSold`, `grossSalesMinor`, `commissionAccruedMinor` (office-wide for managers, own sales for clerks) + `walletBalanceMinor` | ✅ |
| Notifications bell | Unread + feed + push | `GET /broker/notifications…`, `POST /broker/devices` | ✅ |
| New booking search (3083:1881) | Cities, date, passengers | `GET /public/cities` | ✅ |
| Results (3083:2001) | Assigned carriers only; stations, arrival, duration, direct, amenities, seats left, price, **commission %** | `GET /broker/trips?fromCityId&toCityId&date` | ✅ (`fromCityId`/`toCityId`, structured view) |
| Trip detail (3083:2246) | Stops, amenities, rating, class | `GET /broker/trips/:id` | ✅ |
| Seat selection (3083:2396) | Layout + women-only | `GET /broker/trips/:id` (seats), `POST /broker/trips/:id/holds`, `DELETE /broker/holds/:id` | ✅ |
| Passenger data (3083:2634) | Name, ID number, **+ gender, phone** 🎨 | in quote/confirm body | ✅ |
| Review (3083:2677) | Ticket total, commission earned, balance before/after | `POST /broker/bookings/quote` | ✅ — 🎨 **fix the design math**: the debit is the full 350 and the commission (35) is earned and settled later, so the "net debit 315" line is wrong (API_CONVENTIONS §5) |
| Confirm & pay from wallet | | `POST /broker/bookings/confirm` + `Idempotency-Key` | ✅ (`INSUFFICIENT_BALANCE`, `HOLD_EXPIRED`, `EXPOSURE_CEILING_EXCEEDED` states 🎨 not designed) |
| Booking details (3086:2544) | Ref, route + stations, departure, seats, total, commission, passengers | `GET /broker/bookings/:id` | ✅ |
| Send / share ticket | PDF download (D-TICKET-01: download only) | `GET /broker/bookings/:id/tickets/:ticketNumber/pdf`, `POST /broker/bookings/:id/dispatch` | ✅ |
| Bookings list (3083:1927) | Tabs active / completed / cancelled | `GET /broker/bookings?tab=ACTIVE\|COMPLETED\|CANCELLED` | ✅ (`tab`, `q`) |
| 🎨 Cancel booking (no button in design) | Refund to wallet + clawback | `POST /broker/bookings/:id/cancel` | ✅ |
| 🎨 Modify booking (D-CHG-01) | Change seat / change trip with wallet debit or refund of the difference | `POST /broker/bookings/:id/change-seat`, `…/change-quote`, `…/change` | ✅ |
| Round trip (D-RT-01) | Two holds → one quote → one confirm | `POST /broker/bookings/quote` and `/confirm` accept `holdIds[1-2]` | ✅ (`returnTrip`) |
| My ticket (3083:2743) | Same ticket view as the customer's (QR) | `GET /broker/bookings/:id` (tickets[]) | ✅ (`qrPayload`) |
| 🎨 Wallet / top-up (no screen in design) | Balance, ledger, top-up with receipt | `GET /broker/wallet`, `GET /broker/wallet/ledger`, `POST /broker/wallet/top-ups`, `POST /broker/wallet/top-ups/:id/evidence` | ✅ |
| Profile (3083:2921) | Agent name, role, office | `GET /broker/auth/me` | ✅ (🎨 the "company + rating" card is wrong for an office) |
| Staff, commissions, reports (web panel) | | `/broker/staff`, `/broker/commissions`, `/broker/reports/*` | ✅ |

---

## 4. Design corrections for the designer (all apps)

1. **Sudanese sample data:** cities (Khartoum, Port Sudan, Kassala, Atbara, Merowe, Shendi …), currency **ج.س / SDG** (the design shows ر.س and ج.م), phone **+249**.
2. **One seat-label format** everywhere, taken from the bus layout.
3. **QR code** on tickets, not a barcode.
4. **Missing screens:** customer passenger details, payment result, cancel booking + refund, filter/sort; driver login, trip start/complete, invalid scan, manual check-in; broker login, wallet/top-up, cancel booking, insufficient balance.
5. **Broker review math** (§3). **Round trip** (D-RT-01): add the return-date picker, a two-leg results/seat flow and two-leg review, ticket and My Trips cards. **Modify** and **cash** flows (D-CHG-01, D-CASH-01).
6. **Consistent carrier and office names** across the screens of one flow.
7. **Empty / loading / error states** for lists (My Trips, Notifications, bookings, manifest).

## 5. Admin dashboard additions implied by the apps (phase 3)

Cities/stations, vehicles with seat layouts, drivers, routes, trip stops/assignments, customers (read and support), coupons, carrier ratings, content pages, system settings (D-SET-02), notifications broadcast, carrier-suspension "affected bookings" and cancel-trip with full refund (D-SUS-01).

## 6. Counts

| App | Screens (distinct) | Endpoints needed | ✅ | ⚠️ | ❌ |
|---|---|---|---|---|---|
| Customer | 16 | ~45 | all | 0 | 0 (avatar upload → phase 7) |
| Driver | 7 | ~16 | all | 0 | 0 |
| Broker | 11 | ~30 | all | 0 | 0 |

All three apps are served by the API (phase 6, 2026-11-22). Contract: `zool-go-backend/docs/openapi.yaml`.
