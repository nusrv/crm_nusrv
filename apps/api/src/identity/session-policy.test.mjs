import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isBoundAccessToken,
  isCurrentSession,
  MAX_ACCESS_SECONDS,
  MAX_REFRESH_SECONDS,
  sessionDeadline,
  tokenLifetimeSeconds,
} from './session-policy.ts';

const now = 1_800_000_000_000;
const issued = now / 1000;
const identity = { sub: 'admin', sid: 'browser-session', type: 'access', iat: issued, exp: issued + 900 };

test('configured token lifetimes are bounded by 15 minutes and 24 hours', () => {
  assert.equal(tokenLifetimeSeconds('1h', MAX_ACCESS_SECONDS), 900);
  assert.equal(tokenLifetimeSeconds('7d', MAX_REFRESH_SECONDS), 86400);
  assert.equal(tokenLifetimeSeconds('10m', MAX_ACCESS_SECONDS), 600);
  assert.throws(() => tokenLifetimeSeconds('0s', MAX_ACCESS_SECONDS));
});

test('access claims need a current bound session identity and bounded access lifetime', () => {
  assert.equal(isBoundAccessToken(identity, now), true);
  for (const claims of [
    { ...identity, sid: undefined },
    { ...identity, type: 'refresh' },
    { ...identity, exp: issued + 901 },
    { ...identity, exp: issued },
    { ...identity, iat: issued + 1 },
  ]) {
    assert.equal(isBoundAccessToken(claims, now), false);
  }
});

test('expired, revoked and mismatched sessions cannot authorize access', () => {
  const session = { userId: 'admin', revokedAt: null, createdAt: new Date(now - 1000), expiresAt: new Date(now + 3600_000) };
  assert.equal(isCurrentSession(session, identity.sub, now), true);
  assert.equal(isCurrentSession(session, 'another-user', now), false);
  assert.equal(isCurrentSession({ ...session, revokedAt: new Date(now) }, identity.sub, now), false);
  assert.equal(isCurrentSession({ ...session, expiresAt: new Date(now) }, identity.sub, now), false);
  const legacy = { ...session, createdAt: new Date(now - 86_400_000) };
  assert.equal(sessionDeadline(legacy), now);
  assert.equal(isCurrentSession(legacy, identity.sub, now), false);
});
