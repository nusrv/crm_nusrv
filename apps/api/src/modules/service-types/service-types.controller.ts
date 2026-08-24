import { Body, Controller, Get, Ip, Param, Patch, Post, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../identity/auth-user';
import { Roles } from '../../identity/roles.decorator';
import { CreateServiceTypeDto, UpdateServiceTypeDto } from './service-types.dto';
import { ServiceTypesService } from './service-types.service';

@Controller('service-types')
export class ServiceTypesController {
  constructor(private readonly serviceTypes: ServiceTypesService) {}

  @Get()
  list() {
    return this.serviceTypes.list();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.serviceTypes.findOne(id);
  }

  @Roles('ADMIN')
  @Post()
  create(@Body() input: CreateServiceTypeDto, @Req() req: AuthenticatedRequest, @Ip() ip: string) {
    return this.serviceTypes.create(input, { actorId: req.user.id, ipAddress: ip });
  }

  @Roles('ADMIN')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() input: UpdateServiceTypeDto,
    @Req() req: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.serviceTypes.update(id, input, { actorId: req.user.id, ipAddress: ip });
  }
}
