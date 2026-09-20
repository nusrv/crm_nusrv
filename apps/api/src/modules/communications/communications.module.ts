import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AiModule } from '../ai/ai.module';
import { CustomersModule } from '../customers/customers.module';
import { MailConfigurationResolverService } from '../mail/mail-configuration-resolver.service';
import { AiReplyDraftService } from './ai-reply-draft.service';
import { CommunicationThreadsController } from './communication-threads.controller';
import { CommunicationThreadsService } from './communication-threads.service';
import { OperatorReplyQueueService } from './operator-reply-queue.service';
import { OPERATOR_REPLY_QUEUE } from './operator-reply-queue.constants';
import { OperatorReplyService } from './operator-reply.service';

/**
 * API-process side only, mirroring MailModule/AiModule's exact split. Registers the operator-reply
 * queue and its periodic-scheduler producer, plus the read/reply/resolve HTTP surface. Does NOT
 * provide OperatorReplyOutboundService, a MailTransport, or OperatorReplyWorker itself — actually
 * sending SMTP is WorkerAppModule's job exclusively, so an API instance can never accidentally also
 * become an SMTP-sending worker (same boundary MailModule/WorkerAppModule already establish for
 * Slice B).
 *
 * MailConfigurationResolverService is provided directly here (not imported from elsewhere) — it is
 * pure, stateless resolution logic (PrismaService + ConfigService only) safe to run in either
 * process; OperatorReplyService (HTTP-side) needs it to validate the thread's pinned mailbox at
 * reply-creation time (§9), independently of WorkerAppModule's own copy for send-time
 * revalidation.
 *
 * Slice F — AiReplyDraftService is provided here (not in AiModule) because it is fundamentally a
 * Communication Center capability (thread/message loading, mirrors OperatorReplyService's own
 * location) that happens to depend on AiModule's exports (EffectiveClassificationService,
 * AiHealthService, LLM_GATEWAY via LlmProviderModule) — the same dependency direction
 * CommunicationThreadsService already has on EffectiveClassificationService.
 */
@Module({
  imports: [BullModule.registerQueue({ name: OPERATOR_REPLY_QUEUE }), AiModule, CustomersModule],
  controllers: [CommunicationThreadsController],
  providers: [
    OperatorReplyQueueService,
    CommunicationThreadsService,
    OperatorReplyService,
    MailConfigurationResolverService,
    AiReplyDraftService,
  ],
})
export class CommunicationsModule {}
