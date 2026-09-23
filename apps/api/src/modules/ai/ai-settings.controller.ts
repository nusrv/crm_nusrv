import { Body, Controller, Get, Ip, Patch, Post, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../identity/auth-user';
import { Roles } from '../../identity/roles.decorator';
import { AiSettingsService } from './ai-settings.service';
import { UpdateAiSettingsDto } from './ai-settings.dto';

/** Phase 3.1 §B/§H — the supported ADMIN administration surface for the one persisted AiSettings
 * row. IT may view (matches TechnicalConnectionsController's/MailSettingsController's own
 * precedent), never mutate/test. */
@Controller('settings/ai')
export class AiSettingsController {
  constructor(private readonly settings: AiSettingsService) {}

  @Roles('ADMIN', 'IT')
  @Get()
  get() {
    return this.settings.get();
  }

  @Roles('ADMIN')
  @Patch()
  update(@Body() input: UpdateAiSettingsDto, @Req() req: AuthenticatedRequest, @Ip() ip: string) {
    return this.settings.update(input, { actorId: req.user.id, ipAddress: ip });
  }

  @Roles('ADMIN')
  @Post('test')
  test() {
    return this.settings.test();
  }
}
