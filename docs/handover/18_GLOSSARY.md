# ZoolGo — Domain, Financial, and Technical Glossary

This glossary provides authoritative English and Arabic definitions for transit, business, financial, and technical terms used throughout the ZoolGo codebase and specifications.

---

## 1. Domain and Transit Terms

| English Term | Arabic Equivalent | Authoritative Definition in ZoolGo |
|---|---|---|
| **ZoolGo** | زول قو | The central intercity bus ticketing and transit management technology platform in Sudan. ("Zool" is colloquial Sudanese Arabic for "person / fellow"). |
| **Broker Office** | مكتب وسيط / وكالة سفر | An independent commercial travel agency, ticketing kiosk, or terminal booking office authorized to sell bus tickets to walk-in travelers using a prepaid agency wallet. |
| **Broker Employee** | موظف الوسيط / كاتب التذاكر | An authenticated staff member employed by a broker office. Classified into **Manager** (can manage staff, view reports, top up) and **Clerk** (can search trips, hold seats, and book). |
| **Transport Company (Carrier)** | شركة النقل / الناقل | A bus fleet operating company (e.g., *Sudan Express*) partnering with ZoolGo to distribute its intercity route inventory. |
| **Passenger** | مسافر | The walk-in individual traveling on the bus. Their name, phone number, and optional ID are recorded during booking. Has no user account on ZoolGo. |
| **Customer** | عميل مباشر | An individual who downloads a future consumer mobile app to book tickets independently. Strictly out of scope for the M1 Broker Vertical. |
| **Trip** | رحلة سفر | A scheduled point-to-point journey operated by a carrier from an origin terminal to a destination terminal with a defined departure time, base fare, and seat array. |
| **Seat Hold** | حجز مقعد مؤقت | An atomic, 15-minute temporary lock placed on one or more bus seats by a broker clerk to prevent concurrent allocation while collecting passenger details. |
| **Booking** | حجز مؤكد | The top-level commercial reservation representing a single checkout event for a trip, debited atomically from an agency wallet. |
| **Ticket** | تذكرة صعود | An individual boarding entitlement issued to a specific passenger for a specific physical seat, rendered with a unique QR code and ticket number. |

---

## 2. Financial and Accounting Terms

| English Term | Arabic Equivalent | Authoritative Definition in ZoolGo |
|---|---|---|
| **Prepaid Wallet** | محفظة مسبقة الدفع | A digital credit balance owned by a broker office. Debited immediately when tickets are booked; credited when top-ups are approved or bookings are cancelled. |
| **Minor Units** | الوحدات الصغرى للعملة | Integer representation of money avoiding floating-point rounding errors. In Sudanese Pounds (SDG), 1 SDG = 100 minor units (`amountMinor`). |
| **Wallet Ledger Entry** | قيد في سجل الحركات | An immutable double-entry record tracking every balance modification (`CREDIT` or `DEBIT`) with before/after balances and a unique idempotent `ledgerKey`. |
| **Top-Up Intent** | طلب شحن الرصيد | A registered financial request by a broker to deposit money into their prepaid wallet, tracked through `PENDING`, `SETTLED`, or `REJECTED` states. |
| **Payment Reference** | الرقم المرجعي للدفع | A unique platform-generated alphanumeric identifier (e.g., `TP-20261020-0001`) assigned to every top-up intent to prevent duplicate processing. |
| **Manual Fallback Top-Up** | الشحن بمراجعة الإشعار البنكي | The primary enabled M1 production top-up path where a broker uploads a bank transfer deposit slip and central admins verify and approve the credit. |
| **Commission Accrual** | استحقاق عمولة المبيعات | The sales commission earned by a broker office upon confirming a booking, calculated at the carrier's negotiated rate and stored as `UNSETTLED`. |
| **Commission Clawback** | استرداد / خصم العمولة | The automatic reversal of an earned commission accrual when a passenger's ticket or booking is cancelled. |
| **Commission Settlement** | تسوية العمولات الدورية | A periodic batch record (`DRAFT` or `FINALIZED`) grouping a broker's unsettled commission accruals for manual bank transfer payout by central management. |
| **Commission Payout** | صرف العمولة | The recorded offline disbursement of finalized commission funds to a broker office. **Does NOT credit the broker's prepaid wallet.** |
| **Exposure Ceiling** | سقف الحجوزات اليومي | A policy limit capping the maximum number of confirmed tickets a broker office can issue within a single calendar day (measured in office timezone). |

---

## 3. Security, RBAC, and Architectural Terms

| English Term | Arabic Equivalent | Authoritative Definition in ZoolGo |
|---|---|---|
| **Permission Catalog** | كتالوج الصلاحيات الثابت | The static, code-defined enumeration of 32 distinct administrative capabilities (`PERMISSION_CATALOG`). |
| **Dynamic Role** | دور إداري مخصص | A named container stored in the database grouping arbitrary permissions that can be assigned to platform administrators. |
| **Effective Permissions** | الصلاحيات الفعلية المجمعة | The mathematical union of all individual permissions granted to an administrator across all their assigned active roles. |
| **Authorization Version (`authzVersion`)** | إصدار صلاحيات الجلسة | An integer persisted in MySQL and cached in Redis. Incremented whenever an admin's roles, status, or sessions are modified, immediately revoking stale access tokens. |
| **OTP Challenge** | تحدي رمز التحقق المؤقت | A 5-minute single-use numeric code validated via HMAC-SHA256 for authenticating administrators and broker staff without static passwords. |
| **Refresh Session** | جلسة تجديد التوكن | A server-side database record tracking long-lived HttpOnly refresh cookies with cryptographic token rotation and reuse detection. |
| **Provider Adapter** | محول مزود الخدمة | A software class implementing a common interface (e.g., `PaymentProvider`, `StorageProvider`) to decouple core business logic from third-party vendor SDKs. |
| **Evidence File** | مستند إثبات التحويل | A private uploaded image (PNG/JPEG/PDF) of a bank deposit slip stored securely on disk and downloadable only by authorized administrators. |
| **Modular Monolith** | هيكلية أحادية معيارية | An architectural pattern organizing code into decoupled domain modules (`src/modules/*`) sharing a single deployment unit and relational database. |
| **Idempotency Key** | مفتاح منع تكرار العمليات | A unique string passed by API clients during booking or top-up confirmation ensuring repeated requests with the same key produce identical side effects exactly once. |

---

*Evidence citations:*
- Broker journey glossary: `d:\zool-go\Zool\ZoolGo_Broker_Journey.pdf` §1–§6
- Permission keys: `d:\zool-go\zool-go-backend\src\shared\constants\permissions.ts`
- Minor units: `d:\zool-go\docs\BACKEND_DECISION_REGISTER.md` L249–264
