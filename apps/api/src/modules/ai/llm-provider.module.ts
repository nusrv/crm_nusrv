import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AiSettingsResolverService } from './ai-settings-resolver.service';
import { LLM_GATEWAY, type LlmGateway } from './llm-gateway';
import { MockLlmGateway } from './mock-llm-gateway';
import { OpenAiLlmGateway } from './openai-llm-gateway';

/**
 * Slice F §5 — the ONE place AI_PROVIDER-based mock/real gateway selection happens, shared by both
 * processes that are ever allowed to call an LlmGateway: WorkerAppModule (automatic classification)
 * and AiModule/CommunicationsModule (API-side, explicit human-initiated suggested-reply drafting).
 * Previously this selection factory lived only in WorkerAppModule; extracting it here means neither
 * process re-implements or can drift from the other's provider-selection logic, lazy-credential
 * behavior, or production mock-fail-closed posture (enforced separately by environment.ts's own
 * validation, unaffected by this refactor).
 *
 * Importing this module does NOT make a process a classification worker — it only makes an
 * LlmGateway available for injection. AiClassificationService/AiClassificationWorker remain
 * WorkerAppModule-only providers, registered nowhere else.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    AiSettingsResolverService,
    MockLlmGateway,
    OpenAiLlmGateway,
    {
      provide: LLM_GATEWAY,
      inject: [ConfigService, MockLlmGateway, OpenAiLlmGateway],
      useFactory: (config: ConfigService, mock: MockLlmGateway, real: OpenAiLlmGateway): LlmGateway => {
        return config.get<string>('AI_PROVIDER') === 'openai' ? real : mock;
      },
    },
  ],
  // AiSettingsResolverService is exported for AiClassificationService/AiClassificationEnqueueService/
  // AiClassificationWorker/AiRoutingService (WorkerAppModule) and AiSettingsService (AiModule, the
  // Phase 3.1 admin settings API) — every dynamic-AI-config consumer imports LlmProviderModule
  // already or gains it here, rather than each re-declaring this provider independently.
  exports: [LLM_GATEWAY, AiSettingsResolverService],
})
export class LlmProviderModule {}
