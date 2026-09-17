/** Slice E hardening (contract audit §2) — explicit, DB-backed retry backoff for
 * OperatorReplyOutboundService. The 15s periodic batch scan must never hammer the same failed row
 * every tick; `OperatorReplyOutbox.nextAttemptAt` is the durable source of truth for "when may this
 * row be reselected," never an in-memory timer.
 *
 * Indexed by (attempts - 1) after a real SMTP attempt fails and is NOT yet terminal: attempt 1 ->
 * ~1 min, attempt 2 -> ~5 min, attempt 3 -> ~15 min, attempt 4 -> ~30 min. Attempt 5 (MAX_SEND_ATTEMPTS)
 * is always terminal (FAILED) regardless of this array, matching the existing bound-exhaustion rule
 * in OperatorReplyOutboundService.recordFailure(). */
export const SMTP_RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000];

/** A TEMPORARY, non-SMTP defer (pinned mailbox currently unusable, no current recipient
 * pre-attempt) never consumes an attempt and is not subject to the escalating backoff above — but
 * it still needs a modest future retry time so the scheduler does not re-evaluate it every single
 * 15s tick while the underlying condition persists. */
export const DEFER_RETRY_DELAY_MS = 60_000;
