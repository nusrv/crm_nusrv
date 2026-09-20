/** Slice D §17 — single source of truth for AI audit eventKeys and health message tokens,
 * mirroring mail-imap-events.constants.ts's rationale (eliminate string-drift risk). */
export const AI_AUDIT_EVENT = {
  CLASSIFICATION_CREATED: 'ai.classification.created',
  HUMAN_REVIEW_REQUIRED: 'ai.classification.human_review_required',
  CLASSIFICATION_FAILED: 'ai.classification.failed',
  REVIEW_CREATED: 'ai.classification.review.created',
  // Slice F — generation-only event. Never contains generated bodyText, customer bodyText, the
  // prompt, or the raw provider response (see AiReplyDraftService's own doc comment).
  REPLY_DRAFT_GENERATED: 'ai.reply_draft.generated',
} as const;
