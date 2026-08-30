import { Body, Controller, Delete, Get, Ip, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../identity/auth-user';
import { Roles } from '../../identity/roles.decorator';
import {
  CreateCustomerContactDto,
  CreateCustomerDto,
  CustomerListQueryDto,
  UpdateCustomerContactDto,
  UpdateCustomerDto,
} from './customers.dto';
import { CustomersService } from './customers.service';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(@Query() query: CustomerListQueryDto) {
    return this.customers.list(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.customers.findOne(id);
  }

  @Roles('ADMIN', 'SALES_DEVELOPMENT')
  @Post()
  create(@Body() input: CreateCustomerDto, @Req() request: AuthenticatedRequest, @Ip() ip: string) {
    return this.customers.create(input, { actorId: request.user.id, ipAddress: ip });
  }

  @Roles('ADMIN', 'SALES_DEVELOPMENT')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() input: UpdateCustomerDto,
    @Req() request: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.customers.update(id, input, { actorId: request.user.id, ipAddress: ip });
  }

  @Roles('ADMIN', 'SALES_DEVELOPMENT')
  @Post(':id/contacts')
  createContact(
    @Param('id') id: string,
    @Body() input: CreateCustomerContactDto,
    @Req() request: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.customers.createContact(id, input, { actorId: request.user.id, ipAddress: ip });
  }

  @Roles('ADMIN', 'SALES_DEVELOPMENT')
  @Patch(':id/contacts/:contactId')
  updateContact(
    @Param('id') id: string,
    @Param('contactId') contactId: string,
    @Body() input: UpdateCustomerContactDto,
    @Req() request: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.customers.updateContact(id, contactId, input, {
      actorId: request.user.id,
      ipAddress: ip,
    });
  }

  @Roles('ADMIN')
  @Post(':id/deactivate')
  deactivate(@Param('id') id: string, @Req() request: AuthenticatedRequest, @Ip() ip: string) {
    return this.customers.deactivate(id, { actorId: request.user.id, ipAddress: ip });
  }

  @Roles('ADMIN')
  @Delete(':id')
  deleteCustomer(@Param('id') id: string, @Req() request: AuthenticatedRequest, @Ip() ip: string) {
    return this.customers.deleteCustomer(id, { actorId: request.user.id, ipAddress: ip });
  }
}
