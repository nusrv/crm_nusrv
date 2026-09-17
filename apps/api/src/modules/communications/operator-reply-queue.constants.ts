export const OPERATOR_REPLY_QUEUE = 'operator-reply-outbound';
export const OPERATOR_REPLY_SEND_JOB = 'process-operator-reply';
export const OPERATOR_REPLY_SEND_SCHEDULER = 'periodic-operator-reply-processing';

/** Faster cadence than Slice B's 60s reminder batch (mail-queue.service.ts) — an operator is
 * actively waiting to see their reply move past QUEUED, so a shorter periodic batch interval is
 * appropriate; still a bounded polling cadence, never a per-request trigger from the HTTP layer. */
export const OPERATOR_REPLY_SCAN_INTERVAL_MS = 15_000;

/** Bounded batch size, mirroring MailOutboundService.BATCH_SIZE — never an unbounded scan. */
export const OPERATOR_REPLY_BATCH_SIZE = 25;
