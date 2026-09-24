import { LlmPermanentError, LlmTransientError } from './llm-errors';

/**
 * Shared by every native-`fetch`-based provider adapter (Anthropic, Google Gemini) — classifies a
 * failed HTTP call into the same three-way LlmTransientError/LlmPermanentError contract every
 * LlmGateway/LlmProviderAdapter implementation must produce (see llm-errors.ts), mirroring
 * OpenAiProviderAdapter's own toLlmError() discipline for the SDK-based adapter. The response body
 * is deliberately NEVER read on an error path — only the HTTP status code ever informs the thrown
 * error, so a provider error body (which could echo request content, an API key fragment, or other
 * sensitive metadata) never crosses this boundary.
 */
export function toHttpLlmError(status: number): Error {
  const context = { providerStatus: status };
  if (status === 401 || status === 403) {
    return new LlmPermanentError('Provider authentication failed.', { cause: context });
  }
  if (status === 400 || status === 404 || status === 422) {
    return new LlmPermanentError('Provider rejected the request as malformed.', { cause: context });
  }
  if (status === 429) {
    return new LlmTransientError('Provider rate limit exceeded.', { cause: context });
  }
  if (status >= 500) {
    return new LlmTransientError('Provider internal server error.', { cause: context });
  }
  return new LlmTransientError(`Unrecognized provider API error (status ${status}).`, { cause: context });
}

/** Never a raw fetch/DOMException error (may carry request metadata) — only a fixed, safe
 * description distinguishing a timeout from a generic connection failure. */
export function toNetworkLlmError(error: unknown): Error {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return new LlmTransientError('Provider request timed out.');
  }
  return new LlmTransientError('Provider connection error.');
}
