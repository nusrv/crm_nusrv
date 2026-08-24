import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { redisConnectionOptions } from './redis-config';
import { RedisConnectionService } from './redis-connection.service';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: redisConnectionOptions(config),
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1_000 },
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      }),
    }),
  ],
  providers: [RedisConnectionService],
  exports: [BullModule, RedisConnectionService],
})
export class QueueFoundationModule {}
