import { Module } from '@nestjs/common';
import { AiSettingsResolverService } from './ai-settings-resolver.service';
import { AnthropicProviderAdapter } from './anthropic-provider-adapter';
import { DynamicLlmGateway } from './dynamic-llm-gateway';
import { GoogleGeminiProviderAdapter } from './google-gemini-provider-adapter';
import { LLM_GATEWAY } from './llm-gateway';
import { LlmProviderRegistry } from './llm-provider-registry.service';
import { MockLlmGateway } from './mock-llm-gateway';
import { OpenAiProviderAdapter } from './openai-provider-adapter';

/**
 * Phase 3.1 §J correction, made provider-neutral — the ONE place an LlmGateway is made available for
 * injection, shared by both processes that are ever allowed to call one: WorkerAppModule (automatic
 * classification/routing) and AiModule/CommunicationsModule (API-side, explicit human-initiated
 * suggested-reply drafting). LLM_GATEWAY always resolves to DynamicLlmGateway, which resolves the
 * real provider adapter from AiSettings (via LlmProviderRegistry) at call time — there is no
 * env-based mock-vs-real OR provider-vs-provider selection at DI/boot time. See
 * dynamic-llm-gateway.ts's own doc comment for the full safe-behavior contract, and
 * llm-provider-registry.service.ts for how a fourth provider gets added later.
 *
 * MockLlmGateway remains registered/exported here ONLY so a test file can construct or inject it
 * directly (e.g. via a NestJS testing-module override) when it explicitly wants mock behavior — it
 * is never wired into LLM_GATEWAY itself, so no production code path can silently receive it.
 *
 * Importing this module does NOT make a process a classification worker — it only makes an
 * LlmGateway available for injection. AiClassificationService/AiClassificationWorker remain
 * WorkerAppModule-only providers, registered nowhere else.
 */
@Module({
  providers: [
    AiSettingsResolverService,
    MockLlmGateway,
    OpenAiProviderAdapter,
    AnthropicProviderAdapter,
    GoogleGeminiProviderAdapter,
    LlmProviderRegistry,
    DynamicLlmGateway,
    { provide: LLM_GATEWAY, useExisting: DynamicLlmGateway },
  ],
  // AiSettingsResolverService is exported for AiClassificationService/AiClassificationEnqueueService/
  // AiClassificationWorker/AiRoutingService (WorkerAppModule) and AiSettingsService (AiModule, the
  // Phase 3.1 admin settings API) — every dynamic-AI-config consumer imports LlmProviderModule
  // already or gains it here, rather than each re-declaring this provider independently.
  // LlmProviderRegistry is exported for AiSettingsService's "Test AI", which resolves the same
  // provider adapter Test AI is supposed to prove works, via the identical registry real
  // classification/drafting uses.
  // MockLlmGateway is exported so a dev/test-only module override can still reach it directly.
  exports: [LLM_GATEWAY, AiSettingsResolverService, LlmProviderRegistry, MockLlmGateway],
})
export class LlmProviderModule {}
