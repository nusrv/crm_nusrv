/**
 * Slice C correction pass §12 — single source of truth for every IMAP audit eventKey and health
 * message token this module emits. Centralized purely to eliminate string-drift risk between the
 * emitting code and anything (tests, dashboards, future tooling) that matches on these strings —
 * no behavior depends on this file beyond that.
 */
export const IMAP_AUDIT_EVENT = {
  SYNC_BASELINE_ESTABLISHED: 'mail.imap.sync_baseline_established',
  UIDVALIDITY_CHANGED: 'mail.imap.uidvalidity_changed',
  CURSOR_INCONSISTENT: 'mail.imap.cursor_inconsistent',
  CURSOR_CONFLICT: 'mail.imap.cursor_conflict',
  MESSAGE_INGEST_FAILED: 'mail.imap.message_ingest_failed',
  INBOUND_INGESTED: 'mail.inbound.ingested',
  INBOUND_CORRELATION_AMBIGUOUS: 'mail.inbound.correlation_ambiguous',
} as const;

/** Stable tokens embedded in IntegrationHealthEvent.message — matched exactly by tests and
 * intended to be grep-able in the DB by an operator, so they must never drift silently. */
export const IMAP_HEALTH_MESSAGE = {
  CURSOR_INCONSISTENT_REQUIRES_REVIEW: 'IMAP_CURSOR_INCONSISTENT_REQUIRES_REVIEW',
  UIDVALIDITY_CHANGED_REQUIRES_CURSOR_RESET: 'UIDVALIDITY_CHANGED_REQUIRES_CURSOR_RESET',
} as const;
