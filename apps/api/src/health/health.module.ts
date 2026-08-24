import { Module } from '@nestjs/common';
import { QueueFoundationModule } from '../queue/queue-foundation.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [QueueFoundationModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
