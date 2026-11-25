import { BadRequestException, Body, Controller, Get, Header, Param, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../identity/auth-user';
import { readVerifiedAccessContext } from '../../identity/verified-access-context';
import { Roles } from '../../identity/roles.decorator';
import { MailSentObservationService } from './mail-sent-observation.service';

@Controller('settings/mail/:id/sent-observation')
@Roles('ADMIN')
export class MailSentObservationController {
  constructor(private readonly sent: MailSentObservationService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  status(@Param('id') id: string) { return this.sent.status(id); }

  @Post('activate')
  @Header('Cache-Control', 'no-store')
  activate(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const actor = readVerifiedAccessContext(req.user);
    if (!actor) throw new UnauthorizedException('Invalid session.');
    if (!body || typeof body !== 'object' || Object.keys(body).length !== 1 ||
        (body as { futureOnly?: unknown }).futureOnly !== true) throw new BadRequestException('Confirm the future-only baseline.');
    return this.sent.activate(id, actor);
  }
}
