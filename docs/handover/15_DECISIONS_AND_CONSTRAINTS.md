# ZoolGo — Architectural Decisions, Locks, and Constraints

This document catalogs all locked architectural decisions, open product questions, deferred scopes, and superseded historical assumptions governing the ZoolGo platform.

---

## 1. Decision Authority Hierarchy

When evaluating conflicting requirements or design proposals, the receiving engineer must enforce this strict authority order:
1. **Current Production Source Code and Mounted Routes** in `zool-go-backend`
2. **Current Prisma Schemas and SQL Migrations**
3. **Automated Integration Tests** in `tests/`
4. **Locked Decisions in `docs/BACKEND_DECISION_REGISTER.md`**
5. **Primary Broker Journey Document:** `Zool/ZoolGo_Broker_Journey.pdf`
6. **Backend Requirements and Roadmaps:** `docs/ADMIN_BACKEND_COMPLETION_ROADMAP.md`
7. **Implemented Frontend Source:** `zool-go-dashpoard/src/`
8. **Stitch HTML Templates and Informal Chats:** *(Proposals only; non-authoritative)*

---

## 2. Master Decisions Register

| ID | Topic | Locked Architectural Decision | Implementation State | Architectural Consequences |
|---|---|---|---|---|
| **`SCOPE-01`** | First Business Vertical | The first revenue-generating vertical is the **Broker Office Panel**: prepaid wallet, central-admin-assigned carriers, office booking on behalf of walk-in travelers, per-carrier commission accrual, and periodic commission settlements. | **IMPLEMENTED** in Stage 2 backend | Direct customer booking, driver QR scanning, and consumer bank portals are not in M1. |
| **`D-CUR-01`** | Currency Standard | **Sudanese Pounds (SDG)** is the only supported currency across wallets, bookings, tickets, commissions, refunds, and reports. Multi-currency is prohibited. | **IMPLEMENTED** across Prisma schemas | Database columns store currency as string literal `"SDG"`. |
| **`D-POL-01`** | Numeric Monetary Standard | All financial fields must be stored and transmitted as **integer minor units** (`amountMinor`, `balanceMinor`, `fareAmountMinor`). Office daily exposure bounds use the office IANA timezone (fallback `Africa/Khartoum`). | **IMPLEMENTED** in Stage 2.6 | Floating-point money calculations are forbidden in backend code. Frontend floats must be adapted at API boundary. |
| **`D-AUTH-BROKER`**| Broker Office Identity | A Broker is a commercial **office/agency** with a main manager account and multiple staff clerks. Permissions are role/flag-based (`canBook`, `canTopUp`, `canViewReports`, `canManageStaff`). Actions are attributable to the employee. | **IMPLEMENTED** in Stage 2 (`BrokerEmployee`) | Superseded earlier informal chat assumption of a single user broker with no employees. |
| **`D-TOP-01`** | Top-Up Confirmation Architecture | Dual path: (1) Automatic provider-confirmed webhook; (2) Manual receipt review (`MANUAL_FALLBACK`) on the same `TopUpIntent`. **For M1 production, MANUAL receipt review is the enabled and usable path** until a real PSP is integrated. Mock confirm is non-production only. | **IMPLEMENTED** in Stage 2.6 | Prevents unfunded wallet balances. Admin approval endpoint takes NO amount parameter. |
| **`D-ADJ-01`** | Exceptional Financial Adjustments | Central admins **cannot** credit or debit broker wallets outside the formal top-up confirmation workflow. Arbitrary free administrative wallet adjustments are strictly forbidden. | **ENFORCED** (No adjustment endpoints exist) | Protects financial integrity against unauthorized balance inflation. |
| **`D-COM-01`** | Commission Recognition & Debit | Booking confirmation executes an **immediate agency wallet debit**. Commission **accrues per booking** at the carrier's broker %. Cancellation triggers an **automatic commission clawback**. Commission payout is manual by admin. | **IMPLEMENTED** in `bookings.service.ts` | Eliminates external payment gateway latency during passenger ticket checkout. |
| **`D-RATE-01`** | Commission Rate Authority | The commission percentage authority is **per transport company assignment only** (`BrokerCarrierAssignment.commissionPercent`). Global platform commission rates in UI are non-authoritative proposals. | **IMPLEMENTED** in `prisma/schema/carrier.prisma` | Different bus companies can offer different sales commissions to the same broker. |
| **`D-REF-01`** | Cancellation & Refund Destination | Cancelling a booking returns 100% of ticket funds to the **agency's prepaid wallet balance**; commission is clawed back. Time-to-departure retention tiers are not in M1. | **IMPLEMENTED** in Stage 2.6 | No money is disbursed to walk-in passengers directly by ZoolGo. |
| **`D-ACC-01`** | Money Integrity vs. Full GL | Money integrity for M1 requires **reliable transaction records** (wallet movements, immutable ledger entries, commission accruals, payout references). A full General Ledger (Chart of Accounts, journal entries as product, trial balance) is **deferred**. | **IMPLEMENTED** (Ledger + Accruals) | Frontend General Ledger and Trial Balance pages remain mocked proposals. |
| **`D-TICKET-01`** | Boarding Ticket Delivery | M1 tickets are issued exclusively as **secure vector PDF downloads and printable boarding passes**. WhatsApp and SMS ticket delivery channels remain disabled (`TICKET_CHANNEL_DISABLED`). | **IMPLEMENTED** in `pdf-ticket-renderer.ts` | Prevents runtime delivery failures while telecom aggregators are uncontracted. |
| **`D-BOOK-01`** | Booking Search Filters | Booking list APIs must support filtering by carrier (`companyId`), employee (`employeeId`), broker office (`officeId`), status, and date range. | **IMPLEMENTED** in Milestone B | Admins and broker managers can inspect historical ticket sales flexibly. |
| **`D-SEAT-01`** | Seat Assignment Modes | Backend supports both `MANUAL` (clerk chooses specific seat labels) and `AUTO` (ordered by numeric `sortOrder`) assignment. Both enforce identical 15-minute hold rules and row locks. | **IMPLEMENTED** in `catalog.service.ts` | Prevents concurrent seat assignment collisions. |
| **`D-ADMIN-BOOK-01`**| Admin Booking Inspection | Authorized admins list and inspect bookings across all offices. Viewing, cancelling, and overriding are distinct permissions. `bookings.override` is **catalogued but unimplemented** in M1. | **IMPLEMENTED** in Stage 2.6 / Milestone A | Admin cancellation requires a mandatory reason and writes an audit log. |
| **`D-SET-01`** | Commission Settlement Period Record | Settlements are persisted period records. Creating a `DRAFT` **reserves** matching `UNSETTLED` accruals; `CANCELLED` releases them. Finalizing is manual and idempotent. No automatic cron scheduler in M1. | **IMPLEMENTED** in `commissions.service.ts` | Finalizing settlement does **NOT** credit the prepaid wallet; payout is offline bank transfer. |
| **`D-ADMIN-TOPUP-01`**| Top-Up Evidence Fallback | Brokers upload receipts to failed/unverified intents. Admins may initiate top-up requests on behalf of an office. Only admins can approve or reject receipts. | **IMPLEMENTED** in Stage 2.6 | Receipt files stored in private local disk; download requires permission. |
| **`D-AUTH-01`** | Dynamic Custom RBAC | Central admin RBAC uses custom database roles, multiple roles per admin (union of permissions), deny-by-default on new permissions, and fast Redis invalidation (`authzVersion`). | **IMPLEMENTED** in Stage 1 / Milestone B | 32 catalogued permissions; `super_admin` protected from deletion. |

---

## 3. Classification of Current Decisions

### 3.1. LOCKED (Do Not Reopen)
- `SCOPE-01`: First vertical is Broker Office Panel.
- `D-CUR-01`: Currency is SDG only.
- `D-POL-01`: Minor units integer money; office IANA timezone.
- `D-AUTH-BROKER`: Broker office multi-employee identity.
- `D-TOP-01`: Dual path top-up; M1 operational path is MANUAL receipt review.
- `D-ADJ-01`: Exceptional administrative wallet adjustments are prohibited.
- `D-COM-01`: Immediate wallet debit; per-carrier commission accrual; clawback on cancel.
- `D-RATE-01`: Carrier assignment commission rate is authoritative.
- `D-REF-01`: Full refund to agency wallet on cancel.
- `D-ACC-01`: Transaction records only; full GL deferred.
- `D-TICKET-01`: PDF tickets only; SMS/WhatsApp disabled.
- `D-SEAT-01`: MANUAL and AUTO seat holds with row locks.
- `D-SET-01`: DRAFT reserves accruals; finalize does not touch wallet.
- `D-AUTH-01`: Dynamic RBAC with 32 permissions and fast Redis invalidation.

### 3.2. OPEN (Pending Product Owner Decision)
- **`D-GPS-01` (GPS Ingestion Protocol):** Hardware OBD tracker protocol vs driver mobile app telemetry; WebSocket push architecture.
- **`D-PAY-01` (Customer Bankak Flow):** Direct consumer payment confirmation mechanism for Vertical 2.
- **`D-SUS-01` (Carrier Suspension Cascade):** Policy regarding confirmed passenger tickets on future trips when a carrier is suspended.
- **PO Commercial Numbers:** Commercial parameters for minimum top-up and daily exposure ceilings (currently using M1 defaults).

### 3.3. DEFERRED (Post-M1 Milestones)
- Direct Customer CRM and Passenger Mobile App (`SCOPE-01`).
- Driver / Conductor QR Scanner App (`Zool/QRScanner.png`).
- Full General Ledger (Chart of Accounts, journal entries, trial balance).
- Carrier revenue settlement and take-rate disbursements (`D-REV-01`).
- Automated settlement scheduling via background cron jobs.

### 3.4. SUPERSEDED (Historical Proposals Explicitly Discarded)
- **Single Broker Admin with no employees:** Superseded by multi-employee office model (`D-AUTH-BROKER`).
- **Manual bank-receipt queue as the sole normal top-up path:** Superseded by dual-path architecture (`D-TOP-01`).
- **Super Admin exceptional balance credit adjustments:** Superseded by `D-ADJ-01` (unauthorized).
- **Time-tiered cancellation fee deductions for brokers:** Superseded by `D-REF-01` (100% wallet refund).

---

*Evidence citations:*
- Master decision register: `d:\zool-go\docs\BACKEND_DECISION_REGISTER.md` L1–381
- Minor units lock: `d:\zool-go\docs\BACKEND_DECISION_REGISTER.md` L249–264
- Top-up operational lock: `d:\zool-go\docs\BACKEND_DECISION_REGISTER.md` L90–130
- Broker journey authority: `d:\zool-go\Zool\ZoolGo_Broker_Journey.pdf`
