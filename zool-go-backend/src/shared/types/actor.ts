/**
 * Who performs an operation shared by several surfaces (admin dashboard, carrier portal).
 * Admins are recorded in `actorAdminId`; other principals in `actorType` + `actorId`.
 */
export type Actor = { actorAdminId?: string; actorType?: string; actorId?: string; requestId?: string };

export function auditActor(a: Actor) {
  return {
    ...(a.actorAdminId ? { actorAdminId: a.actorAdminId } : {}),
    ...(a.actorType ? { actorType: a.actorType, actorId: a.actorId ?? null } : {}),
  };
}
