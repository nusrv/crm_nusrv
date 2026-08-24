import { Module } from '@nestjs/common';
import { SubscriptionConnectionsController } from './subscription-connections.controller';
import { SubscriptionConnectionsService } from './subscription-connections.service';

@Module({
  controllers: [SubscriptionConnectionsController],
  providers: [SubscriptionConnectionsService],
})
export class SubscriptionConnectionsModule {}
