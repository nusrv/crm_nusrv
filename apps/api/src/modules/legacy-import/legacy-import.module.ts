import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { LegacyImportController } from './legacy-import.controller';
import { LegacyImportService } from './legacy-import.service';

@Module({
  imports: [CustomersModule, SubscriptionsModule],
  controllers: [LegacyImportController],
  providers: [LegacyImportService],
})
export class LegacyImportModule {}
