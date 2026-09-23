import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AI_QUEUE } from './ai-queue.constants';
import { AiClassificationEnqueueService } from './ai-classification-enqueue.service';
import { AiHealthService } from './ai-health.service';
import { AiQueueService } from './ai-queue.service';
import { AiSettingsController } from './ai-settings.controller';
import { AiSettingsService } from './ai-settings.service';
import { ClassificationController } from './classification.controller';
import { ClassificationReviewService } from './classification-review.service';
import { EffectiveClassificationService } from './effective-classification.service';
import { LlmProviderModule } from './llm-provider.module';

/**
 * API-process side only, exactly mirroring MailModule/Slice C's split. Registers the AI queue and
 * its periodic recovery-scan scheduler-producer, plus the read/review HTTP surface (§24) and the
 * enqueue producer (usable from any process, including this one, though in practice only
 * MailInboundIngestService in WorkerAppModule calls it today). Does NOT provide
 * AiClassificationService or AiClassificationWorker itself — automatic background classification
 * remains WorkerAppModule's job exclusively, so an API instance can never accidentally also become
 * an AI-classifying worker (§3 of the Slice F pre-flight audit's frozen decisions).
 *
 * Slice F §2/§5 — this module DOES import LlmProviderModule and re-export LLM_GATEWAY, because
 * Slice F's owner decision explicitly allows the API process to call an LlmGateway directly for one
 * specific, side-effect-free, human-initiated operation: on-demand suggested-reply drafting
 * (AiReplyDraftService, in CommunicationsModule). This is deliberately narrower than "the API
 * process may run AI workloads" — it never gains AiClassificationService/AiClassificationWorker,
 * never consumes the AI_QUEUE, and never performs automatic/background provider calls.
 */
@Module({
  imports: [BullModule.registerQueue({ name: AI_QUEUE }), LlmProviderModule],
  controllers: [ClassificationController, AiSettingsController],
  providers: [
    AiQueueService,
    AiClassificationEnqueueService,
    EffectiveClassificationService,
    ClassificationReviewService,
    AiHealthService,
    AiSettingsService,
  ],
  // EffectiveClassificationService is also exported for Slice E's CommunicationThreadsService,
  // which surfaces the same effective-classification read model in the thread detail view (§6) —
  // reusing this exact service rather than duplicating its ordering logic (§22).
  // AiHealthService and LlmProviderModule (LLM_GATEWAY) are exported for Slice F's
  // AiReplyDraftService only — see this module's own doc comment above.
  exports: [AiClassificationEnqueueService, EffectiveClassificationService, AiHealthService, LlmProviderModule],
})
export class AiModule {}
