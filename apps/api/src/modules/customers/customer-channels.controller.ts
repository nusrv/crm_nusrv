import { Body, Controller, Get, Ip, Param, Patch, Post, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../identity/auth-user';
import { Roles } from '../../identity/roles.decorator';
import { CustomerChannelsService } from './customer-channels.service';
import {
  CreateCustomerEmailAddressDto,
  CreateCustomerPhoneNumberDto,
  UpdateCustomerEmailAddressDto,
  UpdateCustomerPhoneNumberDto,
} from './customers.dto';

@Controller('customers/:customerId/channels')
export class CustomerChannelsController {
  constructor(private readonly channels: CustomerChannelsService) {}

  @Get()
  list(@Param('customerId') customerId: string) {
    return this.channels.list(customerId);
  }

  @Roles('ADMIN', 'SALES_DEVELOPMENT')
  @Post('emails')
  createEmail(
    @Param('customerId') customerId: string,
    @Body() input: CreateCustomerEmailAddressDto,
    @Req() request: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.channels.createEmail(customerId, input, {
      actorId: request.user.id,
      ipAddress: ip,
    });
  }

  @Roles('ADMIN', 'SALES_DEVELOPMENT')
  @Patch('emails/:emailId')
  updateEmail(
    @Param('customerId') customerId: string,
    @Param('emailId') emailId: string,
    @Body() input: UpdateCustomerEmailAddressDto,
    @Req() request: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.channels.updateEmail(customerId, emailId, input, {
      actorId: request.user.id,
      ipAddress: ip,
    });
  }

  @Roles('ADMIN', 'SALES_DEVELOPMENT')
  @Post('phones')
  createPhone(
    @Param('customerId') customerId: string,
    @Body() input: CreateCustomerPhoneNumberDto,
    @Req() request: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.channels.createPhone(customerId, input, {
      actorId: request.user.id,
      ipAddress: ip,
    });
  }

  @Roles('ADMIN', 'SALES_DEVELOPMENT')
  @Patch('phones/:phoneId')
  updatePhone(
    @Param('customerId') customerId: string,
    @Param('phoneId') phoneId: string,
    @Body() input: UpdateCustomerPhoneNumberDto,
    @Req() request: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.channels.updatePhone(customerId, phoneId, input, {
      actorId: request.user.id,
      ipAddress: ip,
    });
  }
}
