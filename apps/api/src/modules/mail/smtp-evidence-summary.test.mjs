import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeSmtpEvidence } from './smtp-evidence-summary.ts';
const start = { actorType: 'SYSTEM', eventKey: 'mail.send.attempt_started', metadata: {
  attemptId: 'a', mailConfigurationId: 'mail', messageId: '<a@example.test>', recipient: 'buyer@example.test',
} };
const success = { actorType: 'SYSTEM', eventKey: 'mail.send.succeeded', metadata: {
  attemptId: 'a', acceptance: { source: 'smtp', responseCode: 250 }, applied: false,
} };
const summary = (events, truncated = false) => summarizeSmtpEvidence('CommunicationOutbox', events, truncated);
test('exact start and acceptance report SMTP only, including late recorded acceptance', () => {
  assert.deepEqual(summary([start, success]), { state: 'SMTP_ACCEPTED', responseCode: 250 });
  assert.deepEqual(summarizeSmtpEvidence('OperatorReplyOutbox', [start, { ...success, eventKey: 'communication.reply.delivered' }]), { state: 'SMTP_ACCEPTED', responseCode: 250 });
});
test('mock is never real acceptance', () => {
  assert.deepEqual(summary([start, { ...success, metadata: { attemptId: 'a', acceptance: { source: 'mock' } } }]), { state: 'MOCK_ONLY', responseCode: null });
});
test('missing and mismatched records never assert SMTP acceptance', () => {
  assert.equal(summary([start]).state, 'UNVERIFIED');
  assert.equal(summary([success]).state, 'REVIEW_REQUIRED');
  assert.equal(summary([start, { ...success, metadata: { ...success.metadata, attemptId: 'b' } }]).state, 'REVIEW_REQUIRED');
});
test('duplicate, non-system and truncated histories require review', () => {
  assert.equal(summary([start, success, success]).state, 'REVIEW_REQUIRED');
  assert.equal(summary([start, { ...success, actorType: 'USER' }]).state, 'REVIEW_REQUIRED');
  assert.equal(summary([start, success], true).state, 'REVIEW_REQUIRED');
});
test('legacy success and non-2xx responses never become SMTP acceptance', () => {
  assert.equal(summary([start, { ...success, metadata: {} }]).state, 'UNVERIFIED');
  assert.equal(summary([start, { ...success, metadata: { attemptId: 'a', acceptance: { source: 'smtp', responseCode: 550 } } }]).state, 'UNVERIFIED');
});
