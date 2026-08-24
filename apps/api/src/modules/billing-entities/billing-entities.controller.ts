import { Body, Controller, Get, Ip, Param, Patch, Post, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../identity/auth-user';
import { Roles } from '../../identity/roles.decorator';
import { CreateBillingEntityDto, UpdateBillingEntityDto } from './billing-entities.dto';
import { BillingEntitiesService } from './billing-entities.service';

@Controller('billing-entities')
export class BillingEntitiesController {
  constructor(private readonly entities: BillingEntitiesService) {}

  @Get()
  list() {
    return this.entities.list();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.entities.findOne(id);
  }

  @Roles('ADMIN')
  @Post()
  create(
    @Body() input: CreateBillingEntityDto,
    @Req() req: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.entities.create(input, { actorId: req.user.id, ipAddress: ip });
  }

  @Roles('ADMIN')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() input: UpdateBillingEntityDto,
    @Req() req: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.entities.update(id, input, { actorId: req.user.id, ipAddress: ip });
  }
}
