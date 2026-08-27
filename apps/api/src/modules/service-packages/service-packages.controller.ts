import { Body, Controller, Get, Ip, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../identity/auth-user';
import { Roles } from '../../identity/roles.decorator';
import { CreateServicePackageDto, UpdateServicePackageDto } from './service-packages.dto';
import { ServicePackagesService } from './service-packages.service';

@Controller('service-packages')
export class ServicePackagesController {
  constructor(private readonly packages: ServicePackagesService) {}

  @Get()
  list(@Query('serviceTypeId') serviceTypeId?: string, @Query('active') active?: string) {
    return this.packages.list(
      serviceTypeId,
      active === undefined ? undefined : active.toLowerCase() === 'true',
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.packages.findOne(id);
  }

  @Roles('ADMIN')
  @Post()
  create(
    @Body() input: CreateServicePackageDto,
    @Req() req: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.packages.create(input, { actorId: req.user.id, ipAddress: ip });
  }

  @Roles('ADMIN')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() input: UpdateServicePackageDto,
    @Req() req: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.packages.update(id, input, { actorId: req.user.id, ipAddress: ip });
  }
}
