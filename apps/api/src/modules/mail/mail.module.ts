import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ImapMailboxReaderFactory } from './imap-mailbox-reader-factory';
import { IntegrationHealthController } from './integration-health.controller';
import { IntegrationHealthService } from './integration-health.service';
import { IMAP_QUEUE } from './mail-imap-queue.constants';
import { MailImapHealthService } from './mail-imap-health.service';
import { MailImapQueueService } from './mail-imap-queue.service';
import { MailHealthService } from './mail-health.service';
import { MAIL_QUEUE } from './mail-queue.constants';
import { MailQueueService } from './mail-queue.service';
import { MailSettingsController } from './mail-settings.controller';
import { MailSettingsService } from './mail-settings.service';
import { MicrosoftOAuthTokenProvider } from './microsoft-oauth-token-provider';
import { SmtpMailTransport } from './smtp-mail-transport';

/**
 * API-process side only (hardening pass — worker-process ownership). This module registers both
 * the outbound and inbound mail queues and their periodic-scheduler producers
 * (MailQueueService/MailImapQueueService.onModuleInit() call upsertJobScheduler(), which is
 * idempotent — safe even though only the API process ever runs it) — it does NOT provide
 * MailOutboundService/MailInboundIngestService or MailWorker/MailImapWorker themselves. Actually
 * consuming/sending/syncing mail on a continuous, queued basis remains WorkerAppModule's job
 * exclusively, exactly mirroring how RenewalCasesModule registers the renewal queue +
 * RenewalQueueService here while RenewalWorker lives only in worker-app.module.ts.
 *
 * Phase 3.1 §F/§G — one deliberate, narrow exception to "the API never touches transport": this
 * module DOES provide SmtpMailTransport/ImapMailboxReaderFactory/MicrosoftOAuthTokenProvider, but
 * ONLY for MailSettingsController's explicit, synchronous, human-triggered "Test IMAP/SMTP
 * Connection" admin actions — never for a queued/continuous worker loop. An API instance still
 * never becomes an SMTP-sending or IMAP-syncing WORKER just because it imports this module: it has
 * no MailOutboundService/MailInboundIngestService, no MAIL_TRANSPORT/MAILBOX_READER_FACTORY
 * provider, and no MailWorker/MailImapWorker @Processor — the structural invariant this module's
 * original doc comment describes is unchanged.
 */
@Module({
  imports: [BullModule.registerQueue({ name: MAIL_QUEUE }), BullModule.registerQueue({ name: IMAP_QUEUE })],
  controllers: [MailSettingsController, IntegrationHealthController],
  providers: [
    MailQueueService,
    MailImapQueueService,
    MailSettingsService,
    SmtpMailTransport,
    ImapMailboxReaderFactory,
    MicrosoftOAuthTokenProvider,
    MailHealthService,
    MailImapHealthService,
    IntegrationHealthService,
  ],
})
export class MailModule {}
