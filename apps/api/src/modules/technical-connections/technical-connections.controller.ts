import { Body, Controller, Get, Ip, Param, Patch, Post, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../identity/auth-user';
import { Roles } from '../../identity/roles.decorator';
import {
  CreateTechnicalConnectionDto,
  UpdateTechnicalConnectionDto,
} from './technical-connections.dto';
import { TechnicalConnectionsService } from './technical-connections.service';

@Controller('technical-connections')
export class TechnicalConnectionsController {
  constructor(private readonly connections: TechnicalConnectionsService) {}

  @Roles('ADMIN', 'IT')
  @Get()
  list() {
    return this.connections.list();
  }

  @Roles('ADMIN', 'IT')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.connections.findOne(id);
  }

  @Roles('ADMIN', 'IT')
  @Post()
  create(
    @Body() input: CreateTechnicalConnectionDto,
    @Req() req: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.connections.create(input, { actorId: req.user.id, ipAddress: ip });
  }

  @Roles('ADMIN', 'IT')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() input: UpdateTechnicalConnectionDto,
    @Req() req: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.connections.update(id, input, { actorId: req.user.id, ipAddress: ip });
  }
}
