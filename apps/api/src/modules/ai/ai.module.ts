import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AI_QUEUE } from './ai-queue.constants';
import { AiClassificationEnqueueService } from './ai-classification-enqueue.service';
import { AiQueueService } from './ai-queue.service';
import { ClassificationController } from './classification.controller';
import { ClassificationReviewService } from './classification-review.service';
import { EffectiveClassificationService } from './effective-classification.service';

/**
 * API-process side only, exactly mirroring MailModule/Slice C's split. Registers the AI queue and
 * its periodic recovery-scan scheduler-producer, plus the read/review HTTP surface (§24) and the
 * enqueue producer (usable from any process, including this one, though in practice only
 * MailInboundIngestService in WorkerAppModule calls it today). Does NOT provide
 * AiClassificationService, an LlmGateway, or AiClassificationWorker itself — actually calling a
 * provider and consuming jobs is WorkerAppModule's job exclusively, so an API instance can never
 * accidentally also become an AI-classifying worker.
 */
@Module({
  imports: [BullModule.registerQueue({ name: AI_QUEUE })],
  controllers: [ClassificationController],
  providers: [AiQueueService, AiClassificationEnqueueService, EffectiveClassificationService, ClassificationReviewService],
  // EffectiveClassificationService is also exported for Slice E's CommunicationThreadsService,
  // which surfaces the same effective-classification read model in the thread detail view (§6) —
  // reusing this exact service rather than duplicating its ordering logic (§22).
  exports: [AiClassificationEnqueueService, EffectiveClassificationService],
})
export class AiModule {}
