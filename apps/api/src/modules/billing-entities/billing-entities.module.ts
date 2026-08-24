import { Module } from '@nestjs/common';
import { BillingEntitiesController } from './billing-entities.controller';
import { BillingEntitiesService } from './billing-entities.service';

@Module({ controllers: [BillingEntitiesController], providers: [BillingEntitiesService] })
export class BillingEntitiesModule {}
