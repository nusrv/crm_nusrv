import { Body, Controller, Get, Ip, Param, Patch, Post, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../identity/auth-user';
import { Roles } from '../../identity/roles.decorator';
import { CreateMailSettingsDto, UpdateMailSettingsDto } from './mail-settings.dto';
import { MailSettingsService } from './mail-settings.service';

/** Phase 3.1 §B/§E — the supported ADMIN administration surface for MailConfiguration. IT may view
 * (matches TechnicalConnectionsController's own precedent), never mutate/test. */
@Controller('settings/mail')
export class MailSettingsController {
  constructor(private readonly settings: MailSettingsService) {}

  @Roles('ADMIN', 'IT')
  @Get()
  list() {
    return this.settings.list();
  }

  @Roles('ADMIN', 'IT')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.settings.findOne(id);
  }

  @Roles('ADMIN')
  @Post()
  create(@Body() input: CreateMailSettingsDto, @Req() req: AuthenticatedRequest, @Ip() ip: string) {
    return this.settings.create(input, { actorId: req.user.id, ipAddress: ip });
  }

  @Roles('ADMIN')
  @Patch(':id')
  update(@Param('id') id: string, @Body() input: UpdateMailSettingsDto, @Req() req: AuthenticatedRequest, @Ip() ip: string) {
    return this.settings.update(id, input, { actorId: req.user.id, ipAddress: ip });
  }

  @Roles('ADMIN')
  @Post(':id/test-imap')
  testImap(@Param('id') id: string) {
    return this.settings.testImap(id);
  }

  @Roles('ADMIN')
  @Post(':id/test-smtp')
  testSmtp(@Param('id') id: string) {
    return this.settings.testSmtp(id);
  }
}
