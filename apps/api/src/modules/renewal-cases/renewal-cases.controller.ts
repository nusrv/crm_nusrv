import { Body, Controller, Get, Ip, Param, Post, Query, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../identity/auth-user';
import { Roles } from '../../identity/roles.decorator';
import { CreateRenewalHoldDto, RenewalCaseListQueryDto } from './renewal-cases.dto';
import { RenewalCasesService } from './renewal-cases.service';

@Controller('renewal-cases')
export class RenewalCasesController {
  constructor(private readonly renewalCases: RenewalCasesService) {}

  @Get()
  list(@Query() query: RenewalCaseListQueryDto) {
    return this.renewalCases.list(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.renewalCases.findOne(id);
  }

  @Roles('ADMIN', 'ACCOUNTANT', 'IT', 'SALES_DEVELOPMENT')
  @Post(':id/holds')
  createHold(
    @Param('id') id: string,
    @Body() input: CreateRenewalHoldDto,
    @Req() req: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.renewalCases.createHold(id, input, { actorId: req.user.id, ipAddress: ip });
  }

  @Roles('ADMIN', 'ACCOUNTANT', 'IT', 'SALES_DEVELOPMENT')
  @Post(':id/holds/:holdId/release')
  releaseHold(
    @Param('id') id: string,
    @Param('holdId') holdId: string,
    @Req() req: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.renewalCases.releaseHold(id, holdId, {
      actorId: req.user.id,
      ipAddress: ip,
    });
  }
}
