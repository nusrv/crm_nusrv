import { Body, Controller, Get, Ip, Param, Patch, Post, Req } from '@nestjs/common';
import { Roles } from '../../identity/roles.decorator';
import type { AuthenticatedRequest } from '../../identity/auth-user';
import { JoFotaraConnectionsService } from './jofotara-connections.service';
import { SaveJoFotaraConnectionDto } from './jofotara-connections.dto';
@Controller('billing-entities/:entityId/jofotara-connections')
export class JoFotaraConnectionsController {
  constructor(private readonly service: JoFotaraConnectionsService) {}
  @Get() @Roles('ADMIN', 'ACCOUNTANT') list(@Param('entityId') entityId: string) {
    return this.service.list(entityId);
  }
  @Post() @Roles('ADMIN') create(
    @Param('entityId') entityId: string,
    @Body() input: SaveJoFotaraConnectionDto,
    @Req() req: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.service.save(entityId, null, input, { actorId: req.user.id, ipAddress: ip });
  }
  @Patch(':id') @Roles('ADMIN') update(
    @Param('entityId') entityId: string,
    @Param('id') id: string,
    @Body() input: SaveJoFotaraConnectionDto,
    @Req() req: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.service.save(entityId, id, input, { actorId: req.user.id, ipAddress: ip });
  }
}
