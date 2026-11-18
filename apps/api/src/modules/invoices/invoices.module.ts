import { JoFotaraConnectionsController } from './jofotara-connections.controller';
import { JoFotaraConnectionsService } from './jofotara-connections.service';
import { FawtaraMapper } from './fawtara-mapper';
import { JoFotaraGateway } from './jofotara.gateway';
import { FawtaraSubmissionService } from './fawtara-submission.service';
import { Module } from '@nestjs/common';
import { InvoicePreflightService } from './invoice-preflight.service';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

@Module({
  controllers: [InvoicesController, JoFotaraConnectionsController],
  providers: [
    InvoicesService,
    InvoicePreflightService,
    JoFotaraConnectionsService,
    FawtaraMapper,
    JoFotaraGateway,
    FawtaraSubmissionService,
  ],
})
export class InvoicesModule {}
