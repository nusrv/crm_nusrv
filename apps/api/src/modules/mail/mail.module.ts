import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { IMAP_QUEUE } from './mail-imap-queue.constants';
import { MailImapQueueService } from './mail-imap-queue.service';
import { MAIL_QUEUE } from './mail-queue.constants';
import { MailQueueService } from './mail-queue.service';

/**
 * API-process side only (hardening pass — worker-process ownership). This module registers both
 * the outbound and inbound mail queues and their periodic-scheduler producers
 * (MailQueueService/MailImapQueueService.onModuleInit() call upsertJobScheduler(), which is
 * idempotent — safe even though only the API process ever runs it) — it does NOT provide
 * MailOutboundService/MailInboundIngestService, a transport/reader, or MailWorker/MailImapWorker
 * themselves. Actually consuming/sending/syncing mail is WorkerAppModule's job exclusively,
 * exactly mirroring how RenewalCasesModule registers the renewal queue + RenewalQueueService here
 * while RenewalWorker lives only in worker-app.module.ts. An API instance must never also become
 * an SMTP-sending or IMAP-syncing worker just because it imports this module.
 */
@Module({
  imports: [BullModule.registerQueue({ name: MAIL_QUEUE }), BullModule.registerQueue({ name: IMAP_QUEUE })],
  providers: [MailQueueService, MailImapQueueService],
})
export class MailModule {}
