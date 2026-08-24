import { Body, Controller, Get, Ip, Param, Patch, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../identity/auth-user';
import { Roles } from '../../identity/roles.decorator';
import {
  UpdateNotificationRuleDto,
  UpdateReminderRuleDto,
  UpdateRenewalTemplateDto,
} from './renewal-cases.dto';
import { RenewalConfigurationService } from './renewal-configuration.service';

@Controller('renewal-configuration')
export class RenewalConfigurationController {
  constructor(private readonly configuration: RenewalConfigurationService) {}

  @Get()
  getConfiguration() {
    return this.configuration.getConfiguration();
  }

  @Roles('ADMIN')
  @Patch('reminder-rules/:id')
  updateReminderRule(
    @Param('id') id: string,
    @Body() input: UpdateReminderRuleDto,
    @Req() req: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.configuration.updateReminderRule(id, input, {
      actorId: req.user.id,
      ipAddress: ip,
    });
  }

  @Roles('ADMIN')
  @Patch('templates/:id')
  updateTemplate(
    @Param('id') id: string,
    @Body() input: UpdateRenewalTemplateDto,
    @Req() req: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.configuration.updateTemplate(id, input, {
      actorId: req.user.id,
      ipAddress: ip,
    });
  }

  @Roles('ADMIN')
  @Patch('notification-rules/:id')
  updateNotificationRule(
    @Param('id') id: string,
    @Body() input: UpdateNotificationRuleDto,
    @Req() req: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.configuration.updateNotificationRule(id, input, {
      actorId: req.user.id,
      ipAddress: ip,
    });
  }
}
