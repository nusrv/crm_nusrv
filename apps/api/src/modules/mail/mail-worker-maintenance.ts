/** Deployment-only maintenance freeze. It is independent of mailbox settings
 * and never marks a pending message delivered, cancelled or failed. */
export function mailWorkersPaused(value: unknown): boolean {
  return value === 'true';
}

export function pausedOutboundBatch() {
  return { candidates: 0, sent: 0, deferred: 0, cancelled: 0, failed: 0,
    notClaimed: 0, conflicts: 0, ownershipLostAfterSend: 0 };
}
export function pausedInboundBatch() {
  return { configsProcessed: 0, configsSkipped: 0, messagesIngested: 0,
    duplicatesSkipped: 0, humanReviewCount: 0 };
}
