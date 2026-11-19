export interface AuthRoleSummary {
  id: string;
  key: string;
  name: string;
}

export interface AuthPrincipal {
  adminId: string;
  authzVersion: number;
  sessionId?: string;
  permissions?: string[];
  roles?: AuthRoleSummary[];
}

/**
 * Optional enricher registered by the auth module later.
 * Use to attach permissions and reject suspended admins.
 *
 * Authz version contract:
 * - On login: set Redis `authz:version:{adminId}` from DB `authzVersion`.
 * - On bump (role/permission/suspension change): increment DB + Redis together.
 * - Authenticate is fail-closed on Redis errors; if the Redis key is missing,
 *   the token claim is accepted (bumps always write Redis).
 */
export type AuthContextEnricher = (
  principal: AuthPrincipal,
) => Promise<AuthPrincipal>;
