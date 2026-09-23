import { Module } from '@nestjs/common';
import { AiSettingsResolverService } from './ai-settings-resolver.service';
import { DynamicLlmGateway } from './dynamic-llm-gateway';
import { LLM_GATEWAY } from './llm-gateway';
import { MockLlmGateway } from './mock-llm-gateway';
import { OpenAiLlmGateway } from './openai-llm-gateway';

/**
 * Phase 3.1 §J correction — the ONE place an LlmGateway is made available for injection, shared by
 * both processes that are ever allowed to call one: WorkerAppModule (automatic classification/
 * routing) and AiModule/CommunicationsModule (API-side, explicit human-initiated suggested-reply
 * drafting). LLM_GATEWAY now always resolves to DynamicLlmGateway, which itself resolves the real
 * OpenAiLlmGateway from AiSettings at call time — there is no more AI_PROVIDER-based mock-vs-real
 * selection at DI/boot time. See dynamic-llm-gateway.ts's own doc comment for the full safe-behavior
 * contract this closes.
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
    OpenAiLlmGateway,
    DynamicLlmGateway,
    { provide: LLM_GATEWAY, useExisting: DynamicLlmGateway },
  ],
  // AiSettingsResolverService is exported for AiClassificationService/AiClassificationEnqueueService/
  // AiClassificationWorker/AiRoutingService (WorkerAppModule) and AiSettingsService (AiModule, the
  // Phase 3.1 admin settings API) — every dynamic-AI-config consumer imports LlmProviderModule
  // already or gains it here, rather than each re-declaring this provider independently.
  // MockLlmGateway is exported so a dev/test-only module override can still reach it directly.
  exports: [LLM_GATEWAY, AiSettingsResolverService, MockLlmGateway],
})
export class LlmProviderModule {}
