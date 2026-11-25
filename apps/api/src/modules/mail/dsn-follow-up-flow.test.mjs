import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDsnCandidate, selectDsnInboundTriage } from './dsn-candidate-parser.ts';
import { planDsnFollowUpFromRecordedAttempt } from './dsn-recorded-attempt.ts';
import { commitCorroboratedDsnObservation } from './dsn-follow-up-transaction.ts';
import { resolveDsnFollowUp } from './dsn-follow-up-resolution.ts';

// Controlled synthetic attestation and audit rows, not a provider verifier or a database.
const account = { mailConfigurationId: 'mailbox-1', generation: '11111111-1111-4111-8111-111111111111',
  providerNamespace: 'fixture-provider', providerAccountId: 'fixture-account' };
const snapshot = { ...account, enabled: true, observationEnabled: true };
const proof = { subject: { type: 'CommunicationOutbox', id: 'outbox-1' }, mailConfigurationId: account.mailConfigurationId,
  sourceObjectId: 'event-1', folder: 'INBOX', originalMessageId: '<Original@crm.example.test>',
  attemptId: 'attempt-1', envelopeRecipient: 'billing@example.test', enhancedStatus: '5.1.1' };
const actorContext = { actorId: 'admin-1', sessionId: 'session-1' };
const now = new Date('2026-11-25T10:00:00Z');
const actor = { ...actorContext, active: true, roles: ['ADMIN'], sessionUserId: actorContext.actorId,
  sessionCreatedAt: new Date(now.getTime() - 1000), sessionExpiresAt: new Date(now.getTime() + 1000), sessionRevokedAt: null };
const mime = (sourceObjectId = proof.sourceObjectId, overrides = {}) => ({ mailConfigurationId: proof.mailConfigurationId, sourceObjectId,
  outerContentType: 'multipart/report; boundary="a;b"; report-type=delivery-status', reportPartContentType: 'message/delivery-status',
  reportPartText: 'Reporting-MTA: dns; mx.example.test\r\n\r\nFinal-Recipient: rfc822;billing@example.test\r\nAction: failed\r\nStatus: 5.1.1', ...overrides });
function auditRows(p = proof, source = 'smtp') {
  const row = { actorType: 'SYSTEM', subjectType: p.subject.type, subjectId: p.subject.id };
  return [{ ...row, eventKey: 'mail.send.attempt_started', metadata: { attemptId: p.attemptId,
    mailConfigurationId: p.mailConfigurationId, messageId: p.originalMessageId, recipient: p.envelopeRecipient } },
  { ...row, eventKey: p.subject.type === 'CommunicationOutbox' ? 'mail.send.succeeded' : 'communication.reply.delivered',
    metadata: { attemptId: p.attemptId, applied: false, acceptance: { source, responseCode: 250 } } }];
}
function store({ rows = auditRows(), current = snapshot, currentActor = actor } = {}) {
  const tasks = new Map(); const observations = new Map(); const audits = [];
  let tail = Promise.resolve();
  return { tasks, observations, audits, transaction(operation) {
    const result = tail.then(async () => {
      const before = [structuredClone(tasks), structuredClone(observations), audits.length];
      const byId = id => [...tasks.values()].find(t => t.id === id) ?? null;
      try { return await operation({
        async lockCurrentBinding(id) { assert.equal(id, account.mailConfigurationId); return current; },
        async corroborateAttempt(candidate, provenance) {
          return planDsnFollowUpFromRecordedAttempt({ auditEvent: { async findMany({ where, take }) {
            return rows.filter(r => r.actorType === where.actorType && r.subjectType === where.subjectType &&
              r.subjectId === where.subjectId && where.eventKey.in.includes(r.eventKey)).slice(0, take);
          } } }, candidate, provenance);
        },
        async lockFollowUp(key) { return tasks.get(key) ?? null; },
        async findObservation(key) { return observations.get(key) ?? null; },
        async insertFollowUp(task) { const id = 'task-' + (tasks.size + 1); assert.ok(!tasks.has(task.followUpKey)); tasks.set(task.followUpKey, { ...task, id }); return { id }; },
        async insertObservation(entry) { assert.ok(!observations.has(entry.observationKey)); observations.set(entry.observationKey, entry); return 1; },
        async appendObservationAudit(event) { audits.push(event); },
        async lockCurrentActor(context) { assert.deepEqual(context, actorContext); return currentActor; },
        async lockTask(id) { return byId(id); },
        async compareAndResolve(id, revision, change) { const t = byId(id); if (!t || t.status !== 'OPEN' || t.revision !== revision) return 0;
          tasks.set(t.followUpKey, { ...t, ...change }); return 1; },
        async appendAudit(event) { audits.push(event); },
      }); } catch (error) { tasks.clear(); for (const [k,v] of before[0]) tasks.set(k,v);
        observations.clear(); for (const [k,v] of before[1]) observations.set(k,v); audits.length = before[2]; throw error; }
    });
    tail = result.catch(() => {}); return result;
  } };
}
async function ingest(s, input = mime(), attestation = proof, captured = snapshot) {
  const candidate = parseDsnCandidate(input);
  const triage = selectDsnInboundTriage(candidate);
  if (candidate.kind !== 'CANDIDATE_DSN') return { outcome: 'TRIAGED', triage };
  return commitCorroboratedDsnObservation(s, captured, attestation ? { account, provenance: attestation, candidate } : null);
}

test('actual parser, recorded audit corroboration, binding, ledger and operator resolution compose end to end', async () => {
  const s = store(); assert.deepEqual(await ingest(s), { outcome: 'RECORDED', taskCreated: true });
  const task = [...s.tasks.values()][0]; const cmd = { taskId: task.id, expectedRevision: 1, reason: 'Reviewed delivery report' };
  assert.deepEqual(await resolveDsnFollowUp(s, actorContext, cmd, () => now), { outcome: 'RESOLVED', revision: 2 });
  assert.deepEqual(await ingest(s), { outcome: 'NO_CHANGE' });
  assert.deepEqual(await ingest(s, mime('event-2'), { ...proof, sourceObjectId: 'event-2' }), { outcome: 'RECORDED', taskCreated: false });
  assert.deepEqual(await resolveDsnFollowUp(s, actorContext, cmd, () => now), { outcome: 'NO_CHANGE' });
  assert.equal(s.tasks.size, 1); assert.equal(s.observations.size, 2);
  assert.equal([...s.tasks.values()][0].status, 'RESOLVED');
  assert.deepEqual(s.audits.map(e => e.eventKey), ['mail.dsn.observation.recorded', 'mail.dsn.follow_up.resolved', 'mail.dsn.observation.recorded']);
});
test('real parser keeps contradictory MIME out of ordinary inbound while ordinary MIME stays ordinary', async () => {
  const s = store();
  for (const outerContentType of ['text/plain', 'multipart/report', 'multipart/report; report-type=delivery-status; report-type=other']) {
    const result = await ingest(s, mime('event-1', { outerContentType }));
    assert.equal(result.outcome, 'TRIAGED'); assert.equal(result.triage.mayUseCustomerReplyCorrelation, false);
  }
  const normal = await ingest(s, mime('event-1', { outerContentType: 'text/plain', reportPartContentType: null, reportPartText: null }));
  assert.equal(normal.triage.mayUseCustomerReplyCorrelation, true); assert.equal(s.tasks.size, 0);
});
test('provider proof absence, mismatched recipient, missing or mock SMTP acceptance cannot create a task', async () => {
  for (const [s, input, p] of [[store(), mime(), null], [store(), mime('event-1', { reportPartText: mime().reportPartText.replace('billing@example.test', 'other@example.test') }), proof],
    [store({ rows: auditRows().slice(0, 1) }), mime(), proof], [store({ rows: auditRows(proof, 'mock') }), mime(), proof]]) {
    assert.equal((await ingest(s, input, p)).outcome, 'REVIEW_ONLY'); assert.equal(s.tasks.size, 0); assert.equal(s.observations.size, 0); assert.equal(s.audits.length, 0);
  }
});
test('actual audit resolver distinguishes two typed outboxes with identical subject and attempt IDs', async () => {
  const operator = { ...proof, subject: { ...proof.subject, type: 'OperatorReplyOutbox' }, sourceObjectId: 'event-2' };
  const s = store({ rows: [...auditRows(), ...auditRows(operator)] });
  assert.deepEqual(await ingest(s), { outcome: 'RECORDED', taskCreated: true });
  assert.deepEqual(await ingest(s, mime('event-2'), operator), { outcome: 'RECORDED', taskCreated: true });
  assert.equal(s.tasks.size, 2); assert.equal(s.observations.size, 2);
});
test('old binding and revoked operator session do not mutate follow-up state', async () => {
  const stale = store({ current: { ...snapshot, generation: '22222222-2222-4222-8222-222222222222' } });
  assert.deepEqual(await ingest(stale), { outcome: 'REVIEW_ONLY', reason: 'STALE_BINDING' });
  const s = store({ currentActor: { ...actor, sessionRevokedAt: now } }); await ingest(s);
  const task = [...s.tasks.values()][0];
  assert.deepEqual(await resolveDsnFollowUp(s, actorContext, { taskId: task.id, expectedRevision: 1, reason: 'Reviewed' }, () => now), { outcome: 'FORBIDDEN' });
  assert.equal([...s.tasks.values()][0].status, 'OPEN'); assert.equal(s.audits.length, 1);
});
