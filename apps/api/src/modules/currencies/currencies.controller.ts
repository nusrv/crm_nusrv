import { Body, Controller, Get, Ip, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../identity/auth-user';
import { Roles } from '../../identity/roles.decorator';
import { CreateCurrencyDto, CurrencyListQueryDto, UpdateCurrencyDto } from './currencies.dto';
import { CurrenciesService } from './currencies.service';

@Controller('currencies')
export class CurrenciesController {
  constructor(private readonly currencies: CurrenciesService) {}

  @Get()
  list(@Query() query: CurrencyListQueryDto) {
    return this.currencies.list(query);
  }

  @Roles('ADMIN')
  @Post()
  create(@Body() input: CreateCurrencyDto, @Req() request: AuthenticatedRequest, @Ip() ip: string) {
    return this.currencies.create(input, { actorId: request.user.id, ipAddress: ip });
  }

  @Roles('ADMIN')
  @Patch(':code')
  update(
    @Param('code') code: string,
    @Body() input: UpdateCurrencyDto,
    @Req() request: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.currencies.update(code, input, { actorId: request.user.id, ipAddress: ip });
  }
}
