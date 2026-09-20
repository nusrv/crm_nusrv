import type { AiIntent } from '../../generated/prisma/enums';

/** Slice D — the one frozen prompt-version identifier persisted into AiClassification.promptVersion.
 * Changing prompt/schema meaning requires a NEW version string, never silently redefining this one. */
export const PROMPT_VERSION = 'phase3-intent-v1';

/** The normalized structured-result schema version tag embedded in structuredResultJson — kept as
 * its own constant (distinct from PROMPT_VERSION, though currently equal in value) because a future
 * prompt change might keep the same output shape, or vice versa. */
export const RESULT_SCHEMA_VERSION = 'phase3-intent-v1';

export interface ClassificationContextMessage {
  subject: string;
  bodyText: string;
  direction: 'INBOUND' | 'OUTBOUND';
  occurredAt: Date;
}

export interface ClassificationInput {
  current: {
    subject: string;
    bodyText: string;
    occurredAt: Date;
  };
  /** Bounded, chronologically ordered (oldest first) prior messages in the same thread — see
   * ai-context.util.ts for the exact bounding policy. Never bodyHtml, never attachments. */
  priorMessages: ClassificationContextMessage[];
}

/**
 * The gateway's normalized output contract (§5). Deliberately minimal — no tool calls, no workflow
 * commands, no recommended infrastructure actions, no chain-of-thought. Every field here is either
 * persisted directly (via AiClassification's own columns) or as part of the bounded
 * structuredResultJson blob; nothing else is ever accepted from a provider.
 */
export interface NormalizedClassificationResult {
  schemaVersion: typeof RESULT_SCHEMA_VERSION;
  intent: AiIntent;
  /** 0..1 inclusive. */
  confidence: number;
  requiresHumanReview: boolean;
  summary: string;
  language: string;
}

export const LLM_GATEWAY = Symbol('LLM_GATEWAY');

/** Slice F — the normalized result schema version for suggested-reply drafting, entirely
 * independent of RESULT_SCHEMA_VERSION above (classification's own version tag). Never reused
 * across the two operations, even if the value happened to coincide. */
export const DRAFT_RESULT_SCHEMA_VERSION = 'phase3-draft-v1';

export interface DraftContextMessage {
  subject: string;
  bodyText: string;
  direction: 'INBOUND' | 'OUTBOUND';
  occurredAt: Date;
}

export interface DraftEffectiveClassificationContext {
  source: 'AI' | 'HUMAN_REVIEW';
  intent: string;
  summary: string;
  language: string;
}

export interface DraftCustomerContext {
  customerCode: string;
  nameEn: string | null;
  nameAr: string | null;
  preferredLanguage: string;
}

export interface DraftRenewalContext {
  renewalCaseStatus: string;
  dueDate: Date;
  subscriptionCode: string;
  serviceName: string | null;
}

/**
 * Slice F §9 — the bounded, structured-facts-only input to draftReply(). Never the raw
 * EmailMessage/Customer/RenewalCase rows themselves — only the specific safe fields a
 * suggested-reply prompt needs, already bounded by ai-draft-context.util.ts before this is built.
 */
export interface DraftReplyInput {
  current: {
    subject: string;
    bodyText: string;
    occurredAt: Date;
  };
  /** Bounded, chronologically ordered (oldest first) prior messages in the same thread. */
  priorMessages: DraftContextMessage[];
  /** null when no classification exists yet — the prompt must treat this as genuinely absent,
   * never fabricate one (§8). */
  effectiveClassification: DraftEffectiveClassificationContext | null;
  customer: DraftCustomerContext | null;
  /** null when the thread has no linked RenewalCase. */
  renewal: DraftRenewalContext | null;
}

/**
 * Slice F §12 — the gateway's normalized drafting output. Deliberately minimal: body text plus the
 * language it was written in. No subject (deterministic, never AI-generated — see
 * reply-threading.util.ts's normalizeReplySubject), no confidence, no requiresHumanReview (the
 * operator is always the reviewer for this feature), no recipient, no send flag, no
 * payment/invoice state, no chain-of-thought.
 */
export interface NormalizedDraftResult {
  schemaVersion: typeof DRAFT_RESULT_SCHEMA_VERSION;
  bodyText: string;
  language: string;
}

/**
 * Slice D §5 — one provider-neutral gateway. `classifyIntent` either resolves with a fully
 * validated NormalizedClassificationResult, or rejects with one of the typed errors in
 * llm-errors.ts (LlmTransientError / LlmPermanentError / LlmMalformedOutputError) — a caller never
 * has to inspect a provider-specific error shape to decide what to do next.
 *
 * Slice F — `draftReply` is an entirely independent second operation added additively to this same
 * interface. It shares the gateway's error-typing contract (same three typed errors) but never
 * shares state, prompts, or schemas with classifyIntent — adding it does not change
 * classifyIntent's behavior in any way.
 */
export interface LlmGateway {
  classifyIntent(input: ClassificationInput): Promise<NormalizedClassificationResult>;
  draftReply(input: DraftReplyInput): Promise<NormalizedDraftResult>;
}
