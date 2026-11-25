import assert from 'node:assert/strict';
import test from 'node:test';
import { createPrismaDsnEvidenceStore, createPrismaDsnResolutionStore } from './dsn-prisma-store.ts';
import { resolveCurrentProviderBinding } from './mail-provider-binding.ts';

const snapshot = { mailConfigurationId: 'mail-1', generation: '11111111-1111-4111-8111-111111111111',
  providerNamespace: 'test-provider', providerAccountId: 'account-1', enabled: true, observationEnabled: true };
const key = resolveCurrentProviderBinding(snapshot, snapshot, snapshot).binding.sourceBindingKey;
const row = { ...snapshot, currentMailboxKey: snapshot.mailConfigurationId, sourceBindingKey: key };
const task = { id: 'task-1', followUpKey: 'task-key', mailConfigurationId: 'mail-1', subjectType: 'CommunicationOutbox',
  subjectId: 'out-1', attemptId: 'attempt-1', recipient: 'user@example.test', originalMessageId: '<x@example.test>', status: 'OPEN', revision: 1,
  resolvedById: null, resolvedAt: null, resolutionReason: null };
const observation = { observationKey: 'event-key', followUpKey: task.followUpKey, mailConfigurationId: task.mailConfigurationId,
  bindingMailboxId: task.mailConfigurationId, sourceBindingKey: key, sourceObjectId: 'event-1', folder: 'INBOX', enhancedStatus: '5.1.1', followUp: task };
function fixture(overrides = {}) {
  const calls = []; const audits = [];
  const tx = {
    async $queryRaw(parts, ...params) { calls.push(['sql', parts.join('?'), params]); return parts[0].includes('SELECT r.code') ? [{ code: 'ADMIN' }] : []; },
    mailConfiguration: { async findUnique() { return { id: 'mail-1', enabled: true }; } },
    mailProviderEvidenceBinding: { async findUnique() { return row; } },
    mailDsnFollowUp: { async findUnique() { return task; }, async create(args) { calls.push(['task', args]); return { id: task.id }; },
      async updateMany(args) { calls.push(['resolve', args]); return { count: 1 }; } },
    mailDsnObservation: { async findUnique() { return observation; }, async createMany(args) { calls.push(['observation', args]); return { count: 1 }; } },
    user: { async findUnique() { return { id: 'user-1', active: true }; } },
    authSession: { async findUnique() { return { id: 'session-1', userId: 'user-1', createdAt: new Date(0), expiresAt: new Date(1000), revokedAt: null }; } },
    ...overrides,
  };
  const prisma = { async $transaction(fn, options) { assert.deepEqual(options, { isolationLevel: 'ReadCommitted' }); return fn(tx); } };
  const audit = { async record(event, client) { assert.equal(client, tx); audits.push(event); } };
  return { calls, audits, evidence: createPrismaDsnEvidenceStore(prisma, audit), resolution: createPrismaDsnResolutionStore(prisma, audit) };
}
test('binding reads lock parent before current generation and reject corrupted keys', async () => {
  const f = fixture(); assert.deepEqual(await f.evidence.transaction(tx => tx.lockCurrentBinding('mail-1')), snapshot);
  assert.match(f.calls[0][1], /mail_configurations.*FOR UPDATE/); assert.match(f.calls[1][1], /mail_provider_evidence_bindings.*FOR UPDATE/);
  assert.deepEqual(f.calls[0][2], ['mail-1']);
  const bad = fixture({ mailProviderEvidenceBinding: { async findUnique() { return { ...row, sourceBindingKey: 'wrong' }; } } });
  assert.equal(await bad.evidence.transaction(tx => tx.lockCurrentBinding('mail-1')), null);
});
test('stored observation reconstructs typed identity from its task and inserts only persisted scalar columns', async () => {
  const f = fixture(); await f.evidence.transaction(async tx => {
    const actual = await tx.findObservation('event-key'); assert.equal(actual.recipient, task.recipient); assert.equal(actual.subjectType, task.subjectType);
    assert.equal(await tx.insertObservation(actual), 1);
    const { data } = f.calls.find(c => c[0] === 'observation')[1];
    assert.equal(data[0].bindingMailboxId, 'mail-1'); assert.ok(!('subjectType' in data[0])); assert.ok(!('recipient' in data[0]));
  });
  const bad = fixture({ mailDsnObservation: { async findUnique() { return { ...observation, bindingMailboxId: 'other' }; } } });
  await assert.rejects(bad.evidence.transaction(tx => tx.findObservation('event-key')), /scope mismatch/);
});
test('resolution locks exact current actor, session, roles and task; CAS excludes corrupt state and audit uses same tx', async () => {
  const f = fixture(); await f.resolution.transaction(async tx => {
    const actor = await tx.lockCurrentActor({ actorId: 'user-1', sessionId: 'session-1' }); assert.deepEqual(actor.roles, ['ADMIN']);
    assert.equal((await tx.lockTask('task-1')).id, task.id);
    const change = { status: 'RESOLVED', revision: 2, resolvedById: 'user-1', resolvedAt: new Date(100), resolutionReason: 'Reviewed' };
    assert.equal(await tx.compareAndResolve(task.id, 1, change), 1); await tx.appendAudit({ actorId: 'user-1' });
    assert.deepEqual(f.calls.filter(c => c[0] === 'sql').map(c => c[1].match(/FROM (\w+)/)[1]), ['users', 'auth_sessions', 'user_roles', 'mail_dsn_follow_ups']);
    assert.deepEqual(f.calls.find(c => c[0] === 'resolve')[1].where, { id: task.id, revision: 1, status: 'OPEN', resolvedById: null, resolvedAt: null, resolutionReason: null });
    assert.equal(f.audits.length, 1);
  });
});
