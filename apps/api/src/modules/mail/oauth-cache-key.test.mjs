import test from 'node:test';
import assert from 'node:assert/strict';
import { oauthCacheKey } from './oauth-cache-key.ts';

const key = Buffer.alloc(32, 7);
const credential = { tenantId: 'tenant', clientId: 'client', clientSecret: 'secret-1' };
test('identical credentials reuse an opaque process-local identity', () => {
  const first = oauthCacheKey(key, credential);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, oauthCacheKey(key, { ...credential }));
  assert.ok(!first.includes(credential.clientSecret));
});
test('credential changes and process key changes isolate cache entries', () => {
  const first = oauthCacheKey(key, credential);
  for (const change of [{ tenantId: 'other' }, { clientId: 'other' }, { clientSecret: 'secret-2' }]) {
    assert.notEqual(first, oauthCacheKey(key, { ...credential, ...change }));
  }
  assert.notEqual(first, oauthCacheKey(Buffer.alloc(32, 8), credential));
});
test('tuple boundaries cannot collide', () => {
  assert.notEqual(oauthCacheKey(key, { ...credential, tenantId: 'a:b', clientId: 'c' }),
    oauthCacheKey(key, { ...credential, tenantId: 'a', clientId: 'b:c' }));
});
