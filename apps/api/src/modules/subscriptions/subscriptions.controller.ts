import { Body, Controller, Get, Ip, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../identity/auth-user';
import { Roles } from '../../identity/roles.decorator';
import {
  CreateSubscriptionDto,
  SubscriptionListQueryDto,
  UpdateSubscriptionDto,
} from './subscriptions.dto';
import { SubscriptionsService } from './subscriptions.service';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  list(@Query() query: SubscriptionListQueryDto) {
    return this.subscriptions.list(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.subscriptions.findOne(id);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Post()
  create(@Body() input: CreateSubscriptionDto, @Req() req: AuthenticatedRequest, @Ip() ip: string) {
    return this.subscriptions.create(input, { actorId: req.user.id, ipAddress: ip });
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() input: UpdateSubscriptionDto,
    @Req() req: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.subscriptions.update(id, input, { actorId: req.user.id, ipAddress: ip });
  }
}
