import type { ClassificationInput, DraftReplyInput, NormalizedClassificationResult, NormalizedDraftResult } from './llm-gateway';

/**
 * Provider-neutral correction — the canonical internal provider IDs, stored verbatim in
 * `AiSettings.provider` (a plain `VARCHAR(50)`, no DB enum/CHECK constraint — see the Phase 3.1
 * migration). Adding a fourth provider later means adding one more ID here plus one more adapter
 * class (see llm-provider-registry.service.ts) — it never requires touching
 * AiClassificationService, AiClassificationWorker, AiRoutingService, AiReplyDraftService,
 * RenewalCase services, or Communication Center, all of which depend only on the common
 * `LlmGateway` abstraction (see llm-gateway.ts) and never see a provider ID at all.
 */
export const SUPPORTED_AI_PROVIDERS = ['OPENAI', 'ANTHROPIC', 'GOOGLE_GEMINI'] as const;
export type AiProviderId = (typeof SUPPORTED_AI_PROVIDERS)[number];

export function isSupportedAiProvider(value: string): value is AiProviderId {
  return (SUPPORTED_AI_PROVIDERS as readonly string[]).includes(value);
}

/**
 * The exact runtime configuration a provider adapter needs for one call — resolved ONCE per request
 * by the caller (DynamicLlmGateway, or AiSettingsService.test()) from AiSettingsResolverService, and
 * passed down explicitly. An adapter never independently re-reads AiSettings itself: this is what
 * makes "resolve DB settings once, pass the resolved model/key to the selected adapter" structurally
 * true rather than a convention that could quietly drift, and what guarantees a Settings change
 * mid-flight can never produce a provider/model/key mismatch within one call.
 */
export interface LlmProviderAdapterConfig {
  model: string;
  apiKey: string;
}

/**
 * One adapter per real provider (OpenAiProviderAdapter / AnthropicProviderAdapter /
 * GoogleGeminiProviderAdapter). Every adapter:
 *   - accepts the SAME provider-neutral input/output contracts as LlmGateway (ClassificationInput /
 *     NormalizedClassificationResult / DraftReplyInput / NormalizedDraftResult) — a provider-specific
 *     response shape must never escape an adapter;
 *   - independently re-validates the provider's raw output against the exact same Zod schemas
 *     (rawClassificationOutputSchema / rawDraftOutputSchema) regardless of any provider-side
 *     structured-output enforcement;
 *   - normalizes every failure into LlmTransientError / LlmPermanentError / LlmMalformedOutputError
 *     (llm-errors.ts), never leaking a raw provider response body, API key, or auth header;
 *   - has no tools, no web/file access, no function/business-action calling, and stores no
 *     chain-of-thought;
 *   - has NO dependency on AiSettingsResolverService or ConfigService — it is handed a fully
 *     resolved LlmProviderAdapterConfig by its caller and never reads settings itself.
 */
export interface LlmProviderAdapter {
  classifyIntent(input: ClassificationInput, config: LlmProviderAdapterConfig): Promise<NormalizedClassificationResult>;
  draftReply(input: DraftReplyInput, config: LlmProviderAdapterConfig): Promise<NormalizedDraftResult>;
  /**
   * A harmless, minimal connectivity check only — proves the model/API key combination is usable.
   * Must NEVER classify a customer message, draft a reply, or create any business record. Used
   * exclusively by AiSettingsService.test() ("Test AI"), never by classifyIntent/draftReply
   * business flows.
   */
  testConnection(config: LlmProviderAdapterConfig): Promise<{ latencyMs: number }>;
}
