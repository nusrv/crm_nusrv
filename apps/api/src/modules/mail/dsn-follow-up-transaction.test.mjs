import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { commitCorroboratedDsnObservation } from './dsn-follow-up-transaction.ts';

const account = { mailConfigurationId: 'mailbox-1', generation: '11111111-1111-4111-8111-111111111111',
  providerNamespace: 'fixture-provider', providerAccountId: 'opaque-account-A' };
const snapshot = { ...account, enabled: true, observationEnabled: true };
const proof = { subject: { type: 'CommunicationOutbox', id: 'outbox-1' }, mailConfigurationId: account.mailConfigurationId,
  sourceObjectId: 'event-1', folder: 'INBOX', originalMessageId: '<Original@crm.example.test>',
  attemptId: 'attempt-1', envelopeRecipient: 'billing@example.test', enhancedStatus: '5.1.1' };
const report = (p = proof) => ({ account, provenance: p, candidate: { kind: 'CANDIDATE_DSN', mailConfigurationId: p.mailConfigurationId,
  sourceObjectId: p.sourceObjectId, deliveryStatus: 'UNKNOWN', requiresHumanReview: true,
  recipients: [{ claimedFinalRecipient: p.envelopeRecipient, enhancedStatus: p.enhancedStatus, action: 'failed', disposition: 'HARD' }] } });
function corroborated(p) {
  const digest = createHash('sha256').update(JSON.stringify([p.mailConfigurationId, p.subject.type, p.subject.id, p.attemptId, p.envelopeRecipient])).digest('hex');
  return { outcome: 'PLAN_HUMAN_FOLLOW_UP', deduplicationKey: 'dsn-hard:v2:' + digest,
    subject: p.subject, mailConfigurationId: p.mailConfigurationId, attemptId: p.attemptId,
    sourceObjectId: p.sourceObjectId, folder: p.folder, originalMessageId: p.originalMessageId,
    recipient: p.envelopeRecipient, enhancedStatus: p.enhancedStatus };
}
function store({ current = snapshot, auditResult, failAt } = {}) {
  const calls = []; const tasks = new Map(); const observations = new Map(); const audits = [];
  let tail = Promise.resolve();
  return { calls, tasks, observations, audits, transaction(operation) {
    const execution = tail.then(async () => {
      const before = [structuredClone(tasks), structuredClone(observations), audits.length];
      try { return await operation({
        async lockCurrentBinding(id) { calls.push('binding'); assert.equal(id, account.mailConfigurationId); return current; },
        async corroborateAttempt(c, p) { calls.push('corroborate'); assert.equal(c.sourceObjectId, p.sourceObjectId); return auditResult ?? corroborated(p); },
        async lockFollowUp(key) { calls.push('task'); return tasks.get(key) ?? null; },
        async findObservation(key) { calls.push('observation'); return observations.get(key) ?? null; },
        async insertFollowUp(t) { calls.push('insertTask'); const id = 'task-' + (tasks.size + 1); assert.ok(!tasks.has(t.followUpKey)); tasks.set(t.followUpKey, { ...t, id }); return { id }; },
        async insertObservation(e) { calls.push('insertEvidence'); if (failAt === 'insert') throw Error('insert failed');
          if (failAt === 'count') return 0; assert.ok(!observations.has(e.observationKey)); observations.set(e.observationKey, e); return 1; },
        async appendObservationAudit(e) { calls.push('audit'); if (failAt === 'audit') throw Error('audit failed'); audits.push(e); },
      }); } catch (error) { tasks.clear(); for (const [k, v] of before[0]) tasks.set(k, v);
        observations.clear(); for (const [k, v] of before[1]) observations.set(k, v); audits.length = before[2]; throw error; }
    });
    tail = execution.catch(() => {}); return execution;
  } };
}
const run = (s, r = report(), c = snapshot) => commitCorroboratedDsnObservation(s, c, r);

test('binding and recorded attempt precede an atomic task, observation and audit insert', async () => {
  const s = store(); assert.deepEqual(await run(s), { outcome: 'RECORDED', taskCreated: true });
  assert.deepEqual(s.calls, ['binding', 'corroborate', 'task', 'observation', 'insertTask', 'insertEvidence', 'audit']);
  const task = [...s.tasks.values()][0]; assert.equal(task.status, 'OPEN'); assert.equal(task.revision, 1);
  assert.equal(s.audits[0].subjectId, task.id); assert.equal(s.audits[0].metadata.taskCreated, true);
  assert.ok(!('recipient' in s.audits[0].metadata));
});
test('unverified cross-account or mismatched source report never opens a transaction', async () => {
  for (const r of [null, { ...report(), account: { ...account, mailConfigurationId: 'other' } },
    { ...report(), candidate: { ...report().candidate, sourceObjectId: 'other' } }]) {
    const s = store(); assert.deepEqual(await run(s, r), { outcome: 'REVIEW_ONLY', reason: 'UNVERIFIED_SOURCE' }); assert.equal(s.calls.length, 0);
  }
});
test('stale or disabled binding and missing recorded acceptance cannot persist evidence', async () => {
  for (const [options, reason, calls] of [
    [{ current: { ...snapshot, generation: '22222222-2222-4222-8222-222222222222' } }, 'STALE_BINDING', ['binding']],
    [{ current: { ...snapshot, observationEnabled: false } }, 'DISABLED', ['binding']],
    [{ auditResult: { outcome: 'REVIEW_ONLY', reason: 'ATTEMPT_NOT_CORROBORATED' } }, 'ATTEMPT_NOT_CORROBORATED', ['binding', 'corroborate']],
  ]) { const s = store(options); assert.deepEqual(await run(s), { outcome: 'REVIEW_ONLY', reason }); assert.deepEqual(s.calls, calls); assert.equal(s.tasks.size, 0); }
});
test('exact replay and simulated concurrent writers do not duplicate tasks, observations or audits', async () => {
  const s = store(); const results = await Promise.all([run(s), run(s), run(s)]);
  assert.deepEqual(results, [{ outcome: 'RECORDED', taskCreated: true }, { outcome: 'NO_CHANGE' }, { outcome: 'NO_CHANGE' }]);
  assert.equal(s.tasks.size, 1); assert.equal(s.observations.size, 1); assert.equal(s.audits.length, 1);
});
test('new event adds evidence without reopening resolved task; conflicting event identity is review-only', async () => {
  const s = store(); await run(s); const task = [...s.tasks.values()][0]; task.status = 'RESOLVED'; task.revision = 2;
  assert.deepEqual(await run(s, report({ ...proof, sourceObjectId: 'event-2' })), { outcome: 'RECORDED', taskCreated: false });
  assert.deepEqual(await run(s, report({ ...proof, enhancedStatus: '5.2.2' })), { outcome: 'REVIEW_ONLY', reason: 'OBSERVATION_CONFLICT' });
  assert.equal(task.status, 'RESOLVED'); assert.equal(task.revision, 2); assert.equal(s.tasks.size, 1); assert.equal(s.observations.size, 2); assert.equal(s.audits.length, 2);
});
test('insert, unexpected insert count or audit failure rolls back new task and observation in the transaction double', async () => {
  for (const failAt of ['insert', 'count', 'audit']) { const s = store({ failAt }); await assert.rejects(run(s));
    assert.equal(s.tasks.size, 0); assert.equal(s.observations.size, 0); assert.equal(s.audits.length, 0); }
});
