import { Injectable } from '@nestjs/common';
import { rawClassificationOutputSchema } from './ai-classification-schema';
import { rawDraftOutputSchema } from './ai-draft-schema';
import { buildDraftPrompt, DRAFTER_SYSTEM_INSTRUCTIONS } from './ai-draft-prompt';
import { buildClassificationPrompt, CLASSIFIER_SYSTEM_INSTRUCTIONS } from './ai-prompt';
import { AI_PROVIDER_TIMEOUT_MS } from './ai-timing.constants';
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

/**
 * Gemini-specific token budgets — deliberately provider-LOCAL, never applied to
 * OpenAI/Anthropic. Per Google's own documented `generateContent`/thinking behavior,
 * `generationConfig.maxOutputTokens` bounds thinking tokens AND the final visible answer
 * COMBINED for "thinking"-capable Gemini models (the 2.5 and 3 model families, which think by
 * default with a dynamic/auto budget unless explicitly configured otherwise) — unlike OpenAI's
 * Responses API (which reports a `status: 'incomplete'`/`incomplete_details` we already detect
 * separately) and Anthropic's Messages API (where thinking is opt-in via a `thinking` parameter
 * this adapter never sends, so `max_tokens` here bounds only the visible answer). A budget sized
 * only for the visible answer risks the model spending its entire allowance thinking and
 * returning `finishReason: 'MAX_TOKENS'` with NO visible text at all — the exact live production
 * failure this correction fixes ("Provider response did not include any text content" for
 * `gemini-flash-latest` even on a trivial "reply with OK" connectivity test with the previous
 * 16-token budget).
 *
 * These remain explicit, bounded, finite values — never unbounded — just sized generously enough
 * to give thinking genuine headroom without inflating the shared cross-provider
 * AI_MAX_OUTPUT_TOKENS/AI_DRAFT_MAX_OUTPUT_TOKENS constants, which have no equivalent behavior to
 * accommodate. Deliberately NOT implemented via `generationConfig.thinkingConfig`: the field that
 * actually controls/disables thinking differs by Gemini model generation (`thinkingBudget` for
 * pre-3 models vs. `thinkingLevel` for Gemini 3, and sending both to a Gemini 3 model is a
 * documented error) — reliably picking the right one would require exactly the brittle
 * model-name-family branching this correction is explicitly told to avoid unless the API leaves no
 * cleaner option. Budgeting generously for whatever the model decides to think, and robustly
 * extracting only the visible answer afterward, works uniformly across every model generation with
 * no such branching.
 */
const GEMINI_TEST_CONNECTION_MAX_OUTPUT_TOKENS = 1024;
const GEMINI_CLASSIFICATION_MAX_OUTPUT_TOKENS = 4096;
const GEMINI_DRAFT_MAX_OUTPUT_TOKENS = 5120;

/** A single part of a candidate's content. `thought: true` marks a thinking/reasoning part (only
 * ever present if a caller opted into `includeThoughts` — this adapter never does, and never will,
 * per §"never persist/expose chain-of-thought" — but the extractor below defends against it
 * regardless, in case a future Gemini model generation includes it by default). */
interface GeminiPart {
  text?: string;
  thought?: boolean;
}

interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
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
    const text = await this.request(
      config,
      CLASSIFIER_SYSTEM_INSTRUCTIONS,
      buildClassificationPrompt(input),
      GEMINI_CLASSIFICATION_MAX_OUTPUT_TOKENS,
      true,
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
      DRAFTER_SYSTEM_INSTRUCTIONS,
      buildDraftPrompt(input),
      GEMINI_DRAFT_MAX_OUTPUT_TOKENS,
      true,
    );
    const parsed = safeExtractJson(text);
    const validated = rawDraftOutputSchema.safeParse(parsed);
    if (!validated.success) {
      throw new LlmMalformedOutputError('Provider output failed strict schema validation.');
    }
    return { schemaVersion: DRAFT_RESULT_SCHEMA_VERSION, ...validated.data };
  }

  /** §K correction, hardened by the thinking-budget fix — one minimal, harmless round trip; never
   * classifies, never drafts. Plain-text reply, deliberately without the JSON response-format
   * constraint (there is nothing to validate). Uses GEMINI_TEST_CONNECTION_MAX_OUTPUT_TOKENS
   * (never the old, unsafe 16-token budget a thinking-capable model can fully consume before
   * emitting any visible answer) — success genuinely requires visible response text; a
   * thought-only or budget-exhausted response is never treated as success (see `request()`). */
  async testConnection(config: LlmProviderAdapterConfig): Promise<{ latencyMs: number }> {
    const startedAt = Date.now();
    await this.request(
      config,
      'You are a connectivity test endpoint. Reply with the single word OK and nothing else.',
      'connection test',
      GEMINI_TEST_CONNECTION_MAX_OUTPUT_TOKENS,
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

    // Correction — a candidate's parts may include one or more `thought: true` reasoning parts
    // (never requested by this adapter, but defended against regardless) interspersed with the
    // actual visible answer; the previous `parts?.[0]?.text` assumption broke as soon as thinking
    // consumed any part of the budget. `extractVisibleText` inspects every part, uses only the
    // non-thought text, and never lets thought content reach the caller (never persisted, logged,
    // used as classification JSON, or used as suggested-reply text).
    const text = extractVisibleText(candidate.content?.parts);
    if (!text) {
      // A thinking-capable model can spend its ENTIRE generationConfig.maxOutputTokens budget on
      // internal thinking and stop with finishReason: MAX_TOKENS and no visible text at all — a
      // distinct, diagnosable condition from "the provider simply returned nothing," never
      // collapsed into the same generic message.
      if (candidate.finishReason === 'MAX_TOKENS') {
        throw new LlmMalformedOutputError('Provider exhausted the generation budget before producing usable output.');
      }
      throw new LlmMalformedOutputError('Provider response did not include any text content.');
    }
    return text;
  }
}

/** Concatenates every VISIBLE (non-thought) text part, in provider order, trimming the result.
 * Returns undefined when there is no usable visible text at all (including when every part present
 * is a thought part) — never falls back to thought content. */
function extractVisibleText(parts: GeminiPart[] | undefined): string | undefined {
  if (!Array.isArray(parts)) return undefined;
  const visible = parts
    .filter((part) => part.thought !== true && typeof part.text === 'string' && part.text.length > 0)
    .map((part) => part.text as string)
    .join('')
    .trim();
  return visible.length > 0 ? visible : undefined;
}

function safeExtractJson(text: string): unknown {
  try {
    return extractJsonObject(text);
  } catch {
    throw new LlmMalformedOutputError('Provider response did not contain a recognizable JSON object.');
  }
}
