import { Injectable } from '@nestjs/common';
import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  PermissionDeniedError,
  RateLimitError,
} from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { rawClassificationOutputSchema } from './ai-classification-schema';
import { rawDraftOutputSchema } from './ai-draft-schema';
import { buildClassificationPrompt, CLASSIFIER_SYSTEM_INSTRUCTIONS } from './ai-prompt';
import { buildDraftPrompt, DRAFTER_SYSTEM_INSTRUCTIONS } from './ai-draft-prompt';
import { AI_DRAFT_MAX_OUTPUT_TOKENS, AI_MAX_OUTPUT_TOKENS, AI_PROVIDER_TIMEOUT_MS } from './ai-timing.constants';
import { AiSettingsResolverService } from './ai-settings-resolver.service';
import { LlmMalformedOutputError, LlmPermanentError, LlmTransientError } from './llm-errors';
import type { ClassificationInput, DraftReplyInput, LlmGateway, NormalizedClassificationResult, NormalizedDraftResult } from './llm-gateway';
import { DRAFT_RESULT_SCHEMA_VERSION, RESULT_SCHEMA_VERSION } from './llm-gateway';

interface OpenAiClientOptions {
  apiKey: string;
  timeout: number;
  maxRetries: number;
}

/**
 * Hardening-pass §11 — the ONLY shape a provider failure may cross the gateway boundary in. Never
 * the raw SDK error object (which may carry request/response headers, the JSON error body, or an
 * echo of what we sent) — only an HTTP status code and OpenAI's own opaque request ID, both safe,
 * non-sensitive, standard-to-log fields. Node's default `console.error`/`util.inspect` on an Error
 * automatically walks a `.cause` chain, so retaining the raw SDK error as `cause` anywhere in the
 * BullMQ/Nest logging path would silently reintroduce the same leak this type prevents.
 */
interface SafeProviderErrorContext {
  providerStatus?: number;
  providerRequestId?: string;
}

/**
 * Slice D §4 — the documented direct-provider choice: `05_AI_LLM_MCP_STRATEGY.md` names "OpenAI
 * Responses API" explicitly (§"Provider abstraction", §"Current OpenAI direction") as the initial
 * real-provider implementation. Uses `responses.parse()` with the SDK's Structured Outputs support
 * (`text.format` via `zodTextFormat`) so the provider is asked for an actual strict JSON Schema
 * (additional properties forbidden) — but this NEVER replaces our own validation boundary: the
 * already-parsed `output_parsed` is independently re-validated against the exact same Zod schema
 * before anything leaves this class (§6).
 *
 * `maxRetries: 0` on the client is deliberate: retry policy is owned entirely by the BullMQ
 * worker/queue layer (§12/hardening-pass §3/§12), never duplicated inside the SDK's own retry
 * logic — one BullMQ attempt performs at most one OpenAI HTTP request.
 */
@Injectable()
export class OpenAiLlmGateway implements LlmGateway {
  /** Test seam only — mirrors SmtpMailTransport.transportFactory / ImapMailboxReader.clientFactory.
   * Defaults to the real OpenAI client constructor in production. */
  clientFactory: (options: OpenAiClientOptions) => OpenAI = (options) => new OpenAI(options);

  // Phase 3.1 §J — deliberately NEVER cached across calls (unlike the pre-Phase-3.1 version of this
  // class): the API key/model now come from the admin-managed AiSettings row, which can change at
  // runtime with no restart. A stale cached client would keep using a revoked/replaced key or the
  // wrong model until the process happened to restart, silently defeating that requirement. The SDK
  // client constructor performs no network I/O, so reconstructing it per call costs nothing
  // meaningful given classification/draft volume.
  constructor(private readonly aiSettings: AiSettingsResolverService) {}

  async classifyIntent(input: ClassificationInput): Promise<NormalizedClassificationResult> {
    const { client, model } = await this.ensureClient();

    let response: Awaited<ReturnType<OpenAI['responses']['parse']>>;
    try {
      response = await client.responses.parse({
        model,
        instructions: CLASSIFIER_SYSTEM_INSTRUCTIONS,
        input: buildClassificationPrompt(input),
        text: { format: zodTextFormat(rawClassificationOutputSchema, 'intent_classification') },
        // §9 — no tools available to the classifier: no web/file search, no functions, no MCP.
        tools: [],
        // §5 — classification is stateless; we already supply the bounded context ourselves, so the
        // provider must never retain this request server-side.
        store: false,
        // §8 — the normalized result is tiny; bound the generation explicitly rather than trusting
        // an unbounded default.
        max_output_tokens: AI_MAX_OUTPUT_TOKENS,
      });
    } catch (error) {
      throw toLlmError(error);
    }

    // §7 — refusal/incomplete/null-parse are message-level classification failures, never proof the
    // whole provider is unavailable, and never automatically business-actioned.
    if (response.status === 'incomplete') {
      throw new LlmMalformedOutputError(
        `Provider response was incomplete (${response.incomplete_details?.reason ?? 'unknown reason'}).`,
      );
    }
    if (containsRefusal(response.output)) {
      throw new LlmMalformedOutputError('Provider refused to produce a classification.');
    }
    if (response.output_parsed == null) {
      throw new LlmMalformedOutputError('Provider response did not include a parsed structured output.');
    }

    // §6 — provider-side strict structured-output enforcement never replaces our own validation
    // boundary: re-validate the already-parsed object against the exact same Zod schema.
    const validated = rawClassificationOutputSchema.safeParse(response.output_parsed);
    if (!validated.success) {
      throw new LlmMalformedOutputError('Provider output failed strict schema validation.');
    }

    return { schemaVersion: RESULT_SCHEMA_VERSION, ...validated.data };
  }

  /**
   * Slice F — an entirely independent second operation on the same gateway. Reuses `ensureClient()`
   * (same lazy, per-call credential/model resolution from AiSettingsResolverService) and the
   * identical `toLlmError`/refusal/incomplete/re-validation discipline as classifyIntent above, but
   * never shares its prompt, schema, or output with it. Adding this method does not modify
   * classifyIntent's code or behavior at all.
   */
  async draftReply(input: DraftReplyInput): Promise<NormalizedDraftResult> {
    const { client, model } = await this.ensureClient();

    let response: Awaited<ReturnType<OpenAI['responses']['parse']>>;
    try {
      response = await client.responses.parse({
        model,
        instructions: DRAFTER_SYSTEM_INSTRUCTIONS,
        input: buildDraftPrompt(input),
        text: { format: zodTextFormat(rawDraftOutputSchema, 'suggested_reply_draft') },
        // §13 — no tools available to the drafter: no web/file search, no functions, no MCP.
        tools: [],
        // §13 — drafting is stateless; the provider must never retain this request server-side.
        store: false,
        // §12 — the normalized result is a short reply body; bound the generation explicitly.
        max_output_tokens: AI_DRAFT_MAX_OUTPUT_TOKENS,
      });
    } catch (error) {
      throw toLlmError(error);
    }

    if (response.status === 'incomplete') {
      throw new LlmMalformedOutputError(
        `Provider response was incomplete (${response.incomplete_details?.reason ?? 'unknown reason'}).`,
      );
    }
    if (containsRefusal(response.output)) {
      throw new LlmMalformedOutputError('Provider refused to produce a suggested reply.');
    }
    if (response.output_parsed == null) {
      throw new LlmMalformedOutputError('Provider response did not include a parsed structured output.');
    }

    const validated = rawDraftOutputSchema.safeParse(response.output_parsed);
    if (!validated.success) {
      throw new LlmMalformedOutputError('Provider output failed strict schema validation.');
    }

    return { schemaVersion: DRAFT_RESULT_SCHEMA_VERSION, ...validated.data };
  }

  /** Credential/model resolution is lazy AND dynamic — read fresh from AiSettingsResolverService on
   * every call, never cached (see the constructor's doc comment for why). Never reached at all in
   * mock mode (MockLlmGateway is wired instead — see llm-provider.module.ts) and never merely
   * because this class was constructed/injected. */
  private async ensureClient(): Promise<{ client: OpenAI; model: string }> {
    const settings = await this.aiSettings.getSettings();
    if (!settings.model) {
      throw new LlmPermanentError('AI model is not configured.');
    }
    const apiKey = await this.aiSettings.getApiKey();
    if (!apiKey) {
      throw new LlmPermanentError('AI API key is not configured.');
    }
    const client = this.clientFactory({ apiKey, timeout: AI_PROVIDER_TIMEOUT_MS, maxRetries: 0 });
    return { client, model: settings.model };
  }
}

/** Scans a Responses API `output` array for any assistant message content part the model marked as
 * a refusal. Deliberately loosely/defensively typed (never trusts the shape) and never returns the
 * refusal text itself — it may echo back fragments of the untrusted email — only whether one was
 * present. */
function containsRefusal(output: unknown): boolean {
  if (!Array.isArray(output)) return false;
  return output.some((item) => {
    if (typeof item !== 'object' || item === null) return false;
    const message = item as { type?: unknown; content?: unknown };
    if (message.type !== 'message' || !Array.isArray(message.content)) return false;
    return message.content.some(
      (part) => typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'refusal',
    );
  });
}

/** Never includes the raw error's message/body/headers in the resulting Error's own `.message`, and
 * never retains the raw SDK error object at all (see SafeProviderErrorContext's doc comment) — only
 * a fixed, safe description plus (for an APIError) the HTTP status and OpenAI's own request ID. */
function toLlmError(error: unknown): Error {
  const context: SafeProviderErrorContext | undefined =
    error instanceof APIError
      ? {
          providerStatus: typeof error.status === 'number' ? error.status : undefined,
          providerRequestId: typeof error.requestID === 'string' ? error.requestID : undefined,
        }
      : undefined;
  if (error instanceof RateLimitError) return new LlmTransientError('Provider rate limit exceeded.', { cause: context });
  if (error instanceof InternalServerError) return new LlmTransientError('Provider internal server error.', { cause: context });
  if (error instanceof APIConnectionTimeoutError) return new LlmTransientError('Provider request timed out.', { cause: context });
  if (error instanceof APIConnectionError) return new LlmTransientError('Provider connection error.', { cause: context });
  if (error instanceof AuthenticationError) return new LlmPermanentError('Provider authentication failed.', { cause: context });
  if (error instanceof PermissionDeniedError) return new LlmPermanentError('Provider permission denied.', { cause: context });
  if (error instanceof BadRequestError) return new LlmPermanentError('Provider rejected the request as malformed.', { cause: context });
  if (error instanceof APIError) {
    return new LlmTransientError(`Unrecognized provider API error (status ${String(error.status)}).`, { cause: context });
  }
  return new LlmTransientError('Unknown provider error.');
}
