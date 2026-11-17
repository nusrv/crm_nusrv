import { Module } from '@nestjs/common';
import { InvoicePreflightService } from './invoice-preflight.service';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

@Module({
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoicePreflightService],
})
export class InvoicesModule {}
