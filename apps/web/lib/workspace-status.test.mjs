import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workspaceStatus, mailDispatchStatus } from './workspace-status.ts';
test('renewal states follow approved vocabulary', () => {
  assert.equal(workspaceStatus('AWAITING_CUSTOMER'), 'Waiting for Customer');
  assert.equal(workspaceStatus('HUMAN_REVIEW'), 'Needs Review');
  assert.equal(workspaceStatus('DO_NOT_RENEW'), 'Do Not Renew');
});
test('invoice status represents CRM recording, not live submission', () => {
  assert.equal(workspaceStatus('FAWTARA_ACCEPTED'), 'Official Invoice Recorded');
  assert.equal(workspaceStatus('READY_FOR_FAWTARA'), 'Ready to Record Official Invoice');
});
test('legacy delivered and unknown are not proof of receipt', () => {
  assert.equal(mailDispatchStatus('DELIVERED'), 'Dispatch recorded — delivery not verified');
  assert.equal(mailDispatchStatus('UNKNOWN'), 'Delivery not verified');
  assert.equal(mailDispatchStatus('FAILED', true), 'Dispatch uncertain — review required');
});
test('unknown enum keys do not access Object prototype', () => {
  assert.equal(workspaceStatus('constructor'), 'Constructor');
  assert.equal(workspaceStatus('PAYMENT_CONFIRMED'), 'Payment Confirmed');
});
