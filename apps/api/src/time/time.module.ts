import { Global, Module } from '@nestjs/common';
import { BusinessTimeService } from './business-time.service';
import { ClockService } from './clock.service';

@Global()
@Module({
  providers: [BusinessTimeService, ClockService],
  exports: [BusinessTimeService, ClockService],
})
export class TimeModule {}
