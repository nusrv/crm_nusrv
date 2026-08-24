import { Body, Controller, Get, Ip, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../identity/auth-user';
import { Roles } from '../../identity/roles.decorator';
import {
  CreateSubscriptionConnectionDto,
  UpdateSubscriptionConnectionDto,
} from './subscription-connections.dto';
import { SubscriptionConnectionsService } from './subscription-connections.service';

@Controller('subscription-connections')
export class SubscriptionConnectionsController {
  constructor(private readonly mappings: SubscriptionConnectionsService) {}

  @Get()
  list(@Query('subscriptionId') subscriptionId?: string) {
    return this.mappings.list(subscriptionId);
  }

  @Roles('ADMIN', 'IT')
  @Post()
  create(
    @Body() input: CreateSubscriptionConnectionDto,
    @Req() req: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.mappings.create(input, { actorId: req.user.id, ipAddress: ip });
  }

  @Roles('ADMIN', 'IT')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() input: UpdateSubscriptionConnectionDto,
    @Req() req: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.mappings.update(id, input, { actorId: req.user.id, ipAddress: ip });
  }
}
