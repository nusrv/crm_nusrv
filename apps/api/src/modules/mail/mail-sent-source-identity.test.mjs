import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeImapIdentityKey } from './imap-identity.util.ts';
import { sentSourceIdentity } from './mail-sent-source-identity.ts';
const base = { mailConfigurationId: 'mail-1', canonicalFolder: 'Sent', uidValidity: 100n, uid: 20n };
const generation = '11111111-1111-4111-8111-111111111111';
test('legacy identity is unchanged', () => {
  assert.equal(sentSourceIdentity(base), computeImapIdentityKey(base));
  assert.equal(sentSourceIdentity({ ...base, connectionGeneration: 'legacy' }), computeImapIdentityKey(base));
});
test('generation, mailbox, exact folder and UIDs all scope the new key', () => {
  const first = sentSourceIdentity({ ...base, connectionGeneration: generation });
  assert.match(first, /^v2:[0-9a-f]{64}$/);
  assert.notEqual(first, sentSourceIdentity(base));
  for (const change of [{ connectionGeneration: '22222222-2222-4222-8222-222222222222' }, { canonicalFolder: 'sent' }, { mailConfigurationId: 'mail-2' }, { uidValidity: 101n }, { uid: 21n }]) {
    assert.notEqual(first, sentSourceIdentity({ ...base, connectionGeneration: generation, ...change }));
  }
  assert.equal(first, sentSourceIdentity({ ...base, connectionGeneration: generation }));
});
test('reject invalid generation', () => {
  for (const connectionGeneration of ['', 'arbitrary', '11111111-1111-1111-1111-111111111111']) assert.throws(() => sentSourceIdentity({ ...base, connectionGeneration }));
});
