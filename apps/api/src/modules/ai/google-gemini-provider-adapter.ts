import { Injectable } from '@nestjs/common';
import { rawClassificationOutputSchema } from './ai-classification-schema';
import { rawDraftOutputSchema } from './ai-draft-schema';
import { buildDraftPrompt, DRAFTER_SYSTEM_INSTRUCTIONS } from './ai-draft-prompt';
import { buildClassificationPrompt, CLASSIFIER_SYSTEM_INSTRUCTIONS } from './ai-prompt';
import { AI_DRAFT_MAX_OUTPUT_TOKENS, AI_MAX_OUTPUT_TOKENS, AI_PROVIDER_TIMEOUT_MS } from './ai-timing.constants';
import { extractJsonObject } from './llm-json-output.util';
import { toHttpLlmError, toNetworkLlmError } from './llm-http-error.util';
import { LlmMalformedOutputError } from './llm-errors';
import type { ClassificationInput, DraftReplyInput, NormalizedClassificationResult, NormalizedDraftResult } from './llm-gateway';
import { DRAFT_RESULT_SCHEMA_VERSION, RESULT_SCHEMA_VERSION } from './llm-gateway';
import type { DiscoveredAiModel, LlmProviderAdapter, LlmProviderAdapterConfig } from './llm-provider-adapter';
import { AI_MODEL_DISCOVERY_HARD_CAP } from './ai-model-discovery.constants';

const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODELS_PAGE_SIZE = 1000;
/** Defense-in-depth against a provider that never stops returning a `nextPageToken` — bounds the
 * number of HTTP requests a single listModels() call can make, independently of
 * AI_MODEL_DISCOVERY_HARD_CAP (which bounds the number of MODELS, not requests). */
const GEMINI_MODELS_MAX_PAGES = 10;

interface GeminiCandidate {
  content?: { parts?: Array<{ text?: string }> };
  finishReason?: string;
}

interface GeminiGenerateContentResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
}

interface GeminiModel {
  name: string;
  displayName?: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods?: string[];
}

interface GeminiModelsListResponse {
  models?: GeminiModel[];
  nextPageToken?: string;
}

/**
 * Provider-neutral correction §F — a real Google Gemini adapter using the plain `generateContent`
 * REST API (native `fetch`, no SDK — same rationale as the Anthropic adapter). Deliberately
 * stateless/credential-free (see LlmProviderAdapter's own doc comment).
 *
 * No tools, no web search/grounding, no function/business-action calling. Where the provider
 * supports a real JSON response-format constraint (`generationConfig.responseMimeType:
 * "application/json"`), classifyIntent/draftReply use it — but regardless of that provider-side
 * enforcement, the extracted text is ALWAYS independently re-validated against the exact same Zod
 * schema every other provider's output must pass (rawClassificationOutputSchema /
 * rawDraftOutputSchema), identically to the OpenAI/Anthropic adapters. No provider-specific object
 * ever escapes this class.
 */
@Injectable()
export class GoogleGeminiProviderAdapter implements LlmProviderAdapter {
  /** Test seam only — mirrors the other adapters' clientFactory/fetchImpl seams. Defaults to the
   * real global fetch in production. */
  fetchImpl: typeof fetch = (input, init) => fetch(input, init);

  async classifyIntent(input: ClassificationInput, config: LlmProviderAdapterConfig): Promise<NormalizedClassificationResult> {
    const text = await this.request(config, CLASSIFIER_SYSTEM_INSTRUCTIONS, buildClassificationPrompt(input), AI_MAX_OUTPUT_TOKENS, true);
    const parsed = safeExtractJson(text);
    const validated = rawClassificationOutputSchema.safeParse(parsed);
    if (!validated.success) {
      throw new LlmMalformedOutputError('Provider output failed strict schema validation.');
    }
    return { schemaVersion: RESULT_SCHEMA_VERSION, ...validated.data };
  }

  async draftReply(input: DraftReplyInput, config: LlmProviderAdapterConfig): Promise<NormalizedDraftResult> {
    const text = await this.request(config, DRAFTER_SYSTEM_INSTRUCTIONS, buildDraftPrompt(input), AI_DRAFT_MAX_OUTPUT_TOKENS, true);
    const parsed = safeExtractJson(text);
    const validated = rawDraftOutputSchema.safeParse(parsed);
    if (!validated.success) {
      throw new LlmMalformedOutputError('Provider output failed strict schema validation.');
    }
    return { schemaVersion: DRAFT_RESULT_SCHEMA_VERSION, ...validated.data };
  }

  /** §K correction — one minimal, harmless round trip; never classifies, never drafts. Plain-text
   * reply, deliberately without the JSON response-format constraint (there is nothing to validate). */
  async testConnection(config: LlmProviderAdapterConfig): Promise<{ latencyMs: number }> {
    const startedAt = Date.now();
    await this.request(
      config,
      'You are a connectivity test endpoint. Reply with the single word OK and nothing else.',
      'connection test',
      16,
      false,
    );
    return { latencyMs: Date.now() - startedAt };
  }

  /**
   * Dynamic model discovery — uses Google's official `models.list` endpoint, which requires only the
   * API key, never a model ID. Paginates via the documented `pageToken`/`nextPageToken` cursor
   * contract, bounded both by AI_MODEL_DISCOVERY_HARD_CAP (total models) and
   * GEMINI_MODELS_MAX_PAGES (total requests). Only models whose `supportedGenerationMethods`
   * explicitly includes `generateContent` — the exact call this adapter's classifyIntent/draftReply/
   * testConnection make — are returned as `'COMPATIBLE'`; a model missing that metadata entirely is
   * still included as `'UNKNOWN'` rather than guessed at, but a model whose metadata explicitly lists
   * OTHER methods and NOT `generateContent` (e.g. an embeddings-only model) is excluded entirely, per
   * the explicit instruction not to present embeddings/TTS/image-only models as normal generation
   * choices when the provider's own metadata makes that safely determinable.
   *
   * The stored `id` strips the API's `models/` name prefix so it matches exactly what
   * `request()` above concatenates back onto `GEMINI_API_BASE_URL`.
   */
  async listModels(apiKey: string): Promise<DiscoveredAiModel[]> {
    const models: DiscoveredAiModel[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < GEMINI_MODELS_MAX_PAGES; page += 1) {
      const url = new URL(GEMINI_API_BASE_URL);
      url.searchParams.set('pageSize', String(GEMINI_MODELS_PAGE_SIZE));
      url.searchParams.set('key', apiKey);
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      let response: Response;
      try {
        response = await this.fetchImpl(url.toString(), {
          method: 'GET',
          signal: AbortSignal.timeout(AI_PROVIDER_TIMEOUT_MS),
        });
      } catch (error) {
        throw toNetworkLlmError(error);
      }
      if (!response.ok) {
        throw toHttpLlmError(response.status);
      }
      let data: GeminiModelsListResponse;
      try {
        data = (await response.json()) as GeminiModelsListResponse;
      } catch {
        throw new LlmMalformedOutputError('Provider response was not valid JSON.');
      }

      for (const model of data.models ?? []) {
        const methods = model.supportedGenerationMethods;
        // Explicit metadata present and generateContent NOT listed -> a known-incompatible model
        // (embeddings/TTS/image-only/etc.) — excluded entirely, never shown as a normal choice.
        if (Array.isArray(methods) && !methods.includes('generateContent')) continue;
        models.push({
          id: model.name.replace(/^models\//, ''),
          displayName: model.displayName ?? model.name,
          provider: 'GOOGLE_GEMINI',
          compatibility: Array.isArray(methods) && methods.includes('generateContent') ? 'COMPATIBLE' : 'UNKNOWN',
          metadata: {
            description: model.description,
            inputTokenLimit: model.inputTokenLimit,
            outputTokenLimit: model.outputTokenLimit,
          },
        });
        if (models.length >= AI_MODEL_DISCOVERY_HARD_CAP) return models;
      }

      if (!data.nextPageToken || data.nextPageToken === pageToken) break;
      pageToken = data.nextPageToken;
    }
    return models;
  }

  /** One request/response round trip, shared by all three operations above. Never retries itself
   * (bounded retry is owned by the BullMQ worker/queue layer) and never reads/logs the raw response
   * body on an HTTP error — only the status code ever informs the thrown error. The API key travels
   * only as the documented `key` query parameter Google's own API requires; it is never logged. */
  private async request(
    config: LlmProviderAdapterConfig,
    systemInstruction: string,
    userMessage: string,
    maxOutputTokens: number,
    jsonResponseFormat: boolean,
  ): Promise<string> {
    const url = `${GEMINI_API_BASE_URL}/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: userMessage }] }],
          systemInstruction: { parts: [{ text: systemInstruction }] },
          generationConfig: {
            maxOutputTokens,
            ...(jsonResponseFormat ? { responseMimeType: 'application/json' } : {}),
          },
        }),
        signal: AbortSignal.timeout(AI_PROVIDER_TIMEOUT_MS),
      });
    } catch (error) {
      throw toNetworkLlmError(error);
    }

    if (!response.ok) {
      throw toHttpLlmError(response.status);
    }

    let data: GeminiGenerateContentResponse;
    try {
      data = (await response.json()) as GeminiGenerateContentResponse;
    } catch {
      throw new LlmMalformedOutputError('Provider response was not valid JSON.');
    }

    if (data.promptFeedback?.blockReason) {
      throw new LlmMalformedOutputError('Provider blocked the request and returned no content.');
    }

    const candidate = data.candidates?.[0];
    if (!candidate) {
      throw new LlmMalformedOutputError('Provider response did not include any candidates.');
    }
    if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'RECITATION' || candidate.finishReason === 'PROHIBITED_CONTENT') {
      throw new LlmMalformedOutputError(`Provider declined to complete the request (${candidate.finishReason}).`);
    }

    const text = candidate.content?.parts?.[0]?.text;
    if (typeof text !== 'string' || text.trim() === '') {
      throw new LlmMalformedOutputError('Provider response did not include any text content.');
    }
    return text;
  }
}

function safeExtractJson(text: string): unknown {
  try {
    return extractJsonObject(text);
  } catch {
    throw new LlmMalformedOutputError('Provider response did not contain a recognizable JSON object.');
  }
}
