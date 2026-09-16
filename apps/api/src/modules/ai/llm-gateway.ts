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

/**
 * Slice D §5 — one provider-neutral gateway. `classifyIntent` either resolves with a fully
 * validated NormalizedClassificationResult, or rejects with one of the typed errors in
 * llm-errors.ts (LlmTransientError / LlmPermanentError / LlmMalformedOutputError) — a caller never
 * has to inspect a provider-specific error shape to decide what to do next.
 */
export interface LlmGateway {
  classifyIntent(input: ClassificationInput): Promise<NormalizedClassificationResult>;
}
