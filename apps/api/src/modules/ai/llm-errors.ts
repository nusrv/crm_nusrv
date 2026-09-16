/**
 * Slice D §12 — the three outcomes any LlmGateway implementation must classify a failure into.
 * AiClassificationService (the orchestrator) never inspects a provider-specific error shape
 * directly — every gateway implementation (mock or real) is responsible for converting its own
 * failure modes into exactly one of these before it ever leaves classifyIntent().
 */

/** Transient provider/infrastructure error — timeout, temporary network failure, rate-limit,
 * temporary service unavailable. Bounded queue retry; EmailMessage stays PENDING until the retry
 * budget is exhausted. */
export class LlmTransientError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LlmTransientError';
  }
}

/** Permanent provider/config/auth failure — invalid API key, forbidden model, malformed request
 * the provider itself rejected as a client error. No pointless repeated retry; ends the message in
 * HUMAN_REVIEW immediately. */
export class LlmPermanentError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LlmPermanentError';
  }
}

/** The provider responded (no transport/auth failure), but its structured output failed strict
 * schema validation — unknown intent string, out-of-range confidence, wrong types, or genuinely
 * malformed JSON. Never trusted; ends the message in HUMAN_REVIEW immediately, never retried
 * (retrying an already-malformed prompt/response pairing is not expected to self-correct). */
export class LlmMalformedOutputError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LlmMalformedOutputError';
  }
}
