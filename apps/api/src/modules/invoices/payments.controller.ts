import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { Roles } from '../../identity/roles.decorator';
import type { AuthenticatedRequest } from '../../identity/auth-user';
import { PaymentsService } from './payments.service';
@Roles('ADMIN')
@Controller('invoices/:invoiceId/payments')
export class PaymentsController {
 constructor(private readonly payments: PaymentsService) {}
 @Get() list(@Param('invoiceId') id: string) { return this.payments.list(id); }
 @Post() record(@Param('invoiceId') id: string, @Body() input: unknown, @Req() req: AuthenticatedRequest) { return this.payments.record(id,input,req.user.id); }
 @Post(':paymentId/receipt') receipt(@Param('invoiceId') id: string, @Param('paymentId') payment: string, @Req() req: AuthenticatedRequest) { return this.payments.receipt(id,payment,req.user.id); }
 @Get(':paymentId/receipt') document(@Param('invoiceId') id: string, @Param('paymentId') payment: string) { return this.payments.getReceipt(id,payment); }
 @Patch(':paymentId/receipt') correct(@Param('invoiceId') id: string, @Param('paymentId') payment: string, @Body() input: unknown, @Req() req: AuthenticatedRequest) { return this.payments.correct(id, payment, input, req.user.id, false); }
 @Post(':paymentId/receipt/void') voidReceipt(@Param('invoiceId') id: string, @Param('paymentId') payment: string, @Body() input: unknown, @Req() req: AuthenticatedRequest) { return this.payments.correct(id, payment, input, req.user.id, true); }
}

@Roles('ADMIN')
@Controller('customers/:customerId/payment-balances')
export class CustomerPaymentBalancesController {
 constructor(private readonly payments: PaymentsService) {}
 @Get() balances(@Param('customerId') id: string) { return this.payments.customerBalances(id); }
}
