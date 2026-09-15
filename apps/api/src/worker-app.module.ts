import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuditModule } from './audit/audit.module';
import { validateEnvironment } from './config/environment';
import { DatabaseModule } from './database/database.module';
import { CustomersModule } from './modules/customers/customers.module';
import { MailConfigurationResolverService } from './modules/mail/mail-configuration-resolver.service';
import { MailHealthService } from './modules/mail/mail-health.service';
import { MailOutboundService } from './modules/mail/mail-outbound.service';
import { MAIL_QUEUE } from './modules/mail/mail-queue.constants';
import { MAIL_TRANSPORT, type MailTransport } from './modules/mail/mail-transport';
import { MailThreadResolutionService } from './modules/mail/mail-thread-resolution.service';
import { MailWorker } from './modules/mail/mail.worker';
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
 * The dedicated worker process. Owns every BullMQ `@Processor` in the system — RenewalWorker AND
 * (hardening pass) MailWorker/MailOutboundService — exclusively. The API process (app.module.ts)
 * only ever imports the slim MailModule (queue registration + the periodic-scheduler producer);
 * it never provides MailOutboundService, a transport, or MailWorker itself, so an API instance can
 * never accidentally also become an SMTP-sending worker. Registers BullModule.registerQueue for
 * both queues directly (mirroring the existing RENEWAL_QUEUE registration here) rather than
 * importing a shared module for it, since each process needs its own BullMQ client registration
 * regardless of which side produces vs. consumes.
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
  ],
})
export class WorkerAppModule {}
