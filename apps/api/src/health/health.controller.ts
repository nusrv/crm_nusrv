import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../identity/public.decorator';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get('live')
  liveness() {
    return this.health.liveness();
  }

  @Public()
  @Get('ready')
  async readiness(@Res({ passthrough: true }) response: Response) {
    const result = await this.health.readiness();
    if (result.status === 'degraded') response.status(HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}
