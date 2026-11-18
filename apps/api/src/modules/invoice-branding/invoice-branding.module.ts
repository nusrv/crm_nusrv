import { Module } from '@nestjs/common';
import { InvoiceBrandingController } from './invoice-branding.controller';
import { InvoiceBrandingService } from './invoice-branding.service';
@Module({ controllers: [InvoiceBrandingController], providers: [InvoiceBrandingService] })
export class InvoiceBrandingModule {}
