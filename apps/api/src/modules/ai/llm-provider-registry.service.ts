import { Injectable } from '@nestjs/common';
import { AnthropicProviderAdapter } from './anthropic-provider-adapter';
import { GoogleGeminiProviderAdapter } from './google-gemini-provider-adapter';
import { isSupportedAiProvider, type AiProviderId, type LlmProviderAdapter } from './llm-provider-adapter';
import { OpenAiProviderAdapter } from './openai-provider-adapter';

/**
 * Provider-neutral correction §C — the ONE place `AiSettings.provider` is mapped to a concrete
 * `LlmProviderAdapter`. Adding a fourth provider later means adding one more entry here plus one
 * more adapter class — nothing else in the codebase (DynamicLlmGateway, AiSettingsService,
 * AiClassificationService, AiReplyDraftService, ...) needs to change, since every one of them only
 * ever sees the common LlmGateway/LlmProviderAdapter abstractions.
 */
@Injectable()
export class LlmProviderRegistry {
  private readonly adapters: Record<AiProviderId, LlmProviderAdapter>;

  constructor(
    openai: OpenAiProviderAdapter,
    anthropic: AnthropicProviderAdapter,
    googleGemini: GoogleGeminiProviderAdapter,
  ) {
    this.adapters = {
      OPENAI: openai,
      ANTHROPIC: anthropic,
      GOOGLE_GEMINI: googleGemini,
    };
  }

  /** Returns null for anything not in SUPPORTED_AI_PROVIDERS — never throws, never falls back to a
   * default adapter. An unknown/unsupported provider string must fail closed at the caller. */
  resolve(provider: string): LlmProviderAdapter | null {
    return isSupportedAiProvider(provider) ? this.adapters[provider] : null;
  }
}
