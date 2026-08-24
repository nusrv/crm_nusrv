import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from './audit/audit.module';
import { validateEnvironment } from './config/environment';
import { DatabaseModule } from './database/database.module';
import { RenewalEngineService } from './modules/renewal-cases/renewal-engine.service';
import { RENEWAL_QUEUE } from './modules/renewal-cases/renewal-queue.constants';
import { RenewalTemplateRenderer } from './modules/renewal-cases/renewal-template.renderer';
import { RenewalWorker } from './modules/renewal-cases/renewal.worker';
import { QueueFoundationModule } from './queue/queue-foundation.module';
import { TimeModule } from './time/time.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnvironment }),
    DatabaseModule,
    TimeModule,
    AuditModule,
    QueueFoundationModule,
    BullModule.registerQueue({ name: RENEWAL_QUEUE }),
  ],
  providers: [RenewalTemplateRenderer, RenewalEngineService, RenewalWorker],
})
export class WorkerAppModule {}
