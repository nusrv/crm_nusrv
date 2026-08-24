import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CommunicationOutboxController } from './communication-outbox.controller';
import { CommunicationOutboxService } from './communication-outbox.service';
import { RenewalCasesController } from './renewal-cases.controller';
import { RenewalCasesService } from './renewal-cases.service';
import { RenewalConfigurationController } from './renewal-configuration.controller';
import { RenewalConfigurationService } from './renewal-configuration.service';
import { RenewalEngineController } from './renewal-engine.controller';
import { RenewalEngineService } from './renewal-engine.service';
import { RENEWAL_QUEUE } from './renewal-queue.constants';
import { RenewalQueueService } from './renewal-queue.service';
import { RenewalTemplateRenderer } from './renewal-template.renderer';

@Module({
  imports: [BullModule.registerQueue({ name: RENEWAL_QUEUE })],
  controllers: [
    RenewalCasesController,
    RenewalConfigurationController,
    CommunicationOutboxController,
    RenewalEngineController,
  ],
  providers: [
    RenewalCasesService,
    RenewalConfigurationService,
    CommunicationOutboxService,
    RenewalTemplateRenderer,
    RenewalEngineService,
    RenewalQueueService,
  ],
  exports: [RenewalEngineService],
})
export class RenewalCasesModule {}
