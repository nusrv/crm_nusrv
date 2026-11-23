import { FawtaraSubmissionService } from './fawtara-submission.service';
import { BadRequestException, Body, Controller, Get, Ip, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../identity/auth-user';
import { Roles } from '../../identity/roles.decorator';
import {
  CreateManualInvoiceDto,
  InvoiceListQueryDto,
  InvoiceReasonDto,
  OfficializeInvoiceDto,
  SubmitOfficialInvoiceDto,
  RecordFawtaraRejectionDto,
  UpdateInvoiceDraftDto,
} from './invoices.dto';
import { InvoicesService } from './invoices.service';

@Roles('ADMIN', 'ACCOUNTANT')
@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly submissions: FawtaraSubmissionService,
  ) {}

  @Get()
  list(@Query() query: InvoiceListQueryDto) {
    return this.invoices.list(query);
  }

  @Get(':id/submissions')
  history(@Param('id') id: string) {
    return this.submissions.history(id);
  }

  @Post(':id/submit-official')
  submit(
    @Param('id') id: string,
    @Body() input: SubmitOfficialInvoiceDto,
    @Req() req: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    // Retain the route contract for compatibility while blocking all outbound submission.
    void id; void input; void req; void ip;
    throw new BadRequestException('JoFotara API submission is deferred. Record the externally issued official invoice instead.');
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.invoices.findOne(id);
  }

  @Post('from-subscription/:subscriptionId')
  createFromSubscription(
    @Param('subscriptionId') subscriptionId: string,
    @Req() req: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.invoices.createFromSubscription(subscriptionId, {
      actorId: req.user.id,
      ipAddress: ip,
    });
  }

  @Post('from-renewal/:caseId')
  @Roles('ADMIN')
  createForRenewal(@Param('caseId') caseId: string, @Req() req: AuthenticatedRequest, @Ip() ip: string) {
    return this.invoices.createForRenewal(caseId, { actorId: req.user.id, ipAddress: ip });
  }

  @Post('manual-draft')
  @Roles('ADMIN')
  createManualDraft(@Body() input: CreateManualInvoiceDto, @Req() req: AuthenticatedRequest, @Ip() ip: string) {
    return this.invoices.createManualDraft(input, { actorId: req.user.id, ipAddress: ip });
  }

  @Patch(':id')
  updateDraft(
    @Param('id') id: string,
    @Body() input: UpdateInvoiceDraftDto,
    @Req() req: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.invoices.updateDraft(id, input, { actorId: req.user.id, ipAddress: ip });
  }

  @Post(':id/cancel-draft')
  cancelDraft(
    @Param('id') id: string,
    @Body() input: InvoiceReasonDto,
    @Req() req: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.invoices.cancelDraft(id, input.reason, { actorId: req.user.id, ipAddress: ip });
  }

  @Post(':id/reconcile')
  reconcile(
    @Param('id') id: string,
    @Body() input: InvoiceReasonDto,
    @Req() req: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.invoices.reconcile(id, input.reason, { actorId: req.user.id, ipAddress: ip });
  }

  @Post(':id/preflight')
  preflight(@Param('id') id: string) {
    return this.invoices.preflight(id);
  }

  @Post(':id/mark-ready')
  markReady(@Param('id') id: string, @Req() req: AuthenticatedRequest, @Ip() ip: string) {
    return this.invoices.markReady(id, { actorId: req.user.id, ipAddress: ip });
  }

  @Post(':id/return-to-draft')
  returnToDraft(@Param('id') id: string, @Req() req: AuthenticatedRequest, @Ip() ip: string) {
    return this.invoices.returnToDraft(id, { actorId: req.user.id, ipAddress: ip });
  }

  @Post([':id/officialize', ':id/record-fawtara-result'])
  @Roles('ADMIN')
  recordFawtaraResult(
    @Param('id') id: string,
    @Body() input: OfficializeInvoiceDto,
    @Req() req: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.invoices.recordFawtaraResult(id, input, {
      actorId: req.user.id,
      ipAddress: ip,
    });
  }

  @Post(':id/record-fawtara-rejection')
  recordFawtaraRejection(
    @Param('id') id: string,
    @Body() input: RecordFawtaraRejectionDto,
    @Req() req: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.invoices.recordFawtaraRejection(id, input, {
      actorId: req.user.id,
      ipAddress: ip,
    });
  }
}
