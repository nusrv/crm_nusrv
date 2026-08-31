import { Module } from '@nestjs/common';
import { CustomerChannelsController } from './customer-channels.controller';
import { CustomerChannelsService } from './customer-channels.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  controllers: [CustomersController, CustomerChannelsController],
  providers: [CustomersService, CustomerChannelsService],
})
export class CustomersModule {}
