import test from 'node:test';
import assert from 'node:assert/strict';
import { mailWorkersPaused, pausedOutboundBatch, pausedInboundBatch } from './mail-worker-maintenance.ts';

test('maintenance hold requires exact validated opt-in', () => {
  assert.equal(mailWorkersPaused('true'), true);
  for (const value of ['false', undefined, null, false, true, 'TRUE']) assert.equal(mailWorkersPaused(value), false);
});
test('paused batch reports no work or invented send outcomes', () => {
  assert.deepEqual(pausedOutboundBatch(), { candidates: 0, sent: 0, deferred: 0, cancelled: 0, failed: 0, notClaimed: 0, conflicts: 0, ownershipLostAfterSend: 0 });
  assert.deepEqual(pausedInboundBatch(), { configsProcessed: 0, configsSkipped: 0, messagesIngested: 0, duplicatesSkipped: 0, humanReviewCount: 0 });
});
