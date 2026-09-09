import { Module } from '@nestjs/common';
import { SubscriptionCodeService } from './subscription-code.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, SubscriptionCodeService],
  exports: [SubscriptionCodeService],
})
export class SubscriptionsModule {}
