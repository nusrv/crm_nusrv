import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuditModule } from './audit/audit.module';
import { validateEnvironment } from './config/environment';
import { DatabaseModule } from './database/database.module';
import { CustomersModule } from './modules/customers/customers.module';
import { ImapMailboxReaderFactory } from './modules/mail/imap-mailbox-reader-factory';
import { MailConfigurationResolverService } from './modules/mail/mail-configuration-resolver.service';
import { MailHealthService } from './modules/mail/mail-health.service';
import { IMAP_QUEUE } from './modules/mail/mail-imap-queue.constants';
import { MailImapHealthService } from './modules/mail/mail-imap-health.service';
import { MailInboundCorrelationService } from './modules/mail/mail-inbound-correlation.service';
import { MailInboundIngestService } from './modules/mail/mail-inbound-ingest.service';
import { MailInboundSenderResolutionService } from './modules/mail/mail-inbound-sender-resolution.service';
import { MailImapWorker } from './modules/mail/mail-imap.worker';
import { MailOutboundService } from './modules/mail/mail-outbound.service';
import { MAIL_QUEUE } from './modules/mail/mail-queue.constants';
import { MAIL_TRANSPORT, type MailTransport } from './modules/mail/mail-transport';
import { MailThreadResolutionService } from './modules/mail/mail-thread-resolution.service';
import { MailWorker } from './modules/mail/mail.worker';
import { MAILBOX_READER_FACTORY, type MailboxReaderFactory } from './modules/mail/mailbox-reader';
import { MockMailboxReaderFactory } from './modules/mail/mock-mailbox-reader-factory';
import { MockMailTransport } from './modules/mail/mock-mail-transport';
import { SmtpMailTransport } from './modules/mail/smtp-mail-transport';
import { RenewalEngineService } from './modules/renewal-cases/renewal-engine.service';
import { RENEWAL_QUEUE } from './modules/renewal-cases/renewal-queue.constants';
import { RenewalTemplateRenderer } from './modules/renewal-cases/renewal-template.renderer';
import { RenewalWorker } from './modules/renewal-cases/renewal.worker';
import { QueueFoundationModule } from './queue/queue-foundation.module';
import { SecurityModule } from './security/security.module';
import { TimeModule } from './time/time.module';

/**
 * The dedicated worker process. Owns every BullMQ `@Processor` in the system — RenewalWorker,
 * MailWorker/MailOutboundService (Slice B), and (Slice C) MailImapWorker/MailInboundIngestService
 * — exclusively. The API process (app.module.ts) only ever imports the slim MailModule (queue
 * registration + the periodic-scheduler producers); it never provides MailOutboundService /
 * MailInboundIngestService, a transport/reader, or MailWorker/MailImapWorker themselves, so an API
 * instance can never accidentally also become an SMTP-sending or IMAP-syncing worker. Registers
 * BullModule.registerQueue for every queue directly (mirroring the existing RENEWAL_QUEUE
 * registration here) rather than importing a shared module for it, since each process needs its
 * own BullMQ client registration regardless of which side produces vs. consumes.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnvironment }),
    DatabaseModule,
    TimeModule,
    SecurityModule,
    AuditModule,
    QueueFoundationModule,
    CustomersModule,
    BullModule.registerQueue({ name: RENEWAL_QUEUE }),
    BullModule.registerQueue({ name: MAIL_QUEUE }),
    BullModule.registerQueue({ name: IMAP_QUEUE }),
  ],
  providers: [
    RenewalTemplateRenderer,
    RenewalEngineService,
    RenewalWorker,
    MailConfigurationResolverService,
    MailThreadResolutionService,
    MailHealthService,
    MailOutboundService,
    MockMailTransport,
    SmtpMailTransport,
    {
      provide: MAIL_TRANSPORT,
      inject: [ConfigService, MockMailTransport, SmtpMailTransport],
      useFactory: (
        config: ConfigService,
        mock: MockMailTransport,
        smtp: SmtpMailTransport,
      ): MailTransport => {
        const sendingEnabled = config.get<string>('MAIL_SEND_ENABLED') === 'true';
        const smtpMode = config.get<string>('SMTP_MODE');
        return sendingEnabled && smtpMode !== 'mock' ? smtp : mock;
      },
    },
    MailWorker,
    MailInboundSenderResolutionService,
    MailInboundCorrelationService,
    MailImapHealthService,
    MailInboundIngestService,
    MockMailboxReaderFactory,
    ImapMailboxReaderFactory,
    {
      provide: MAILBOX_READER_FACTORY,
      inject: [ConfigService, MockMailboxReaderFactory, ImapMailboxReaderFactory],
      useFactory: (
        config: ConfigService,
        mock: MockMailboxReaderFactory,
        real: ImapMailboxReaderFactory,
      ): MailboxReaderFactory => {
        return config.get<string>('IMAP_MODE') === 'mock' ? mock : real;
      },
    },
    MailImapWorker,
  ],
})
export class WorkerAppModule {}
