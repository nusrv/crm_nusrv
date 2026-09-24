import { Injectable } from '@nestjs/common';
import { rawClassificationOutputSchema } from './ai-classification-schema';
import { rawDraftOutputSchema } from './ai-draft-schema';
import { buildDraftPrompt, DRAFTER_SYSTEM_INSTRUCTIONS } from './ai-draft-prompt';
import { buildClassificationPrompt, CLASSIFIER_SYSTEM_INSTRUCTIONS } from './ai-prompt';
import { AI_DRAFT_MAX_OUTPUT_TOKENS, AI_MAX_OUTPUT_TOKENS, AI_PROVIDER_TIMEOUT_MS } from './ai-timing.constants';
import { CLASSIFICATION_JSON_CONTRACT_INSTRUCTIONS, DRAFT_JSON_CONTRACT_INSTRUCTIONS, extractJsonObject } from './llm-json-output.util';
import { toHttpLlmError, toNetworkLlmError } from './llm-http-error.util';
import { LlmMalformedOutputError } from './llm-errors';
import type { ClassificationInput, DraftReplyInput, NormalizedClassificationResult, NormalizedDraftResult } from './llm-gateway';
import { DRAFT_RESULT_SCHEMA_VERSION, RESULT_SCHEMA_VERSION } from './llm-gateway';
import type { DiscoveredAiModel, LlmProviderAdapter, LlmProviderAdapterConfig } from './llm-provider-adapter';
import { AI_MODEL_DISCOVERY_HARD_CAP } from './ai-model-discovery.constants';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models';
const ANTHROPIC_API_VERSION = '2023-06-01';
const ANTHROPIC_MODELS_PAGE_SIZE = 1000;
/** Defense-in-depth against a provider that never advances `last_id` — bounds the number of HTTP
 * requests a single listModels() call can make, independently of AI_MODEL_DISCOVERY_HARD_CAP (which
 * bounds the number of MODELS, not requests). */
const ANTHROPIC_MODELS_MAX_PAGES = 10;

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

interface AnthropicMessagesResponse {
  content?: unknown;
  stop_reason?: string | null;
}

interface AnthropicModel {
  id: string;
  display_name?: string;
  type?: string;
}

interface AnthropicModelsListResponse {
  data?: AnthropicModel[];
  has_more?: boolean;
  last_id?: string | null;
}

/**
 * Provider-neutral correction §E — a real Anthropic (Claude) adapter using the plain Messages API
 * (native `fetch`, no SDK — Node 22 already provides everything needed, per §R's preference to avoid
 * an unnecessary dependency). Deliberately stateless/credential-free (see LlmProviderAdapter's own
 * doc comment) — every call is handed a fully resolved model/API key by its caller.
 *
 * No tools, no web search, no MCP, no function/business-action calling — plain single-turn text
 * requests only. Unlike OpenAI's Responses API, Anthropic's Messages API has no provider-side strict
 * JSON Schema constraint this codebase uses, so the model is asked in plain language (see
 * llm-json-output.util.ts's *_JSON_CONTRACT_INSTRUCTIONS) to emit ONLY a raw JSON object — but that
 * instruction is never trusted on its own: the extracted JSON is independently re-validated against
 * the exact same Zod schema every provider's output must pass (rawClassificationOutputSchema /
 * rawDraftOutputSchema), identically to the OpenAI adapter. A response that isn't valid JSON matching
 * that schema — including a plain-text refusal, which will simply fail JSON extraction — is always a
 * LlmMalformedOutputError, never trusted, never automatically business-actioned.
 */
@Injectable()
export class AnthropicProviderAdapter implements LlmProviderAdapter {
  /** Test seam only — mirrors OpenAiProviderAdapter.clientFactory / SmtpMailTransport.transportFactory.
   * Defaults to the real global fetch in production. */
  fetchImpl: typeof fetch = (input, init) => fetch(input, init);

  async classifyIntent(input: ClassificationInput, config: LlmProviderAdapterConfig): Promise<NormalizedClassificationResult> {
    const text = await this.request(
      config,
      `${CLASSIFIER_SYSTEM_INSTRUCTIONS}\n\n${CLASSIFICATION_JSON_CONTRACT_INSTRUCTIONS}`,
      buildClassificationPrompt(input),
      AI_MAX_OUTPUT_TOKENS,
    );
    const parsed = safeExtractJson(text);
    const validated = rawClassificationOutputSchema.safeParse(parsed);
    if (!validated.success) {
      throw new LlmMalformedOutputError('Provider output failed strict schema validation.');
    }
    return { schemaVersion: RESULT_SCHEMA_VERSION, ...validated.data };
  }

  async draftReply(input: DraftReplyInput, config: LlmProviderAdapterConfig): Promise<NormalizedDraftResult> {
    const text = await this.request(
      config,
      `${DRAFTER_SYSTEM_INSTRUCTIONS}\n\n${DRAFT_JSON_CONTRACT_INSTRUCTIONS}`,
      buildDraftPrompt(input),
      AI_DRAFT_MAX_OUTPUT_TOKENS,
    );
    const parsed = safeExtractJson(text);
    const validated = rawDraftOutputSchema.safeParse(parsed);
    if (!validated.success) {
      throw new LlmMalformedOutputError('Provider output failed strict schema validation.');
    }
    return { schemaVersion: DRAFT_RESULT_SCHEMA_VERSION, ...validated.data };
  }

  /** §K correction — one minimal, harmless round trip; never classifies, never drafts. */
  async testConnection(config: LlmProviderAdapterConfig): Promise<{ latencyMs: number }> {
    const startedAt = Date.now();
    await this.request(
      config,
      'You are a connectivity test endpoint. Reply with the single word OK and nothing else.',
      'connection test',
      16,
    );
    return { latencyMs: Date.now() - startedAt };
  }

  /**
   * Dynamic model discovery — uses Anthropic's official Models List API (`GET /v1/models`), which
   * requires only the API key, never a model ID. Paginates via the documented `after_id`/`has_more`/
   * `last_id` cursor contract, bounded both by AI_MODEL_DISCOVERY_HARD_CAP (total models) and
   * ANTHROPIC_MODELS_MAX_PAGES (total requests, so a provider that never advances `last_id` can never
   * loop forever). This endpoint exclusively lists Claude models usable through the Messages API —
   * the same API this adapter's classifyIntent/draftReply/testConnection already call — so marking
   * every result `compatibility: 'COMPATIBLE'` reflects the endpoint's own documented scope, never a
   * naming-convention guess.
   */
  async listModels(apiKey: string): Promise<DiscoveredAiModel[]> {
    const models: DiscoveredAiModel[] = [];
    let afterId: string | undefined;
    for (let page = 0; page < ANTHROPIC_MODELS_MAX_PAGES; page += 1) {
      const url = new URL(ANTHROPIC_MODELS_URL);
      url.searchParams.set('limit', String(ANTHROPIC_MODELS_PAGE_SIZE));
      if (afterId) url.searchParams.set('after_id', afterId);

      let response: Response;
      try {
        response = await this.fetchImpl(url.toString(), {
          method: 'GET',
          headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_API_VERSION },
          signal: AbortSignal.timeout(AI_PROVIDER_TIMEOUT_MS),
        });
      } catch (error) {
        throw toNetworkLlmError(error);
      }
      if (!response.ok) {
        throw toHttpLlmError(response.status);
      }
      let data: AnthropicModelsListResponse;
      try {
        data = (await response.json()) as AnthropicModelsListResponse;
      } catch {
        throw new LlmMalformedOutputError('Provider response was not valid JSON.');
      }

      for (const model of data.data ?? []) {
        models.push({
          id: model.id,
          displayName: model.display_name ?? model.id,
          provider: 'ANTHROPIC',
          compatibility: 'COMPATIBLE',
        });
        if (models.length >= AI_MODEL_DISCOVERY_HARD_CAP) return models;
      }

      if (!data.has_more || !data.last_id || data.last_id === afterId) break;
      afterId = data.last_id;
    }
    return models;
  }

  /** One request/response round trip, shared by all three operations above. Never retries itself
   * (bounded retry is owned by the BullMQ worker/queue layer, exactly like the OpenAI adapter) and
   * never reads/logs the raw response body on an HTTP error — only the status code ever informs the
   * thrown error, so a provider error body (which could echo request content or carry sensitive
   * metadata) never crosses this boundary. */
  private async request(config: LlmProviderAdapterConfig, system: string, userMessage: string, maxTokens: number): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchImpl(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'x-api-key': config.apiKey,
          'anthropic-version': ANTHROPIC_API_VERSION,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: userMessage }],
        }),
        signal: AbortSignal.timeout(AI_PROVIDER_TIMEOUT_MS),
      });
    } catch (error) {
      throw toNetworkLlmError(error);
    }

    if (!response.ok) {
      throw toHttpLlmError(response.status);
    }

    let data: AnthropicMessagesResponse;
    try {
      data = (await response.json()) as AnthropicMessagesResponse;
    } catch {
      throw new LlmMalformedOutputError('Provider response was not valid JSON.');
    }

    // Some Anthropic API versions surface an explicit refusal stop reason; even when they don't, a
    // plain-text decline will simply fail JSON extraction below and become the same
    // LlmMalformedOutputError — this check is a faster, clearer path for the common case only.
    if (data.stop_reason === 'refusal') {
      throw new LlmMalformedOutputError('Provider refused to produce the requested output.');
    }

    const blocks = Array.isArray(data.content) ? data.content : [];
    const textBlock = blocks.find(
      (block): block is AnthropicTextBlock =>
        typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'text',
    );
    if (!textBlock || typeof textBlock.text !== 'string' || textBlock.text.trim() === '') {
      throw new LlmMalformedOutputError('Provider response did not include any text content.');
    }
    return textBlock.text;
  }
}

function safeExtractJson(text: string): unknown {
  try {
    return extractJsonObject(text);
  } catch {
    throw new LlmMalformedOutputError('Provider response did not contain a recognizable JSON object.');
  }
}
