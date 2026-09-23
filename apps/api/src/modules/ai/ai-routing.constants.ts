/**
 * Slice G §3/§H — the frozen version tag stamped onto every AiRoutingDecision created going
 * forward. Evidence/reproducibility metadata ONLY — never part of the uniqueness/correctness
 * boundary (that is AiRoutingDecision.aiClassificationId's own @unique constraint). Bumping this
 * constant in a future change must NEVER re-evaluate or re-create a decision for an
 * AiClassification that already has one; it only labels which rule-set produced NEW decisions from
 * that point on. See the model-level comment on AiRoutingDecision in schema.prisma.
 */
export const AI_ROUTING_VERSION = 'phase3-routing-v1';

/**
 * Safe, free-text result codes recorded on AiRoutingDecision.resultCode — never a stack trace,
 * never raw error text (§19). Centralized here so the worker/tests never drift on the exact string.
 */
export const AI_ROUTING_RESULT_CODE = {
  /** §7 — the classifier itself already required human review; no worker execution needed. */
  CLASSIFIER_REQUIRED_HUMAN_REVIEW: 'CLASSIFIER_REQUIRED_HUMAN_REVIEW',
  /** §13 — the one real automatic business mutation succeeded. */
  AUTO_ACCEPTED: 'AUTO_ACCEPTED',
  /** §15 — EmailMessage/CommunicationThread were successfully routed to HUMAN_REVIEW. */
  ROUTED_TO_HUMAN_REVIEW: 'ROUTED_TO_HUMAN_REVIEW',
  /** §14 — the RenewalCase had already independently reached ACCEPTED; never overwritten, never
   * claimed as this decision's own doing. */
  SKIPPED_ALREADY_ACCEPTED: 'SKIPPED_ALREADY_ACCEPTED',
  /** §10/§15 — a human ClassificationReview already won the shared EmailMessage row before this
   * decision could execute. */
  SKIPPED_HUMAN_ALREADY_REVIEWED: 'SKIPPED_HUMAN_ALREADY_REVIEWED',
  /** §14 — the RenewalCase moved to an incompatible/terminal state (never DO_NOT_RENEW/REJECTED/
   * CLOSED/FULFILLED/etc. overridden); the message is separately routed to HUMAN_REVIEW. */
  SKIPPED_CONCURRENT_BUSINESS_DECISION: 'SKIPPED_CONCURRENT_BUSINESS_DECISION',
  /** §H/§9 — a newer AiClassification exists for the same EmailMessage; this (stale) one never
   * routes. */
  SKIPPED_CLASSIFICATION_SUPERSEDED: 'SKIPPED_CLASSIFICATION_SUPERSEDED',
  /** Defensive — the linked RenewalCase no longer exists at execution time. */
  SKIPPED_NO_RENEWAL_CASE: 'SKIPPED_NO_RENEWAL_CASE',
  /** An execution-time defensive check failed for a field that is, by construction, immutable on
   * AiClassification (requiresHumanReview/confidence/intent/direction) — never expected to actually
   * occur; recorded as FAILED (an application invariant violation), never silently retried. */
  INVARIANT_VIOLATION: 'INVARIANT_VIOLATION',
} as const;

export type AiRoutingResultCode = (typeof AI_ROUTING_RESULT_CODE)[keyof typeof AI_ROUTING_RESULT_CODE];

/** Slice G §18 — centralized AI routing audit event keys, mirroring ai-events.constants.ts's own
 * rationale (eliminate string-drift risk). */
export const AI_ROUTING_AUDIT_EVENT = {
  AUTO_ACCEPTED: 'ai.routing.auto_accepted',
  HUMAN_REVIEW_ROUTED: 'ai.routing.human_review_routed',
} as const;

/** §9 — stale-PROCESSING reclaim threshold. Routing is DB-only work (no external network call, no
 * SMTP timeout budget to accommodate) — a short, dedicated threshold, deliberately not reusing
 * Mail's SMTP-tuned STALE_PROCESSING_LEASE_MS (10 minutes), which is sized around an entirely
 * different external-call timeout budget that does not apply here. */
export const AI_ROUTING_STALE_PROCESSING_LEASE_MS = 2 * 60 * 1000; // 2 minutes.

/** §20 — bounded recovery-scan batch size, mirroring AI_RECOVERY_SCAN_BATCH_SIZE's own rationale
 * (never an unbounded table scan). */
export const AI_ROUTING_RECOVERY_SCAN_BATCH_SIZE = 100;

/** §20 — periodic recovery-scan interval. Routing decisions are expected to resolve quickly (DB-only
 * work, no external call), so a shorter cadence than AI_RECOVERY_SCAN_INTERVAL_MS (5 minutes) is
 * appropriate — a lost Redis enqueue or a stale lease should not sit unprocessed for long. */
export const AI_ROUTING_RECOVERY_SCAN_INTERVAL_MS = 60 * 1000; // 1 minute.
