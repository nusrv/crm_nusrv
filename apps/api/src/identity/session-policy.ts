export const MAX_ACCESS_SECONDS = 15 * 60;
export const MAX_REFRESH_SECONDS = 24 * 60 * 60;

export function tokenLifetimeSeconds(configured: string, limit: number): number {
  const match = /^(\d+)([smhd])$/.exec(configured);
  const unitSeconds: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  const seconds = match ? Number(match[1]) * unitSeconds[match[2]!]! : 0;
  if (seconds < 1) throw new Error('Invalid authentication token duration.');
  return Math.min(seconds, limit);
}

export function sessionDeadline(session: { createdAt: Date; expiresAt: Date }): number {
  return Math.min(session.expiresAt.getTime(), session.createdAt.getTime() + MAX_REFRESH_SECONDS * 1000);
}

export function isCurrentSession(
  session: { userId: string; revokedAt: Date | null; createdAt: Date; expiresAt: Date },
  subject: string,
  now: number,
): boolean {
  return session.userId === subject && !session.revokedAt && sessionDeadline(session) > now;
}

type SessionClaims = { sub?: unknown; sid?: unknown; type?: unknown; iat?: unknown; exp?: unknown };

export function isBoundAccessToken(
  claims: SessionClaims,
  now: number,
): claims is { sub: string; sid: string; type: 'access'; iat: number; exp: number } {
  const { sub, sid, type, iat, exp } = claims;
  const nowSeconds = Math.floor(now / 1000);
  return type === 'access' && typeof sub === 'string' && sub.length > 0 &&
    typeof sid === 'string' && sid.length > 0 &&
    typeof iat === 'number' && Number.isSafeInteger(iat) && iat <= nowSeconds &&
    typeof exp === 'number' && Number.isSafeInteger(exp) && exp > nowSeconds &&
    exp - iat <= MAX_ACCESS_SECONDS;
}
