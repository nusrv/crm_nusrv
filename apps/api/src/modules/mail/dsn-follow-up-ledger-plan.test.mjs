import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { prepareDsnLedgerEntry, decideDsnLedgerWrite } from './dsn-follow-up-ledger-plan.ts';

const proof = {
  subject: { type: 'CommunicationOutbox', id: 'outbox-1' },
  mailConfigurationId: 'mailbox-1', sourceObjectId: 'provider-event-1', folder: 'INBOX',
  originalMessageId: '<Original@crm.example.test>', attemptId: 'attempt-1',
  envelopeRecipient: 'billing@example.test', enhancedStatus: '5.1.1',
};
const binding = { mailConfigurationId: proof.mailConfigurationId, sourceBindingKey: 'verified-account-epoch-1' };
function plan(p = proof) {
  const key = createHash('sha256').update(JSON.stringify([
    p.mailConfigurationId, p.subject.type, p.subject.id, p.attemptId, p.envelopeRecipient,
  ])).digest('hex');
  return { outcome: 'PLAN_HUMAN_FOLLOW_UP', deduplicationKey: 'dsn-hard:v2:' + key,
    subject: p.subject, mailConfigurationId: p.mailConfigurationId, attemptId: p.attemptId,
    sourceObjectId: p.sourceObjectId, folder: p.folder, recipient: p.envelopeRecipient,
    originalMessageId: p.originalMessageId, enhancedStatus: p.enhancedStatus };
}
function entry(p = proof, b = binding) {
  const result = prepareDsnLedgerEntry(plan(p), p, b);
  assert.ok(result);
  return result;
}
const task = (e, status = 'OPEN') => ({ ...e, status });

test('first event plans exactly one task and no delivery or send mutation', () => {
  const e = entry();
  assert.match(e.observationKey, /^dsn-event:v1:[0-9a-f]{64}$/);
  assert.equal(e.followUpKey, plan().deduplicationKey);
  assert.deepEqual(decideDsnLedgerWrite(e, null, null), { outcome: 'INSERT_OBSERVATION', createFollowUp: true });
  for (const key of ['deliveryStatus', 'send', 'caseStatus', 'body']) assert.ok(!(key in e));
});

test('same event replay is a no-op for open and resolved tasks', () => {
  const e = entry();
  for (const status of ['OPEN', 'RESOLVED']) {
    assert.deepEqual(decideDsnLedgerWrite(e, { ...e }, task(e, status)), { outcome: 'NO_CHANGE' });
  }
});

test('different provider reports add evidence without creating or reopening a task', () => {
  const first = entry();
  const later = entry({ ...proof, sourceObjectId: 'provider-event-2' });
  assert.notEqual(first.observationKey, later.observationKey);
  assert.equal(first.followUpKey, later.followUpKey);
  for (const status of ['OPEN', 'RESOLVED']) {
    assert.deepEqual(decideDsnLedgerWrite(later, null, task(first, status)), { outcome: 'INSERT_OBSERVATION', createFollowUp: false });
  }
});

test('typed subject, attempt, recipient and mailbox are exact task boundaries', () => {
  const first = entry();
  for (const p of [
    { ...proof, subject: { ...proof.subject, type: 'OperatorReplyOutbox' } },
    { ...proof, subject: { ...proof.subject, id: 'other' } },
    { ...proof, attemptId: 'attempt-2' },
    { ...proof, envelopeRecipient: 'Billing@example.test' },
    { ...proof, mailConfigurationId: 'mailbox-2' },
  ]) {
    const different = entry(p, { ...binding, mailConfigurationId: p.mailConfigurationId });
    assert.notEqual(first.followUpKey, different.followUpKey);
  }
  const otherBinding = entry(proof, { ...binding, sourceBindingKey: 'verified-account-epoch-2' });
  assert.notEqual(first.observationKey, otherBinding.observationKey);
  assert.equal(first.followUpKey, otherBinding.followUpKey);
});

test('reused source event with conflicting evidence is review-only; no overwritten observation', () => {
  const first = entry();
  for (const p of [
    { ...proof, enhancedStatus: '5.2.2' }, { ...proof, folder: 'Other' },
    { ...proof, envelopeRecipient: 'other@example.test' },
    { ...proof, originalMessageId: '<Different@crm.example.test>' },
  ]) {
    const conflicting = entry(p);
    assert.equal(conflicting.observationKey, first.observationKey);
    assert.deepEqual(decideDsnLedgerWrite(conflicting, first, task(first)), { outcome: 'REVIEW_ONLY', reason: 'OBSERVATION_CONFLICT' });
  }
});

test('missing task, wrong task identity and unknown task status fail closed', () => {
  const e = entry();
  assert.deepEqual(decideDsnLedgerWrite(e, e, null), { outcome: 'REVIEW_ONLY', reason: 'MISSING_FOLLOW_UP' });
  for (const t of [task(e, 'OTHER'), { ...task(e), recipient: 'other@example.test' }]) {
    assert.deepEqual(decideDsnLedgerWrite(e, null, t), { outcome: 'REVIEW_ONLY', reason: 'FOLLOW_UP_CONFLICT' });
  }
});

test('rejects absent, mismatched, malformed and forged identities before planning', () => {
  for (const p of [
    { ...proof, sourceObjectId: '' }, { ...proof, sourceObjectId: 'event\r\n' },
    { ...proof, sourceObjectId: '\ud800' }, { ...proof, sourceObjectId: 'a'.repeat(257) },
    { ...proof, envelopeRecipient: 'a@@example.test' }, { ...proof, originalMessageId: 'local-id' },
    { ...proof, enhancedStatus: '4.1.1' }, { ...proof, subject: { type: 'Other', id: 'x' } },
  ]) assert.equal(prepareDsnLedgerEntry(plan(p), p, binding), null);
  for (const b of [null, { ...binding, mailConfigurationId: 'wrong' }, { ...binding, sourceBindingKey: '' }]) {
    assert.equal(prepareDsnLedgerEntry(plan(), proof, b), null);
  }
  assert.equal(prepareDsnLedgerEntry(null, proof, binding), null);
  assert.equal(prepareDsnLedgerEntry(plan(), null, binding), null);
  assert.equal(prepareDsnLedgerEntry({ ...plan(), outcome: 'REVIEW_ONLY' }, proof, binding), null);
  assert.equal(prepareDsnLedgerEntry({ ...plan(), deduplicationKey: 'forged' }, proof, binding), null);
  assert.equal(prepareDsnLedgerEntry({ ...plan(), sourceObjectId: 'wrong' }, proof, binding), null);
  for (const p of [{ ...proof, folder: 'Other' }, { ...proof, originalMessageId: '<Other@crm.example.test>' }, { ...proof, enhancedStatus: '5.2.2' }]) {
    assert.equal(prepareDsnLedgerEntry(plan(), p, binding), null);
  }
  assert.deepEqual(decideDsnLedgerWrite(null, null, null), { outcome: 'REVIEW_ONLY', reason: 'INVALID_IDENTITY' });
});
