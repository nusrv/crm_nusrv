import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCurrentProviderBinding } from './mail-provider-binding.ts';

const account = {
  mailConfigurationId: 'mailbox-1', generation: '11111111-1111-4111-8111-111111111111',
  providerNamespace: 'fixture-provider', providerAccountId: 'opaque-account-A',
};
const enabled = { ...account, enabled: true, observationEnabled: true };
const check = (captured = enabled, current = enabled, verified = account) =>
  resolveCurrentProviderBinding(captured, current, verified);

test('a verified matching current account produces a stable scoped key without exposing the account ID', () => {
  const result = check();
  assert.equal(result.outcome, 'BOUND');
  assert.match(result.binding.sourceBindingKey, /^provider-binding:v1:[a-f0-9]{64}$/);
  assert.equal(result.binding.mailConfigurationId, account.mailConfigurationId);
  assert.deepEqual(check({ ...enabled }, { ...enabled }, { ...account }), result);
  assert.ok(!JSON.stringify(result).includes(account.providerAccountId));
});

test('unavailable durable binding or independent account attestation fails closed', () => {
  for (const values of [[null, enabled, account], [enabled, null, account], [enabled, enabled, null],
    [enabled, enabled, { mailConfigurationId: account.mailConfigurationId }]]) {
    assert.deepEqual(resolveCurrentProviderBinding(...values), { outcome: 'UNAVAILABLE' });
  }
});

test('both captured and current flags must be explicitly enabled', () => {
  for (const flag of ['enabled', 'observationEnabled']) {
    for (const invalid of [false, undefined, 'true', 1]) {
      assert.deepEqual(check({ ...enabled, [flag]: invalid }), { outcome: 'DISABLED' });
      assert.deepEqual(check(enabled, { ...enabled, [flag]: invalid }), { outcome: 'DISABLED' });
    }
  }
});

test('repoint, generation change, namespace change and account case change reject a stale read', () => {
  for (const delta of [
    { mailConfigurationId: 'mailbox-2' }, { generation: '22222222-2222-4222-8222-222222222222' },
    { providerNamespace: 'other-provider' }, { providerAccountId: 'opaque-account-a' },
  ]) assert.deepEqual(check(enabled, { ...enabled, ...delta }, { ...account, ...delta }), { outcome: 'STALE_BINDING' });
});

test('independent adapter account must match every exact current binding component', () => {
  for (const delta of [
    { mailConfigurationId: 'mailbox-2' }, { generation: '22222222-2222-4222-8222-222222222222' },
    { providerNamespace: 'other-provider' }, { providerAccountId: 'opaque-account-a' },
  ]) assert.deepEqual(check(enabled, enabled, { ...account, ...delta }), { outcome: 'ACCOUNT_MISMATCH' });
});

test('malformed identities cannot be normalized into a valid binding', () => {
  for (const delta of [
    { generation: 'not-an-epoch' }, { providerNamespace: 'UPPER' }, { providerNamespace: 'x'.repeat(65) },
    { mailConfigurationId: 'mailbox-1\r\n' }, { providerAccountId: ' opaque-account-A' },
    { providerAccountId: '\ud800' }, { providerAccountId: 'a'.repeat(513) },
  ]) assert.deepEqual(check(enabled, enabled, { ...account, ...delta }), { outcome: 'UNAVAILABLE' });
});

test('separately established mailbox, account, namespace and generation each create different scopes', () => {
  const original = check();
  for (const delta of [
    { mailConfigurationId: 'mailbox-2' }, { generation: '22222222-2222-4222-8222-222222222222' },
    { providerNamespace: 'other-provider' }, { providerAccountId: 'opaque-account-a' },
  ]) {
    const snapshot = { ...enabled, ...delta };
    const next = check(snapshot, snapshot, { ...account, ...delta });
    assert.equal(next.outcome, 'BOUND');
    assert.notEqual(next.binding.sourceBindingKey, original.binding.sourceBindingKey);
  }
});
