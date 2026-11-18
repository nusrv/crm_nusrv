import { InvoiceBrandingModule } from '../invoice-branding/invoice-branding.module';
import { Module } from '@nestjs/common';
import { BillingEntitiesController } from './billing-entities.controller';
import { BillingEntitiesService } from './billing-entities.service';

@Module({
  imports: [InvoiceBrandingModule],
  controllers: [BillingEntitiesController],
  providers: [BillingEntitiesService],
})
export class BillingEntitiesModule {}
