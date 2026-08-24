import { Body, Controller, Ip, Post, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../identity/auth-user';
import { Roles } from '../../identity/roles.decorator';
import { ManualRenewalEvaluationDto } from './renewal-cases.dto';
import { RenewalQueueService } from './renewal-queue.service';

@Controller('renewal-engine')
export class RenewalEngineController {
  constructor(private readonly renewalQueue: RenewalQueueService) {}

  @Roles('ADMIN')
  @Post('run')
  run(
    @Body() input: ManualRenewalEvaluationDto,
    @Req() req: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.renewalQueue.triggerManual(input.reason, {
      actorId: req.user.id,
      ipAddress: ip,
    });
  }
}
