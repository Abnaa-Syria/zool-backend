# ZoolGo — Engineering Handover Acceptance Checklist

This checklist serves as the formal handover agreement between the outgoing Engineering Handover Lead and the incoming Principal Software Architect / Lead Engineer taking ownership of the ZoolGo platform.

---

## 1. Handover Verification Items

### 1.1. Codebase, Repositories, and Source Control
- [ ] **Filesystem Access Received:** Complete access to `d:\zool-go\` verified, including `zool-go-backend\`, `zool-go-dashpoard\`, `docs\`, and `Zool\`.
- [ ] **Source Control Status Acknowledged:** Acknowledged that neither `d:\zool-go` nor its subfolders are currently under Git version control. Git initialization and remote repository setup scheduled as a top Day 1 priority.
- [ ] **Directory Name Idiosyncrasy Understood:** Acknowledged that the frontend dashboard directory is spelled `zool-go-dashpoard` (with a 'p') and must not be renamed.

### 1.2. Environment and Infrastructure Configuration
- [ ] **Environment Templates Received:** Inspected `.env.example` in `zool-go-backend` and verified understanding of all configuration variables.
- [ ] **Secure Secret Transfer:** Acknowledged that production secrets (JWT secrets, HMAC keys, webhook secrets) must be transferred via an encrypted password manager (e.g., 1Password, Bitwarden), not in plain text or Markdown files.
- [ ] **Database & Cache Topology Understood:** Verified MySQL 8.4 ports (`3308` dev, `3307` test) and Redis 7.4 port (`6380`). Confirmed port conflict checks before starting containers.
- [ ] **Prisma Schemas & Migrations:** Verified Prisma 6 multi-file schema directory (`prisma/schema/`) and the 4 applied SQL migrations in `prisma/migrations/`.
- [ ] **Database Seeder Understood:** Verified that `npm run db:seed` provisions the Super Admin (`+249900000001`), static permission catalog, and Stage 2 demo broker office (`ZG-BRK-1`).

### 1.3. Local Runtime and Build Verification
- [ ] **Backend Build Executed:** `npm run build` in `zool-go-backend` compiles cleanly to `dist/server.js` with exit code 0.
- [ ] **Frontend Build Executed:** `npm run build` in `zool-go-dashpoard` compiles cleanly to `dist/` with exit code 0; Vite 2.4 MB bundle chunk warning noted.
- [ ] **Linting Verified:** Backend ESLint exits with code 0 (`--max-warnings 0`). Frontend Oxlint exits with code 0 (20 minor React warnings noted).
- [ ] **Prisma Schemas Validated:** `npx prisma validate` reports schemas are valid.
- [ ] **Automated Tests Executed:**
  - Frontend: 13 test files (89 tests) pass in Vitest.
  - Backend: 9 test files (72 tests) reviewed; offline contract tests pass; local Docker setup for integration tests verified.
- [ ] **Smoke Tests Reviewed:** Inspected `scripts/smoke.mjs` and `scripts/smoke-stage2.mjs`.

### 1.4. API Documentation and Specifications
- [ ] **OpenAPI / Swagger Opened:** Swagger UI verified at `http://127.0.0.1:4000/docs` and raw spec at `docs/openapi.yaml`.
- [ ] **Postman Collections Inspected:** Verified `postman/ZoolGo-Stage1.postman_collection.json` and `postman/ZoolGo-Stage2.postman_collection.json`.
- [ ] **Decision Register Mastered:** Read and understood all locked decisions in `docs/BACKEND_DECISION_REGISTER.md`.

### 1.5. Core Financial and Business Flows Traced
- [ ] **Admin Authentication & RBAC Traced:** Traced OTP login, access token verification, dynamic custom roles, union of permissions, and fast Redis invalidation (`authzVersion`).
- [ ] **Prepaid Wallet & Top-Up Traced:** Traced dual-path top-up architecture; understood that **MANUAL receipt review (`MANUAL_FALLBACK`) is the only operational production path in M1**; mock confirm verified as blocked in production.
- [ ] **Booking Confirmation & Debit Traced:** Traced atomic `$transaction` containing wallet debit, `WalletLedgerEntry` creation, seat status transition to `SOLD`, ticket creation, and commission accrual.
- [ ] **Booking Cancellation & Clawback Traced:** Traced 100% wallet refund and automatic commission clawback; confirmed no retention tiers in M1 (`D-REF-01`).
- [ ] **Commission Settlement Traced:** Traced `DRAFT` reservation, `CANCELLED` release, and `FINALIZED` payout; **verified that settlement finalization does NOT credit the prepaid wallet**.

### 1.6. Known Gaps and Operational Realities Acknowledged
- [ ] **Admin Phone-Change Security Gap Acknowledged:** Acknowledged that `verifyPhoneChangeOtp` currently does not invalidate active sessions or bump `authzVersion`. Scheduled as the first code fix.
- [ ] **Frontend Mock Reality Acknowledged:** Acknowledged that the React Admin Dashboard makes zero network requests to `/api/v1` and that frontend integration is intentionally deferred to Milestone F.
- [ ] **Missing Production External Providers Acknowledged:**
  - No production Sudanese PSP (Bankak/Fawry) integrated; mock provider only.
  - No SMS delivery provider integrated; console delivery only.
  - No fleet GPS telemetry provider or protocol integrated (`D-GPS-01` OPEN).
- [ ] **Object Storage Debt Acknowledged:** Acknowledged that receipts are currently saved to local disk (`./uploads/receipts/`) and must be migrated to S3 prior to multi-node production deployment.
- [ ] **Deferred Features Understood:** Acknowledged that full General Ledger accounting, consumer mobile booking, driver QR scanning, and carrier revenue share are deferred post-M1.

---

## 2. Operational Ownership Handover

| Operational Responsibility | Outgoing Lead | Incoming Owner | Transfer Date |
|---|---|---|---|
| **Backend API Codebase** | Handover Complete | Assumed Ownership | 2026-11-19 |
| **Frontend Admin Dashboard** | Handover Complete | Assumed Ownership | 2026-11-19 |
| **Database Schemas & Migrations** | Handover Complete | Assumed Ownership | 2026-11-19 |
| **Documentation & Decision Log** | Handover Complete | Assumed Ownership | 2026-11-19 |
| **Local Docker Environments** | Handover Complete | Assumed Ownership | 2026-11-19 |
| **Git Repository Setup** | Pending Action | Incoming Engineer Priority 1 | Scheduled Day 1 |
| **Production Cloud & CI/CD** | Unbuilt | Incoming Engineer Future Scope | Milestone F |

---

## 3. Final Open Questions and Notes

*Record any outstanding technical or architectural questions below during the formal handover session:*

1. **Question:** What is the target timeline for Product Owner commercial rate sign-off regarding minimum top-up amounts and daily exposure ceilings?  
   **Note:** Current codebase uses defaults (10,000 SDG min top-up, 100 tickets/day exposure ceiling). These can be updated via environment variables or office-specific database policy overrides without schema migrations.
2. **Question:** Has business development established direct communication with Bank of Khartoum regarding Bankak API / webhook documentation?  
   **Note:** The backend webhook port (`POST /api/v1/payments/webhooks/:provider`) with raw-body HMAC signature verification is already implemented and waiting for the provider adapter.

---

## 4. Formal Sign-Off

```text
Handed over by:
Name:       Principal Software Architect & Engineering Handover Lead
Role:       Outgoing Architecture & Handover Lead
Date:       2026-11-19
Signature:  [HANDOVER DOCUMENTATION PACKAGE DELIVERED]

Received by:
Name:       __________________________________________________
Role:       Incoming Principal Software Architect / Lead Engineer
Date:       __________________________________________________
Signature:  __________________________________________________

Known Exceptions Recorded at Handover:
1. Workspace is not under Git version control.
2. Admin Dashboard frontend runs entirely on in-memory fixtures (Milestone F integration scheduled).
3. Admin phone-change self-service does not invalidate active sessions (P0 patch scheduled).
4. Fleet GPS telematics is simulated on frontend; backend decision D-GPS-01 is OPEN.
5. Receipt evidence storage is local disk (S3 migration required for multi-node deployment).
```
