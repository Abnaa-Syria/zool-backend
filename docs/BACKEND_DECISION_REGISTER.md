# ZoolGo Backend Decision Register

Product/authority decisions for backend design.

**Authority for the first business vertical:** `ZoolGo_Broker_Journey.pdf` is the sole source of truth for broker office flows.  
Prior informal chat proposals that conflicted with the PDF (single-user broker, Hybrid top-up as normal path, exceptional admin credit as allowed) are **superseded** and must not drive design.

**Status legend:**

| Status | Meaning |
|--------|---------|
| **LOCKED (PDF)** | Bound to the Broker Journey PDF; do not reopen without an explicit PO override documented here |
| **OUT OF SCOPE (PDF)** | Absent from the PDF for this vertical; unauthorized until a future PO decision |
| **OPEN** | Still unresolved (often numeric/provider detail) |
| **SUPERSEDED** | Earlier assumption discarded |

Milestone slices:

- **M0 — Infrastructure / authentication foundation** — Stage 1 backend complete (central admin OTP + RBAC).  
- **M1 — First business vertical** — Broker office booking + prepaid wallet + commission (bound by locked rows below). Implemented as **Stage 2 backend APIs** with a **mock payment confirmation port** (`PAYMENT_PROVIDER=mock`); real PSP remains OPEN.

A topic blocks a slice only if that slice cannot be designed correctly without the answer.

**Lock date:** 2026-10-20

---

## Locked for next vertical (Broker Journey PDF)

### In scope (design against these)

| ID | Locked decision | PDF basis |
|----|-----------------|-----------|
| **SCOPE-01** | First vertical = broker office panel: prepaid wallet, Super-Admin-assigned carriers, office booking for a traveler (not the broker), commission accrual/clawback, manual commission payout, periodic settlement date | Whole doc; §1–§3 |
| **D-AUTH-BROKER** | Broker = **office/agency** (not an individual). Web login with a **main account + multiple employees**. Manager adds staff and sets permissions (book only, or book + top-up + reports). Booking/commission views filterable by employee | §2 login; §3.1; §4 staff; §6 account type |
| **D-TOP-01** | Dual path: (1) **AUTOMATIC** provider-confirmed credit; (2) **MANUAL** receipt review on the same intent. PDF architectural normal path is automatic. **M1 production enabled/usable path is MANUAL** until a real PSP is selected. Mock confirm is non-production only. Not Stitch queue-as-normal; not exceptional free credit | §4 شاشة الشحن; §6 آلية الشحن; Stage 2.6 lock; Milestone A 2026-10-23 clarification |
| **D-COM-01** | Booking confirm: **immediate wallet debit** (no external gateway at checkout). Commission **accrues per booking** at the **per-carrier** rate. Ticket cancel: **auto commission clawback**. Commission **payout is manual by admin**. Settlement cadence weekly/monthly with last-settlement date per broker | §2 pay; §3.10–§3.13; §6 |
| **D-RATE-01** | Commission % authority = **per transport company / assignment only**. Broker search/results limited to assigned carriers | §2; §4 شركاتي; §6 |
| **D-REF-01** | Broker cancel/refund: funds return to **agency wallet**; commission clawed back. **Do not invent** time-to-departure retention tiers for this vertical (PDF silent on %) | §2 cancel; §6 |
| **D-ACC-01** | Money integrity for M1 = **wallet ledger + commission records + settlement date** (transaction records). Full CoA / journals / trial balance **deferred** | §4 wallet / statement / commissions |
| **D-POL-01** | Global defaults + optional office overrides; money in minor units (`*Minor`); daily exposure uses office IANA timezone else `PLATFORM_TIMEZONE`; current numbers are **M1 defaults**, not commercial policy | §5–§7; Stage 2.6 |
| **D-CUR-01** | **SDG** is the only M1 currency (wallets, bookings, tickets, commissions, refunds, reports) | Stage 2.6 |
| **D-TICKET-01** | M1 tickets = secure PDF generate / download / print. WhatsApp and SMS remain disabled until a provider is selected | PDF §3.11; Stage 2.6 |
| **D-BOOK-01** | Booking list APIs support carrier, employee, broker office, status and date filters | PDF §3.12; Stage 2.6 |
| **D-SEAT-01** | Backend supports MANUAL and AUTO seat assignment; MANUAL is the frontend default; both use the same atomic hold rules; AUTO orders by numeric `sortOrder` | PDF §3.6; Stage 2.6 |
| **D-ADMIN-BOOK-01** | Authorized admins list/inspect bookings across offices. View, cancel and override are separate permissions. Override is **reserved / unimplemented** in M1 | Stage 2.6 |
| **D-SET-01** | Commission settlement is a persisted period record. DRAFT reserves accruals; CANCELLED releases; finalize is manual and idempotent. No scheduler in M1 | PDF §6; Stage 2.6 |
| **D-ADMIN-TOPUP-01** | Broker may attach evidence to **its own** failed/unverified intent. Admin may initiate the same workflow on behalf of an office. Only authorized admins approve or reject. Not arbitrary free credit | Stage 2.6 |

### Explicitly out of scope / unauthorized for this vertical

| Topic | Status |
|-------|--------|
| **D-ADJ-01** Exceptional Super Admin wallet credit/debit outside normal top-up | **OUT OF SCOPE (PDF)** — not in PDF; unauthorized until future PO decision |
| Manual bank-receipt top-up queue (Stitch `_24`) as normal top-up | **SUPERSEDED** — conflicts with PDF automatic credit |
| Single Broker Admin with no employees | **SUPERSEDED** — contradicts PDF multi-employee office |
| Hybrid top-up (auto + manual) as the locked normal path | **SUPERSEDED** — PDF is automatic-after-confirmation only |
| Customer Bankak / customer app journey (**D-PAY-01**) | Different journey — out of this vertical |
| Production GPS (**D-GPS-01**) | Out of Broker Journey PDF |
| Carrier platform take-rate / carrier revenue settlement (**D-REV-01**) | Out of PDF (broker commission payout only) |
| Full GL product | Out of PDF |
| Customer time-tiered refund matrix | Out of PDF for broker vertical |

### Booking flow reference (PDF §3 — design checklist, not implementation)

1. Login as office manager or authorized employee  
2. Home: balance, low-balance warning, assigned carriers only  
3. Search trips (assigned carriers only)  
4. Results: price + broker commission % per carrier  
5. Trip details  
6. Seat map with 15-minute hold (or auto-assign)  
7. If seat lost before pay → return to seat selection  
8. Enter **traveler** PII (not the broker identity); multi-passenger allowed  
9. Review: expected commission + remaining wallet balance after debit  
10. Confirm: wallet debit; insufficient balance → block + top-up  
11. Issue ticket in traveler’s name; WhatsApp / PDF / print  
12. Office booking history (employee, carrier, date, status filters)  
13. Commissions + wallet statement + last settlement date  

### Extra error cases (PDF §5)

- Insufficient wallet balance  
- Booking limit exceeded  
- Unauthorized company access  
- Below minimum top-up  
- Employee session expired mid-booking  

---

## D-TOP-01 — Normal broker wallet top-up confirmation

**Status:** **LOCKED (PDF + Stage 2.6)** — 2026-10-23; **operational clarification 2026-10-23 (Milestone A)**

**Question:** How is a *normal* broker wallet top-up confirmed and credited?

**Locked decision (architectural, from PDF + Stage 2.6):**

- **Automatic path:** wallet credit after **verified payment confirmation** (provider adapter + signed webhook). Idempotent credit; never credit the same payment twice.
- **Manual path:** evidence-based receipt review (`MANUAL_FALLBACK`) on the **same** intent/payment when automatic confirmation failed, remained unverified, or is not yet available. This is a confirmation path, not a different PSP and not arbitrary free credit.
- Stitch `_24` receipt-queue-as-**normal**-path remains **SUPERSEDED**.

**Operational clarification (2026-10-23, Milestone A) — does not hide the PDF lock above:**

ZoolGo supports both:

1. AUTOMATIC provider-confirmed top-ups.
2. MANUAL receipt-reviewed top-ups.

For the current M1 production operation, **MANUAL receipt review is the enabled and usable top-up path** until a real payment provider is selected and integrated.

The automatic path remains supported architecturally. A mock provider may be used in **non-production development and tests only**. Production must reject development-only mock confirmation.

After a real provider is enabled, automatic confirmation may become the preferred path while manual receipt review remains available as fallback.

Both paths use the same idempotent wallet-credit operation and must never credit the same payment twice.

Also:

- Broker offices may submit their own manual top-up requests.
- Authorized admins may submit a request on behalf of an office.
- Only authorized admins may approve or reject manual evidence.
- Manual review is not arbitrary free balance adjustment.
- `amountMinor` is fixed by the intent and is not accepted by the approve endpoint.
- Exceptional unfunded administrative credit remains out of scope (**D-ADJ-01**).

**Cross-channel idempotency:** normalize payment references; unique `providerEventId`; ledger key `topup:{intentId}`; lock intent + wallet during confirmation.

**Blocks M0?** No.  
**Blocks M1?** No.

---

## D-ADJ-01 — Exceptional financial adjustments

**Status:** **OUT OF SCOPE (PDF)** — 2026-10-20

**Question:** May central admins credit/debit broker wallets outside the normal top-up confirmation path?

**Locked posture:** **Unauthorized / out of scope** until an explicit future PO decision. Do not implement exceptional credit as part of M1 broker vertical.

**Superseded:** Chat proposal to allow Super Admin adjustments with reason codes.

**Blocks M0?** No.  
**Blocks M1?** No — M1 uses PDF top-up + booking debit/refund/commission only.

---

## D-ACC-01 — Full general accounting product scope

**Status:** **LOCKED (PDF)** for M1 money integrity — 2026-10-20

**Locked decision:** M1 requires **reliable transaction records** (wallet movements, commission accruals/reversals, payouts, settlement date) with idempotency and immutable history. **Full GL** (CoA, journals as product, trial balance, financial statements) is **deferred**.

| Layer | Meaning |
|---|---|
| **Reliable transaction records** | Required for M1 |
| **Optional full general accounting** | Deferred; Stitch/frontend GL remain proposals |

**Blocks M0?** No.  
**Blocks M1?** No.

---

## D-COM-01 — Commission recognition boundary

**Status:** **LOCKED (PDF)** — 2026-10-20

**Locked decision:**

- Booking confirm performs **immediate agency wallet debit** (no external payment gateway at checkout).  
- Commission **accrues with each booking** at the carrier’s broker %.  
- On **ticket cancellation**, commission is **automatically clawed back**.  
- **Payout** of accumulated commission is **manual by admin**, not automatic.  
- Engineering framing: prefer **one atomic confirm** (wallet debit + seat confirm + ticket issue + commission accrual) with compensating reversals on partial failure — consistent with PDF rules without inventing a split lifecycle.

**Blocks M0?** No.  
**Blocks M1?** No.

---

## D-PAY-01 — Customer Bankak confirmation mechanism

**Status:** **OPEN** (customer vertical only)

**Question:** How are direct-customer Bankak payments confirmed?

**Note:** Does **not** block M1 broker-first. Broker checkout uses wallet debit, not Bankak.

**2026-11-21 (PO):** the payment provider is chosen later. Until then the customer checkout is built **provider-agnostic**: `PaymentIntent` + the existing `PaymentProvider` port with the `mock` adapter, webhook confirmation, and refunds to the original method. A real adapter (Bankak / SyberPay / …) plugs in without API changes. The provider choice itself stays OPEN.

**Blocks M0?** No.  
**Blocks M1 (broker-first)?** No.

---

## D-REF-01 — Cancellation retention / fee tiers

**Status:** **LOCKED (PDF)** for broker vertical destination/clawback — 2026-10-20  
**OPEN** for customer time-tier retention % (not in Broker Journey PDF)

**Locked for broker M1:** Cancel returns funds to the **agency wallet**; commission is clawed back. **Do not invent** retention tiers for broker cancels.

**Blocks M0?** No.  
**Blocks M1?** No for broker path.

---

## D-REF-02 — Customer cancellation and refunds (direct channel)

**Status:** **ENGINEERING DEFAULT** — 2026-11-22 (PO may change the numbers in admin settings at any time; no code change).

1. A customer may cancel until `refund.customerCutoffMinutesBeforeDeparture` (default 60 min) before departure, if no passenger boarded.
2. Fee kept: `refund.customerFeeBasisPoints` (default **0** = full refund) of the paid amount. Admin cancellations and trips cancelled by the carrier/admin (D-SUS-01) never charge a fee.
3. Paid online bookings are refunded to the original method through the payment provider port (`refundCharge`). A refund the provider does not confirm stays `PENDING` in the admin refunds queue. Unpaid cash bookings need no refund. An unpaid online checkout is voided as a whole (both legs of a round trip).
4. A payment that arrives after its checkout expired is recorded and queued as a full refund (`late-payment`).


## D-CARRIER-PORTAL-01 — Transport company portal

**Status:** **LOCKED (PO)** — 2026-11-22

1. Transport companies get their own **web portal** (`zool-carrier-dashboard`, API `/api/v1/carrier/*`), with staff accounts (phone + OTP) and permissions (manager, operations, finance).
2. **The company operates, the platform oversees:** the company manages its own fleet, drivers, routes, trip scheduling and prices; the admin dashboard keeps full visibility and can edit, cancel or suspend at any time. Every change is audited with the actor.
3. The company sees its bookings, trip manifests, live tracking of its buses, sales by channel, cash collected by each driver, and its settlement statements.

## D-REV-02 — Carrier settlement model (configurable)

**Status:** **LOCKED as configurable; values OPEN (PO)** — 2026-11-22. Replaces the D-REV-01 "out of scope" posture.

- Per carrier, set from the admin dashboard: **platform fee** (`NONE` | `PERCENT` basis points | `FIXED` minor units per ticket; default `NONE`) and **broker commission bearer** (`CARRIER` | `PLATFORM`; default `PLATFORM` = today's behaviour).
- Periodic statement per carrier: **net payable** = online sales + broker wallet sales + platform-funded coupon discounts − refunds − platform fee (on every ticket, any channel) − broker commissions (only when the carrier bears them). Cash collected by its drivers is already held by the carrier: shown for information, not part of the net. Positive: platform pays the carrier; negative: carrier owes the platform. Admin drafts, reviews, finalizes and records the payment reference; finalized statements are immutable.

## D-REV-01 — Platform take-rate and carrier settlement

**Status:** **OUT OF SCOPE** for M1 (PDF)

**Locked posture:** Out of M1. PDF requires **broker** commission payout (manual) only. Carrier revenue share remains Brief/UI assumption until PO elevates it.

**Blocks M0?** No.  
**Blocks M1?** No.

---

## D-AUTH-01 — Admin authentication and 2FA

**Status:** **OPEN** for central-admin 2FA strength  
**Note:** M0 central admin OTP+RBAC is already implemented in Stage 1.

**Broker side:** See **D-AUTH-BROKER** (LOCKED).

**Blocks M0?** Resolved for Stage 1 identity.  
**Blocks M1?** Broker multi-employee sessions required (locked under D-AUTH-BROKER); central admin 2FA detail does not block.

---

## D-AUTH-BROKER — Broker office identity model

**Status:** **LOCKED (PDF)** — 2026-10-20

**Locked decision:** Broker is an **office/agency** with web panel, a **main manager account**, and **multiple employees** with permissions (booking-only vs booking + top-up + reports). Wallet belongs to the office; actions are attributable to the employee.

**Superseded:** Single Broker Admin with no employees (informal chat).

**Blocks M0?** No.  
**Blocks M1?** Yes until modeled — identity shape is now locked.

---

## D-BROKER-CHANNEL-01 — Broker client surfaces

**Status:** **LOCKED (PO)** — 2026-11-21

**Locked decision:** Broker offices get **both** a desktop **web panel** and a **mobile app** (Figma "Test Design" broker screens). Both are clients of the same `/api/v1/broker/*` API; there is no separate backend. The web panel adds thermal printing, staff management and reports; the mobile app adds push notifications (device tokens).

**Sequencing (PO):** finish backend + admin dashboard + broker web panel + all mobile-app APIs (customer, driver, broker) first; mobile apps start only after the v1 API contract is frozen. See `docs/MASTER_PLAN.md`.

---

## D-GPS-01 — Production GPS source and protocol

**Status:** **LOCKED (PO)** — 2026-11-21

**Locked decision:** v1 GPS comes from the **driver mobile app** (phone GPS). While a trip is `IN_PROGRESS` the app posts position batches over HTTPS to a device-agnostic ingestion endpoint (`POST /driver/trips/:id/positions`); positions are stored as `VehiclePosition` and fanned out to the admin map and the customer "track trip" screen. The ingestion contract does not assume a phone, so hardware trackers can be added later without API changes.

**Blocks M1 (booking/wallet)?** No.

---

## D-POL-01 — PDF §7 numeric policies

**Status:** **LOCKED (PDF + Stage 2.6)** — 2026-10-23

**Locked:**

1. Global env defaults with optional broker-office overrides.  
2. Money stored and exposed as **minor units** (`amountMinor`, `minTopUpMinor`, `lowBalanceThresholdMinor`, …).  
3. Daily exposure ceiling uses the **office IANA timezone**, falling back to `PLATFORM_TIMEZONE`.  
4. Current numeric env values are **M1 defaults**, not permanent commercial policy.

**Still OPEN:** Future PO commercial numbers (may replace M1 defaults without schema change).

**Blocks M0?** No.  
**Blocks M1?** No.

---

## D-CUR-01 — Currency

**Status:** **LOCKED** — 2026-10-23  
**SDG** is the only supported M1 currency across wallets, bookings, tickets, commissions, refunds and reports.

---

## D-TICKET-01 — Ticket delivery

**Status:** **LOCKED** — 2026-10-23  
M1 supports secure PDF generation, download and printing. WhatsApp and SMS remain **disabled** until a provider is selected (`TICKET_CHANNEL_DISABLED`).

---

## D-BOOK-01 — Booking list filters

**Status:** **LOCKED** — 2026-10-23  
Booking list APIs support carrier (`companyId`), employee, broker office, status and date filters.

---

## D-SEAT-01 — Seat assignment

**Status:** **LOCKED** — 2026-10-23  
MANUAL and AUTO assignment; MANUAL is the frontend default. AUTO selects by numeric `sortOrder` (not lexicographic labels) with row locks / conditional updates. Same hold TTL and confirm rules.

---

## D-ADMIN-BOOK-01 — Admin booking inspect

**Status:** **LOCKED** — 2026-10-23  
Admins with `bookings.view` list/inspect across offices. `bookings.cancel` cancels with required reason, audit, refund + commission reversal in one idempotent transaction; never edits confirmed passenger/seat/fare/payment data. `bookings.override` is **catalogued but unimplemented** in M1.

---

## D-SET-01 — Commission settlement record

**Status:** **LOCKED** — 2026-10-23  
A settlement is a persisted period record. Creating a **DRAFT** **reserves** matching UNSETTLED accruals. **CANCELLED** releases them. Overlapping drafts for an office are forbidden. **FINALIZE** is manual, idempotent, and records payout evidence. No automatic scheduler in M1.

---

## D-ADMIN-TOPUP-01 — Manual evidence fallback

**Status:** **LOCKED** — 2026-10-23; **operational clarification 2026-10-23 (Milestone A)**

- Broker (office `broker.wallet.topup`) may submit multipart evidence on **its own** failed/unverified automatic intent, and may create a manual top-up request for its office.
- Admin `wallets.topups.create_for_office` may initiate the same workflow on behalf of an office.
- Only admins **approve** / **reject** (`wallets.topups.approve` / `wallets.topups.reject`). Approve never accepts or modifies the credited amount (`amountMinor` is fixed by the intent).
- Split permissions: `wallets.topups.view`, `create_for_office`, `review`, `approve`, `reject`, `evidence.view`.
- Not exceptional free credit (**D-ADJ-01** remains out of scope).
- **M1 production:** this MANUAL path is the **enabled and usable** top-up until a real provider is selected. Automatic remains architectural; mock confirmation is non-production only (see D-TOP-01 clarification 2026-10-23).

---

## D-SUS-01 — Account suspension policies

**Status:** **LOCKED (PO delegated to engineering)** — 2026-11-21

**Carrier (transport company) suspension:**
1. **Immediately:** the carrier's trips disappear from broker and customer search; no new holds, bookings or trips; active seat holds are released. Admins still see everything.
2. **Existing confirmed bookings on future trips are NOT auto-cancelled.** Suspension is often temporary or administrative, and mass auto-cancellation moves money irreversibly. Instead they are flagged: admin gets an "affected bookings" view per suspended carrier.
3. **Admin decides per trip:** "cancel trip" cancels every booking on it with a **100% refund and no cancellation fee** (the passenger is not at fault — overrides the D-REF-01 fee tiers): broker bookings are refunded to the office wallet with commission clawed back; direct-customer bookings are refunded to the original payment method. Passengers and offices are notified.
4. Trips already departed / in progress continue normally.
5. Reactivating the carrier restores search visibility. Every step is audited.

**Broker office suspension:** staff cannot sign in or book; wallet top-ups and debits are frozen; already-confirmed bookings stay valid (travellers did nothing wrong) and can still be cancelled/refunded by an admin.

**Blocks M0 / M1?** No.

---

## D-RATE-01 — Global vs per-carrier commission settings

**Status:** **LOCKED (PDF)** — 2026-10-20

**Locked decision:** Per-carrier (and assignment) broker commission % is authoritative. Platform-global `brokerCommissionPercent` / `platformCommissionPercent` UI fields are **non-authoritative** until PO says otherwise.

**Blocks M0?** No.  
**Blocks M1?** No.

---

## Blocker summary (after PDF lock)

| ID | Status | Blocks M1 broker vertical? |
|---|---|---|
| SCOPE-01 First vertical | LOCKED (PDF) | Defines scope |
| D-AUTH-BROKER Office + employees | LOCKED (PDF) | Shape locked |
| D-TOP-01 Top-up confirmation | LOCKED (PDF + Stage 2.6) | **No** (was Yes) |
| D-ADJ-01 Exceptional credit | OUT OF SCOPE (PDF) | No |
| D-ACC-01 Transaction records | LOCKED (PDF) | No |
| D-COM-01 Accrual / debit / clawback | LOCKED (PDF) | No |
| D-REF-01 Broker refund destination | LOCKED (PDF) | No |
| D-RATE-01 Per-carrier rates | LOCKED (PDF) | No |
| D-POL-01 Numeric policies | LOCKED (M1 defaults) | No |
| D-CUR-01 SDG | LOCKED | No |
| D-TICKET-01 PDF only | LOCKED | No |
| D-BOOK-01 Filters | LOCKED | No |
| D-SEAT-01 MANUAL/AUTO | LOCKED | No |
| D-ADMIN-BOOK-01 Admin bookings | LOCKED | No |
| D-SET-01 Settlement record | LOCKED | No |
| D-ADMIN-TOPUP-01 Evidence fallback | LOCKED | No |
| D-PAY-01 Customer Bankak | OPEN (provider); mechanism provider-agnostic | No (other vertical) |
| D-REV-01 Carrier settlement | OUT OF SCOPE | No |
| D-GPS-01 GPS | LOCKED (PO) — driver phone | No |
| D-SUS-01 Suspension | LOCKED (delegated) | No |
| D-SET-02 Runtime settings | LOCKED (PO) — hybrid DB + .env | No |
| D-CASH-01 Cash to driver | LOCKED (PO) — v1 | No |
| D-RT-01 Round trip | LOCKED (PO) — v1 | No |
| D-CHG-01 Modify booking | LOCKED (PO) — v1 | No |
| D-REF-02 Customer cancellation/refunds | ENGINEERING DEFAULT (settings) | No |
| D-CARRIER-PORTAL-01 Carrier web portal | LOCKED (PO) | No |
| D-REV-02 Carrier settlement (configurable) | LOCKED (values OPEN) | No |
| D-BROKER-CHANNEL-01 Broker web + mobile | LOCKED (PO) | No |

---

## D-CASH-01 — Cash payment to the driver (customer channel)

**Status:** **LOCKED (PO)** — 2026-11-21. Required in v1.

1. At checkout the customer may choose `CASH_ON_BOARD`. The booking is `CONFIRMED` with `paymentStatus = UNPAID_CASH` and tickets are issued immediately, so the seat is sold.
2. **Abuse limits** (all `SystemSetting`, editable by admin): cash enabled on/off, platform-wide and per carrier; max seats per cash booking (default 4); max open unpaid cash bookings per customer (default 2); cash closes N hours before departure (default 1 h); a customer with ≥ 2 cash no-shows loses cash eligibility.
3. **At boarding** the driver app shows "collect X SDG". Boarding a cash ticket records the collection (`CashCollection`: ticket, driver, amount, time) and sets `paymentStatus = PAID_CASH`.
4. Not boarded by departure → ticket `NO_SHOW`, booking `paymentStatus = UNPAID_CASH` stays as evidence, and it counts toward the no-show limit. No money moves.
5. Cancelling an unpaid cash booking needs no refund. Cash collected per trip and driver is reportable for carrier reconciliation (carrier settlement itself stays D-REV-01, out of scope).
6. Brokers never use cash: their channel is wallet-only (unchanged).

## D-RT-01 — Round trip

**Status:** **LOCKED (PO)** — 2026-11-21. Required in v1 (customer and broker).

1. A round trip is a `BookingGroup` (`type = ROUND_TRIP`) with **two ordinary bookings** (outbound and return). Each leg has its own trip, seats, passengers and tickets.
2. One checkout. Seats are held on both trips first; the quote covers both legs; one payment covers the total (customer: one `PaymentIntent` or cash; broker: one transaction with one wallet debit per leg, atomic). If either leg fails, nothing is booked.
3. The return trip must depart after the outbound arrival. The passenger list is the same for both legs.
4. After booking, each leg is managed independently: cancel or modify one leg, with refunds computed per leg.

## D-CHG-01 — Modify a booking (تعديل الرحلة)

**Status:** **LOCKED (PO)** — 2026-11-21. Required in v1, alongside cancellation, for customer and broker.

1. **Change seat on the same trip:** free, while the trip is `SCHEDULED`. The seat is swapped inside the booking and the ticket is re-issued with the same ticket number and a new seat.
2. **Change to another trip** (another date or time on the same carrier and route): allowed until the change cutoff (default 6 h before departure) and at most N times per booking (default 2).
   - The old booking becomes `CHANGED` (new terminal status) and its seats are released. A new booking is created with `replacesBookingId`. Both happen in one transaction.
   - **Price difference + change fee** (fee default 0, `SystemSetting`):
     - Higher price: the customer pays the difference (`PaymentIntent`, or cash at boarding for cash bookings); the broker wallet is debited the difference.
     - Lower price: the difference is refunded to the original method or wallet. Unpaid cash bookings have nothing to refund.
   - Broker commission: the old accrual is clawed back and a new one accrued on the new booking.
3. A change quote (`…/change-quote`) shows the difference and fee before the user confirms. Change after the cutoff returns `CHANGE_NOT_ALLOWED`.

---

## D-SET-02 — Runtime settings: database vs `.env`

**Status:** **LOCKED (PO)** — 2026-11-21

**Locked decision (hybrid):**
- **`.env` keeps** infrastructure and secrets: DB/Redis URLs, JWT/OTP/webhook secrets, provider credentials, ports, CORS, cookie flags. Never editable from the UI.
- **Database (`SystemSetting`) holds** business/operational settings editable from the admin dashboard: seat-hold TTL, minimum top-up, low-balance threshold, default exposure ceiling, settlement period default, cancellation windows, notification toggles, maintenance mode.
- On first boot each DB setting is seeded from its `.env` value (the `.env` value is the default/fallback). Reads are cached in Redis and invalidated on change. Changes require `settings.manage` and are written to the audit log with before/after values.

**Genuine remaining M1 design open items:** concrete production PSP adapter (webhook port is in place); future PO commercial numbers for §7.

---

## Highest-impact handoff question (resolved)

**Former question (top-up confirmation authority):** resolved **LOCKED (PDF)** to automatic credit after verified payment confirmation.

**Former informal alternatives (manual queue / Hybrid / single-user broker / exceptional credit allowed):** **SUPERSEDED**.

---

## Related

- [`BACKEND_READINESS_AUDIT.md`](BACKEND_READINESS_AUDIT.md)  
- [`BACKEND_REQUIREMENTS.md`](BACKEND_REQUIREMENTS.md)  
- [`ADMIN_DASHBOARD_BACKEND_GAP_AUDIT.md`](ADMIN_DASHBOARD_BACKEND_GAP_AUDIT.md)  
- [`archive/stage-plans/STAGE1_PLAN.md`](archive/stage-plans/STAGE1_PLAN.md) (M0 complete; next vertical bound by this register)  
