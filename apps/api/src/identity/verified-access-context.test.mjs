import assert from 'node:assert/strict';
import test from 'node:test';
import { attachVerifiedAccessContext, readVerifiedAccessContext } from './verified-access-context.ts';

test('verified access context belongs to the exact principal, not its serialized public shape', () => {
  const user = { id: 'actor', roles: ['ADMIN'] };
  assert.equal(attachVerifiedAccessContext(user, 'session', 2000), user);
  assert.deepEqual(readVerifiedAccessContext(user, 1000), { actorId: 'actor', sessionId: 'session', accessExpiresAt: 2000 });
  assert.deepEqual(JSON.parse(JSON.stringify(user)), { id: 'actor', roles: ['ADMIN'] });
  assert.equal(readVerifiedAccessContext({ ...user }, 1000), null);
  assert.equal(readVerifiedAccessContext({ ...user, sessionId: 'session', accessExpiresAt: 2000 }, 1000), null);
});
test('expired, missing and mutated principal context fails closed', () => {
  const user = attachVerifiedAccessContext({ id: 'actor' }, 'session', 2000);
  assert.equal(readVerifiedAccessContext(user, 2000), null);
  assert.equal(readVerifiedAccessContext(null, 1000), null);
  assert.equal(readVerifiedAccessContext(user, NaN), null);
  user.id = 'other';
  assert.equal(readVerifiedAccessContext(user, 1000), null);
  assert.throws(() => attachVerifiedAccessContext({ id: 'actor' }, '', 2000));
});
