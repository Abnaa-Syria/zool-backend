# Authorization invalidation strategy (Stage 1)

## Goals

- Access tokens stay short-lived.
- Role / permission / suspension changes take effect quickly without relying only on JWT claims.
- Redis is used for ephemeral authz versioning; MySQL remains the system of record.

## Mechanism

1. Each `AdminUser` has an integer `authzVersion` persisted in MySQL.
2. On successful login / refresh, Redis key `zoolgo:authz:version:{adminId}` is set to the current DB version.
3. Access JWT includes claim `av` (authz version) plus `sub` (adminId) and `sid` (refresh session id).
4. `authenticate` middleware:
   - Verifies JWT signature and expiry.
   - Fail-closed Redis lookup of `authz:version:{adminId}`.
   - Rejects the request if Redis version ≠ JWT `av` (or Redis is unavailable / key missing).
5. Effective permissions are loaded from MySQL (union of active roles → active role permissions) and cached briefly in Redis.

## Version bumps

`authzVersion` is incremented (DB + Redis) when:

- Admin is suspended / reactivated
- Admin roles are replaced
- Role active flag changes
- Role permissions are replaced
- Role is deleted (affected admins)
- Logout-all or session revoke for that admin

## CSRF / cookie strategy

Refresh and logout use an HTTP-only cookie scoped to `/api/v1/auth`.

- SameSite=`lax` (configurable)
- CORS allowlist with `credentials: true` (no `*` origin)
- Refresh token is never returned in JSON

This is a defensible same-site strategy for first-party admin SPA + API on related localhost origins during development.
