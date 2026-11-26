/** Server-only metadata attached to the exact Passport principal after JWT/session verification.
 * It is intentionally absent from the serialized user response and cannot be supplied in a body.
 */
export interface VerifiedAccessContext {
  readonly actorId: string;
  readonly sessionId: string;
  readonly accessExpiresAt: number;
}
const contexts = new WeakMap<object, VerifiedAccessContext>();

export function attachVerifiedAccessContext<T extends { id: string }>(
  user: T, sessionId: string, accessExpiresAt: number,
): T {
  if (!user.id || !sessionId || !Number.isSafeInteger(accessExpiresAt)) throw new Error('Invalid verified access context.');
  contexts.set(user, Object.freeze({ actorId: user.id, sessionId, accessExpiresAt }));
  return user;
}

export function readVerifiedAccessContext(user: { id: string } | null | undefined, now = Date.now()): VerifiedAccessContext | null {
  if (!user || typeof user !== 'object' || !Number.isFinite(now)) return null;
  const context = contexts.get(user);
  return context && context.actorId === user.id && context.accessExpiresAt > now ? context : null;
}
