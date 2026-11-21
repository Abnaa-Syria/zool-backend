# Stage 1 Implementation Plan (M0)

## Status

**Stage 1 (M0) is complete:** central admin OTP auth, RBAC, sessions, audit, health, and the unified HTTP success/error contract.

**Next business vertical:** see [`STAGE2_PLAN.md`](STAGE2_PLAN.md) (broker M1 slice, backend-only). Scope remains bound by [`docs/BACKEND_DECISION_REGISTER.md`](../docs/BACKEND_DECISION_REGISTER.md).

## Contradiction notes (resolved for M1 design; non-blocking for Stage 1)

- **D-TOP-01** locked to PDF: automatic wallet credit after verified payment confirmation (manual Stitch queue is not the normal path).
- Informal chat alternatives (Hybrid top-up, single-user broker, exceptional Super Admin credit as allowed) are **superseded** — see Decision Register.
- Admin dashboard may still use mock RBAC in the frontend; backend enforces real OTP + RBAC for central admins.
- Frontend admin shapes (ADM-*, role archetypes) are UI-oriented; API DTOs remain domain-oriented and frontend-friendly for `/auth/me`.

## Stack

- Express + TypeScript modular monolith
- Prisma 6.x multi-file schema + MySQL
- Redis (OTP, rate limits, authz version)
- Zod, JWT access + opaque rotating refresh cookies, OTP via pluggable delivery
- Vitest integration tests

## Modules (Stage 1)

`health`, `auth`, `admins` (users), `roles`, `permissions`, `sessions`, `audit`

## Authz invalidation

Access JWT carries `adminId` + `authzVersion` (short TTL). Redis holds `authz:version:{adminId}`. Role/permission/suspension bumps version → stale JWT fails until refresh/re-login.

## Bootstrap

Seed creates Super Admin + permission catalog. No public registration.

## Related

- [`docs/BACKEND_DECISION_REGISTER.md`](../docs/BACKEND_DECISION_REGISTER.md)
- [`docs/BACKEND_REQUIREMENTS.md`](../docs/BACKEND_REQUIREMENTS.md)
- [`docs/HTTP_RESPONSE_AND_ERROR_STANDARD.md`](docs/HTTP_RESPONSE_AND_ERROR_STANDARD.md)
