# ZoolGo — Authentication, Sessions, and Dynamic RBAC

This document details the identity architecture, session lifecycle, token security, and Role-Based Access Control (RBAC) mechanisms implemented in `zool-go-backend`.

---

## 1. Central Admin Authentication Lifecycle

Central administrators authenticate exclusively using **Phone One-Time Password (OTP)**. There are no static passwords, database password hashes, or social OAuth providers for administrative users.

### 1.1. OTP Request (`POST /api/v1/auth/otp/request`)
- **Input:** `{ phone: "+249900000001" }`.
- **Validation:** Phone normalized via `normalizePhone(phone)` (`src/shared/utils/phone.ts`).
- **Checks:**
  - Verifies that the phone identity exists in `AdminIdentity` with `type = PHONE` and belongs to an `AdminUser` with `status = ACTIVE`.
  - Rejects unknown or suspended numbers with generic 401 Unauthorized (`AuthErrors.invalidCredentials()`) to prevent phone enumeration.
  - **Rate Limiting:** Enforces Redis sliding-window rate limit (`OTP_REQUEST_RATE_LIMIT_MAX = 10` per 10 minutes) via `enforceRedisRateLimit` (`src/shared/security/redis-rate-limit.ts`).
  - **Resend Cooldown:** Enforces a 60-second cooldown in Redis (`OTP_RESEND_COOLDOWN_SECONDS`) before a new challenge can be generated for that phone.
- **Challenge Generation:**
  - Generates a 6-digit cryptographically secure numeric code (`crypto.randomInt`).
  - Computes an HMAC-SHA256 hash using `OTP_HMAC_SECRET` (`src/shared/security/crypto.ts` L15–20).
  - Persists an `OtpChallenge` record with `purpose = LOGIN`, `status = PENDING`, `attemptCount = 0`, `maxAttempts = 5`, and `expiresAt = now + 300s` (5 minutes).
- **Development Exposure Guard (`OTP_DEV_EXPOSE`):**
  - If `OTP_DEV_EXPOSE = true`, the plaintext OTP is returned in the response as `{ devOtp: "123456" }` to facilitate automated testing.
  - **Production Guard:** `src/config/env.ts` L66–72 enforces via Zod `superRefine`:
    ```typescript
    if (data.NODE_ENV === 'production' && data.OTP_DEV_EXPOSE) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['OTP_DEV_EXPOSE'], message: 'OTP_DEV_EXPOSE must be false in production' });
    }
    ```
    The application **refuses to start** in production if `OTP_DEV_EXPOSE` is enabled.

### 1.2. OTP Verification (`POST /api/v1/auth/otp/verify`)
- **Input:** `{ phone, code, challengeId }`.
- **Rate Limiting:** Redis verify rate limit (`OTP_VERIFY_RATE_LIMIT_MAX = 20` per 10 minutes).
- **Verification:**
  - Finds pending challenge. Validates status (`PENDING`), expiry timestamp, and purpose (`LOGIN`).
  - Computes HMAC-SHA256 of submitted code and compares with `challenge.codeHash` using **constant-time equality** (`timingSafeEqualString`).
  - **Failed Attempts:** Increments `attemptCount`. If `attemptCount >= maxAttempts` (5), transitions status to `LOCKED`.
  - **Success:** Inside a transaction, updates status to `CONSUMED`, expires all other pending challenges for that admin, and provisions a new `RefreshSession`.

---

## 2. Admin Self-Service Phone Change

Implemented in `src/modules/auth/auth.service.ts` L446–674 and verified in `tests/admin-phone-change.test.ts`.

### 2.1. Policy and Workflow
1. **Self-Service Only:** An admin can only change their own phone. Cross-admin phone modification is strictly forbidden.
   - `PATCH /api/v1/admins/:id` uses `updateAdminProfileSchema` which is marked `.strict()` and permits **only** `displayName`. Supplying `phone` produces an immediate 422 Unprocessable Entity (`tests/admin-phone-change.test.ts` L65–81).
2. **Initiation (`POST /api/v1/auth/phone/otp/request`):**
   - Requires an authenticated session (`authenticate` middleware).
   - Input: `{ phone: "+249..." }` (the **new** desired phone number).
   - Validates that the new phone is not already registered to another administrator (returns `409 Conflict`).
   - Generates an `OtpChallenge` with `purpose = ADMIN_PHONE_CHANGE`, bound explicitly to `adminUserId = req.admin.id` and `identityValue = newPhone`.
   - Sends the OTP to the **new** phone number.
3. **Verification (`POST /api/v1/auth/phone/otp/verify`):**
   - Requires authenticated session.
   - Input: `{ phone, code, challengeId }`.
   - Validates that the challenge belongs to the requesting admin (`challenge.adminUserId === admin.id`). Another admin cannot consume the challenge (`tests/admin-phone-change.test.ts` L166–190).
   - Updates `challenge.status = CONSUMED`, expires older pending phone change challenges, and updates `AdminIdentity.valueNormalized` to the new phone.
   - Logs an audit entry: `admin.phone_changed`.

### 2.2. Open Security Gap (Technical Debt)

> [!WARNING]
> **Phone Change Session Invalidation Gap:**  
> An inspection of `src/modules/auth/auth.service.ts` L639–674 confirms:
> 1. `verifyPhoneChangeOtp` does **NOT** revoke active refresh sessions (`RefreshSession`).
> 2. `verifyPhoneChangeOtp` does **NOT** increment `AdminUser.authzVersion` or update the Redis `authz:version:{adminId}` key.
> 3. `verifyPhoneChangeOtp` expires pending challenges for `ADMIN_PHONE_CHANGE`, but does **NOT** invalidate pending `LOGIN` challenges.
>
> **Security Impact:** If an administrator's credentials were compromised, changing the phone number does not immediately kick out an attacker holding a valid access JWT or refresh cookie. This is flagged as a high-priority security gap in [14_SECURITY_AND_OPERATIONS.md](14_SECURITY_AND_OPERATIONS.md) and scheduled for resolution in [16_NEXT_ENGINEER_PLAN.md](16_NEXT_ENGINEER_PLAN.md).

---

## 3. Session Architecture and Redis Invalidation

### 3.1. Token Strategy
- **Access Token:** Short-lived JWT (default 15 minutes / 900 seconds).
  - Claims: `sub` (admin user ID), `sid` (refresh session ID), `av` (current authorization version), `exp`, `iat`.
  - Signed with `JWT_ACCESS_SECRET` (minimum 32 characters).
  - Returned in response body and transmitted via `Authorization: Bearer <token>` header.
- **Refresh Token:** Long-lived cryptographically secure random string (default 7 days / 604,800 seconds).
  - Stored exclusively in an `HttpOnly`, `SameSite=Lax`, `Path=/api/v1/auth` cookie named `zoolgo_refresh`.
  - The plaintext token is **never returned in response JSON** and **never stored in the database**. Only its SHA-256 hash (`tokenHash`) is persisted in `RefreshSession`.
- **Principal Isolation:** Broker employees use an isolated refresh cookie named `zoolgo_broker_refresh` scoped to `/api/v1/broker/auth` to prevent cross-principal session collision (`D-AUTH-BROKER`).

### 3.2. Refresh Rotation and Reuse Detection (`POST /api/v1/auth/refresh`)
- When a client sends the refresh cookie, the server hashes the cookie value and searches for an active `RefreshSession`.
- **Normal Rotation:** The existing session is marked revoked, a new `RefreshSession` is created, a new refresh cookie is issued, and a fresh access JWT is returned.
- **Reuse Detection:** If an incoming token hash matches a session that has **already been revoked**, the server detects a potential replay/theft attack:
  - Immediately revokes **all** active sessions for that admin user (`revokedAt = now`).
  - Increments `AdminUser.authzVersion` in MySQL and updates `zoolgo:authz:version:{adminId}` in Redis.
  - Responds with 401 Unauthorized (`TOKEN_REUSED`).

### 3.3. Fast Authorization Invalidation via Redis (`authzVersion`)
To prevent revoked, modified, or suspended administrators from making API calls using an unexpired access token (up to 15 minutes of validity):
1. Every `AdminUser` has an integer `authzVersion` (default 1).
2. The access JWT contains the version claim `av: 1`.
3. The `authenticate` middleware (`src/shared/middleware/authenticate.ts` L25–38) performs a fail-closed lookup in Redis:
   ```typescript
   const currentVersion = await getAuthzVersion(adminId);
   if (currentVersion === null || decoded.av !== currentVersion) {
     throw AppError.unauthorized('Authorization session expired or permissions updated');
   }
   ```
4. **Trigger Events:** The `authzVersion` is bumped in both MySQL and Redis on:
   - Admin suspension or reactivation (`PATCH /api/v1/admins/:id/status`).
   - Admin role re-assignment (`PUT /api/v1/admins/:id/roles`).
   - Role permissions replacement (`PUT /api/v1/roles/:id/permissions`).
   - Role deletion (`DELETE /api/v1/roles/:id`).
   - Self logout-all (`POST /api/v1/auth/logout-all`).
   - Administrative session revocation (`POST /api/v1/admins/:id/sessions/revoke-all` or `DELETE /api/v1/sessions/:id`).

---

## 4. Dynamic Role-Based Access Control (RBAC)

ZoolGo implements a hybrid RBAC model: **Fixed Permissions Catalog + Dynamic Database Custom Roles**.

### 4.1. Core Rules
1. **Dynamic Custom Roles:** Central admins can create arbitrary roles (e.g., "Kassala Terminal Auditor", "Compliance Reviewer") with custom combinations of permissions.
2. **Multiple Roles per Admin:** An admin can be assigned multiple roles simultaneously. The admin's effective permissions are the **mathematical union** of all permissions across their assigned active roles.
3. **Deny-by-Default:** New permissions are never automatically granted to existing roles. If a new permission is catalogued, existing custom roles have no access until an administrator explicitly updates the role.
4. **Super Admin Protections:**
   - The system role `super_admin` (`SUPER_ADMIN_ROLE_KEY`) cannot be renamed or deleted (`src/modules/roles/roles.service.ts` L85–92).
   - The platform prevents suspending the last active administrator possessing Super Admin privileges (`src/modules/admins/admins.service.ts` L95–110).

### 4.2. Complete Permission Catalog (32 Keys) and Route Mappings

| # | Permission Key | Domain Module | Description | Enforcing Endpoint(s) |
|---|---|---|---|---|
| 1 | `admins.view` | admins | View administrators list & details | `GET /api/v1/admins`<br>`GET /api/v1/admins/:id` |
| 2 | `admins.create` | admins | Create new platform administrator | `POST /api/v1/admins` |
| 3 | `admins.update` | admins | Update admin profile (displayName) | `PATCH /api/v1/admins/:id` |
| 4 | `admins.suspend` | admins | Suspend or reactivate an administrator | `PATCH /api/v1/admins/:id/status` |
| 5 | `roles.view` | roles | View system and custom roles | `GET /api/v1/roles`<br>`GET /api/v1/roles/:id` |
| 6 | `roles.create` | roles | Create a custom administrative role | `POST /api/v1/roles` |
| 7 | `roles.update` | roles | Update role metadata | `PATCH /api/v1/roles/:id` |
| 8 | `roles.assign` | roles | Assign roles to an administrator | `PUT /api/v1/admins/:id/roles` |
| 9 | `roles.delete` | roles | Delete a non-system custom role | `DELETE /api/v1/roles/:id` |
| 10 | `permissions.view` | permissions | View static permission catalog | `GET /api/v1/permissions` |
| 11 | `permissions.assign` | permissions | Assign permissions to a custom role | `PUT /api/v1/roles/:id/permissions` |
| 12 | `sessions.view` | sessions | View active refresh sessions | `GET /api/v1/sessions` |
| 13 | `sessions.revoke` | sessions | Revoke refresh sessions (single or all) | `DELETE /api/v1/sessions/:id`<br>`POST /api/v1/admins/:id/sessions/revoke-all` |
| 14 | `audit.view` | audit | Query immutable audit log records | `GET /api/v1/audit-logs` |
| 15 | `brokers.manage` | brokers | Create broker, update policy, carriers, staff | `POST /api/v1/brokers`<br>`PUT /api/v1/brokers/:id/carriers`<br>`PATCH /api/v1/brokers/:id/status`<br>`PATCH /api/v1/brokers/:id`<br>`POST /api/v1/brokers/:id/staff`<br>`PATCH /api/v1/brokers/:id/staff/:empId` |
| 16 | `brokers.view` | brokers | List and inspect broker offices | `GET /api/v1/brokers`<br>`GET /api/v1/brokers/:id` |
| 17 | `carriers.manage` | carriers | Create and update transport carriers | `POST /api/v1/carriers`<br>`PATCH /api/v1/carriers/:id` |
| 18 | `carriers.view` | carriers | List and inspect transport carriers | `GET /api/v1/carriers`<br>`GET /api/v1/carriers/:id` |
| 19 | `wallets.view` | wallets | Inspect broker agency wallets and ledger | `GET /api/v1/admin/wallets`<br>`GET /api/v1/admin/wallets/:officeId` |
| 20 | `wallets.topups.view` | wallets | View top-up intents list | `GET /api/v1/admin/wallets/top-ups` (via `requireAnyPermission`) |
| 21 | `wallets.topups.review` | wallets | Review pending top-ups queue | `GET /api/v1/admin/wallets/top-ups` (via `requireAnyPermission`) |
| 22 | `wallets.topups.create_for_office` | wallets | Submit manual top-up on behalf of broker | `POST /api/v1/admin/wallets/:officeId/top-ups` |
| 23 | `wallets.topups.approve` | wallets | Approve pending receipt and credit wallet | `POST /api/v1/admin/wallets/top-ups/:id/approve` |
| 24 | `wallets.topups.reject` | wallets | Reject pending top-up receipt with reason | `POST /api/v1/admin/wallets/top-ups/:id/reject` |
| 25 | `wallets.topups.evidence.view` | wallets | Download uploaded deposit receipt file | `GET /api/v1/admin/wallets/top-ups/:id/evidence` |
| 26 | `commissions.view` | commissions | View broker commission accruals & settlement | `GET /api/v1/admin/commissions/accruals`<br>`GET /api/v1/admin/commissions/settlements`<br>`GET /api/v1/admin/commissions/settlements/:id` |
| 27 | `commissions.payout` | commissions | Draft, finalize, or cancel settlements | `POST /api/v1/admin/commissions/settlements`<br>`POST /api/v1/admin/commissions/settlements/:id/finalize`<br>`POST /api/v1/admin/commissions/settlements/:id/cancel` |
| 28 | `catalog.view` | catalog | View scheduled trips and bus seats | `GET /api/v1/catalog/trips`<br>`GET /api/v1/catalog/trips/:id` |
| 29 | `catalog.manage` | catalog | Create trips, append seats, patch schedules | `POST /api/v1/catalog/trips`<br>`PATCH /api/v1/catalog/trips/:id`<br>`POST /api/v1/catalog/trips/:id/seats` |
| 30 | `bookings.view` | bookings | List, inspect, and search bookings & tickets | `GET /api/v1/admin/bookings`<br>`GET /api/v1/admin/bookings/:id`<br>`GET /api/v1/admin/bookings/:id/tickets/:tId/pdf` |
| 31 | `bookings.cancel` | bookings | Cancel booking with wallet refund & clawback | `POST /api/v1/admin/bookings/:id/cancel` |
| 32 | `bookings.override` | bookings | **Reserved / Unimplemented in M1** | *No mounted route (Catalogued only)* |

---

*Evidence citations:*
- Permission catalog: `d:\zool-go\zool-go-backend\src\shared\constants\permissions.ts` L1–44
- Auth service: `d:\zool-go\zool-go-backend\src\modules\auth\auth.service.ts` L50–320
- Phone change implementation: `d:\zool-go\zool-go-backend\src\modules\auth\auth.service.ts` L446–674
- Authz cache helper: `d:\zool-go\zool-go-backend\src\shared\security\authz-cache.ts` L1–80
- Permission middleware: `d:\zool-go\zool-go-backend\src\shared\middleware\require-permission.ts` L1–35
