import { Injectable } from '@nestjs/common';
import { AiSettingsResolverService } from './ai-settings-resolver.service';
import type { ClassificationInput, DraftReplyInput, LlmGateway, NormalizedClassificationResult, NormalizedDraftResult } from './llm-gateway';
import { LlmPermanentError } from './llm-errors';
import { OpenAiLlmGateway } from './openai-llm-gateway';

/**
 * Phase 3.1 §J correction — the ONE place normal runtime provider selection happens, and it is now
 * driven EXCLUSIVELY by the persisted AiSettings row (via AiSettingsResolverService), never by the
 * AI_PROVIDER environment variable. This closes the exact contradiction the correction identified:
 * Settings could previously say "AI Enabled, Provider OpenAI, Test AI succeeds" while
 * AI_PROVIDER=mock silently kept real classification on MockLlmGateway.
 *
 * This is the single LLM_GATEWAY implementation bound in llm-provider.module.ts for ALL real
 * consumers (AiClassificationService, AiReplyDraftService) — there is no more DI-time mock-vs-real
 * branch in production wiring. Safe behavior, matching AiSettingsResolverService's own contract
 * exactly:
 *   - no AiSettings row, or `enabled: false`             -> throws LlmPermanentError (never mock).
 *   - `enabled: true` but `provider !== 'OPENAI'`         -> throws LlmPermanentError (V1 supports
 *     exactly one real provider; this can only happen if a future migration ever allows another
 *     provider value without also teaching this class how to route to it).
 *   - `enabled: true`, `provider: 'OPENAI'`               -> delegates to OpenAiLlmGateway, which
 *     itself throws LlmPermanentError if model/API key are missing/invalid — never falls back to a
 *     mock silently.
 * Every thrown LlmPermanentError is already handled identically by both real callers
 * (AiClassificationService routes it to HUMAN_REVIEW; AiReplyDraftService surfaces a 503) — this
 * class introduces no new error-handling path.
 *
 * MockLlmGateway is deliberately NOT injected or referenced here at all: per the correction,
 * mocks remain available for tests/dev only via explicit direct construction in test files, never
 * as a hidden production runtime branch that could contradict what Settings displays.
 */
@Injectable()
export class DynamicLlmGateway implements LlmGateway {
  constructor(
    private readonly aiSettings: AiSettingsResolverService,
    private readonly openai: OpenAiLlmGateway,
  ) {}

  async classifyIntent(input: ClassificationInput): Promise<NormalizedClassificationResult> {
    await this.ensureOpenAiSelected();
    return this.openai.classifyIntent(input);
  }

  async draftReply(input: DraftReplyInput): Promise<NormalizedDraftResult> {
    await this.ensureOpenAiSelected();
    return this.openai.draftReply(input);
  }

  private async ensureOpenAiSelected(): Promise<void> {
    const settings = await this.aiSettings.getSettings();
    if (!settings.enabled) {
      throw new LlmPermanentError('AI is disabled in Settings.');
    }
    if (settings.provider !== 'OPENAI') {
      throw new LlmPermanentError(`Unsupported AI provider "${settings.provider}" — only OPENAI is supported.`);
    }
  }
}
