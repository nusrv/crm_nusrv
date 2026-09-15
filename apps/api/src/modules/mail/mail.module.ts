import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MAIL_QUEUE } from './mail-queue.constants';
import { MailQueueService } from './mail-queue.service';

/**
 * API-process side only (hardening pass — worker-process ownership). This module registers the
 * mail queue and the periodic-scheduler producer (MailQueueService.onModuleInit() calls
 * upsertJobScheduler(), which is idempotent — safe even though only the API process ever runs it)
 * — it does NOT provide MailOutboundService, the transport, or MailWorker itself. Actually
 * consuming/sending mail is WorkerAppModule's job exclusively, exactly mirroring how
 * RenewalCasesModule registers the renewal queue + RenewalQueueService here while RenewalWorker
 * lives only in worker-app.module.ts. An API instance must never also become an SMTP-sending
 * worker just because it imports this module.
 */
@Module({
  imports: [BullModule.registerQueue({ name: MAIL_QUEUE })],
  providers: [MailQueueService],
})
export class MailModule {}
