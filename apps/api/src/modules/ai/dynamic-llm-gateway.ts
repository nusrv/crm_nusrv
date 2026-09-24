import { Injectable } from '@nestjs/common';
import { AiSettingsResolverService } from './ai-settings-resolver.service';
import type { ClassificationInput, DraftReplyInput, LlmGateway, NormalizedClassificationResult, NormalizedDraftResult } from './llm-gateway';
import { LlmPermanentError } from './llm-errors';
import type { LlmProviderAdapter, LlmProviderAdapterConfig } from './llm-provider-adapter';
import { LlmProviderRegistry } from './llm-provider-registry.service';

/**
 * Phase 3.1 §J correction, made provider-neutral — the ONE place normal runtime provider selection
 * happens, driven EXCLUSIVELY by the persisted AiSettings row (via AiSettingsResolverService), never
 * by any environment variable. There is no AI adapter-selection env var of any kind: this class has
 * no `ConfigService` dependency at all, so it is architecturally incapable of consulting one.
 *
 * This is the single LLM_GATEWAY implementation bound in llm-provider.module.ts for ALL real
 * consumers (AiClassificationService, AiReplyDraftService) — there is no more DI-time mock-vs-real
 * branch in production wiring, and no provider-specific branch either: this class delegates entirely
 * to LlmProviderRegistry, which is the only place that maps a provider ID to a concrete adapter (see
 * that class's own doc comment for how a fourth provider gets added later).
 *
 * §C — settings are resolved ONCE per call (`resolveActiveAdapter()`), and the resolved
 * model/API key are passed down explicitly to the selected adapter's method — the adapter itself
 * never independently re-reads AiSettings. This is what makes a provider/model/key mismatch between
 * two racing Settings reads within one call structurally impossible, and what makes "a Settings
 * change takes effect on the very next call, no restart" true without any caching to invalidate.
 *
 * Safe behavior:
 *   - no AiSettings row, or `enabled: false`                    -> LlmPermanentError (never mock).
 *   - `enabled: true` but `provider` is not a supported ID       -> LlmPermanentError (fails closed;
 *     see LlmProviderRegistry.resolve()).
 *   - `enabled: true`, valid provider, but no `model` configured -> LlmPermanentError.
 *   - `enabled: true`, valid provider/model, but no API key      -> LlmPermanentError.
 *   - otherwise                                                  -> delegates to the resolved
 *     adapter, which itself normalizes every provider failure into the same three typed errors.
 * Every thrown LlmPermanentError is already handled identically by both real callers
 * (AiClassificationService routes it to HUMAN_REVIEW; AiReplyDraftService surfaces a 503) — this
 * class introduces no new error-handling path.
 *
 * MockLlmGateway is deliberately NOT referenced here at all: per the correction, mocks remain
 * available for tests/dev only via explicit direct construction in test files, never as a hidden
 * production runtime branch that could contradict what Settings displays.
 */
@Injectable()
export class DynamicLlmGateway implements LlmGateway {
  constructor(
    private readonly aiSettings: AiSettingsResolverService,
    private readonly registry: LlmProviderRegistry,
  ) {}

  async classifyIntent(input: ClassificationInput): Promise<NormalizedClassificationResult> {
    const { adapter, config } = await this.resolveActiveAdapter();
    return adapter.classifyIntent(input, config);
  }

  async draftReply(input: DraftReplyInput): Promise<NormalizedDraftResult> {
    const { adapter, config } = await this.resolveActiveAdapter();
    return adapter.draftReply(input, config);
  }

  private async resolveActiveAdapter(): Promise<{ adapter: LlmProviderAdapter; config: LlmProviderAdapterConfig }> {
    const settings = await this.aiSettings.getSettings();
    if (!settings.enabled) {
      throw new LlmPermanentError('AI is disabled in Settings.');
    }
    const adapter = this.registry.resolve(settings.provider);
    if (!adapter) {
      throw new LlmPermanentError(`Unsupported AI provider "${settings.provider}".`);
    }
    if (!settings.model) {
      throw new LlmPermanentError('AI model is not configured.');
    }
    const apiKey = await this.aiSettings.getApiKey();
    if (!apiKey) {
      throw new LlmPermanentError('AI API key is not configured.');
    }
    return { adapter, config: { model: settings.model, apiKey } };
  }
}
