import type { ClassificationContextMessage, ClassificationInput } from './llm-gateway';

/**
 * Slice D §8/§30 — every bound on what gets sent to (or persisted from) an LLM call, centralized
 * in one place. Deliberately conservative: this is a short-reply classifier ("yes", "please do",
 * "I already paid"), not a document-analysis tool — it never needs years of thread history or an
 * entire email body verbatim.
 */
export const MAX_CURRENT_BODY_CHARS = 8_000;
export const MAX_HISTORY_MESSAGES = 4;
export const MAX_HISTORY_BODY_CHARS_EACH = 2_000;
export const MAX_SUBJECT_CHARS = 500; // matches EmailMessage.subject's own VarChar(500) width.
/** Documented ceiling on the combined size of everything sent to the provider — never enforced by
 * redistributing the per-item budgets above, since (MAX_CURRENT_BODY_CHARS + MAX_HISTORY_MESSAGES *
 * MAX_HISTORY_BODY_CHARS_EACH) already stays comfortably under it; kept as an explicit, tested
 * invariant rather than an incidental fact. */
export const MAX_TOTAL_CONTEXT_CHARS = 20_000;

/** Bounds applied to the NORMALIZED RESULT before persistence (§15/§30), independent of the input
 * bounds above. */
export const MAX_AI_SUMMARY_LENGTH = 1_000;
export const MAX_AI_LANGUAGE_LENGTH = 20;

function truncateChars(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  // Codepoint-safe (never splits a surrogate pair) — this text only ever goes into an outbound
  // prompt, never a DB byte-limited column, so character-count truncation is sufficient here.
  const codepoints = Array.from(value);
  return codepoints.length <= maxLength ? value : codepoints.slice(0, maxLength).join('');
}

export interface ClassificationContextSource {
  subject: string;
  bodyText: string;
  occurredAt: Date;
}

/**
 * Builds the bounded classification input from the current inbound message plus up to
 * MAX_HISTORY_MESSAGES immediately preceding messages in the same thread. `priorMessages` must
 * already be supplied in chronological order (oldest first) — see
 * AiClassificationService.loadPriorMessages() for the query that produces that order; this
 * function only truncates, it never re-sorts.
 */
export function buildClassificationInput(
  current: ClassificationContextSource,
  priorMessages: ClassificationContextMessage[],
): ClassificationInput {
  const bounded: ClassificationInput = {
    current: {
      subject: truncateChars(current.subject, MAX_SUBJECT_CHARS),
      bodyText: truncateChars(current.bodyText, MAX_CURRENT_BODY_CHARS),
      occurredAt: current.occurredAt,
    },
    priorMessages: priorMessages.slice(-MAX_HISTORY_MESSAGES).map((message) => ({
      subject: truncateChars(message.subject, MAX_SUBJECT_CHARS),
      bodyText: truncateChars(message.bodyText, MAX_HISTORY_BODY_CHARS_EACH),
      direction: message.direction,
      occurredAt: message.occurredAt,
    })),
  };
  return bounded;
}

/** Total character budget actually used by one built context — a test-facing helper, not used by
 * production code (the per-item bounds above already guarantee the ceiling by construction). */
export function totalContextChars(input: ClassificationInput): number {
  const historyChars = input.priorMessages.reduce(
    (sum, message) => sum + message.subject.length + message.bodyText.length,
    0,
  );
  return input.current.subject.length + input.current.bodyText.length + historyChars;
}
