import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import type { MutationContext } from '../../common/mutation-context';
import { pageMetadata } from '../../common/page-query.dto';
import { throwMappedPrismaError } from '../../common/prisma-errors';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { ActorType, InvoiceStatus, SubscriptionStatus } from '../../generated/prisma/enums';
import { BusinessTimeService } from '../../time/business-time.service';
import { ClockService } from '../../time/clock.service';
import { InvoicePreflightService } from './invoice-preflight.service';
import { calculateInvoice, moneyEqual, type InvoiceLineCalculationInput } from './invoice-money';
import type {
  InvoiceLineInputDto,
  InvoiceListQueryDto,
  RecordFawtaraRejectionDto,
  RecordFawtaraResultDto,
  UpdateInvoiceDraftDto,
} from './invoices.dto';

const invoiceInclude = {
  lines: { orderBy: { position: 'asc' as const } },
  customer: { select: { id: true, customerCode: true, nameEn: true, nameAr: true } },
  billingEntity: { select: { id: true, code: true, name: true } },
  sourceSubscription: {
    select: { id: true, subscriptionCode: true, name: true, status: true },
  },
} as const;

type InvoiceWithLines = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly businessTime: BusinessTimeService,
    private readonly preflightService: InvoicePreflightService,
  ) {}

  async list(query: InvoiceListQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.InvoiceWhereInput = {
      status: query.status,
      customerId: query.customerId,
      sourceSubscriptionId: query.subscriptionId,
      ...(search
        ? {
            OR: [
              { internalReference: { contains: search } },
              { fawtaraInvoiceNumber: { contains: search } },
              { customerCodeSnapshot: { contains: search } },
              { customerNameEnSnapshot: { contains: search } },
              { customerNameArSnapshot: { contains: search } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        include: invoiceInclude,
        orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return {
      data: data.map((invoice) => this.toView(invoice)),
      meta: pageMetadata(total, query.page, query.pageSize),
    };
  }

  async findOne(id: string) {
    return this.toView(await this.requireInvoice(id));
  }

  async createFromSubscription(subscriptionId: string, context: MutationContext) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        customer: {
          include: {
            billingEntity: true,
            phoneNumbers: {
              where: { active: true },
              orderBy: [{ primary: 'desc' }, { createdAt: 'asc' }],
              take: 1,
            },
          },
        },
        serviceType: true,
        servicePackage: true,
        identifiers: { where: { active: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!subscription) throw new NotFoundException('Subscription not found.');
    if (subscription.status !== SubscriptionStatus.ACTIVE) {
      throw new BadRequestException('An invoice can only be created from an ACTIVE subscription.');
    }
    if (subscription.customer.status !== 'ACTIVE') {
      throw new BadRequestException('An invoice cannot be created for an inactive customer.');
    }

    const periodStart = subscription.startDate;
    const periodEnd = subscription.currentTermEndDate ?? subscription.renewalDate;
    this.assertPeriod(periodStart, periodEnd);
    const activeDraftKey = this.activeDraftKey(subscription.id, periodStart, periodEnd);
    const duplicate = await this.prisma.invoice.findUnique({ where: { activeDraftKey } });
    if (duplicate) {
      throw new ConflictException(
        `An active invoice draft already exists for this subscription and service period (${duplicate.internalReference}).`,
      );
    }

    const invoiceDate = this.businessTime.businessDate(this.clock.now());
    const lineInput: InvoiceLineCalculationInput = {
      description: subscription.description?.trim() || subscription.name,
      quantity: '1',
      unitPrice: subscription.sellingPrice.toString(),
      discountAmount: '0',
      // Deliberately absent: a human must explicitly review tax category and rate before READY.
      taxCategoryCode: null,
      taxRate: null,
      periodStart,
      periodEnd,
      sourceSubscriptionId: subscription.id,
      serviceTypeSnapshot: subscription.serviceType.name,
      packageSnapshot: subscription.servicePackage?.name ?? subscription.packageNameSnapshot,
      serviceSnapshotText: subscription.name,
      identifiersSnapshotJson: subscription.identifiers.map((identifier) => ({
        type: identifier.type,
        value: identifier.value,
        label: identifier.label,
      })),
    };
    const calculated = calculateInvoice([lineInput]);
    const billingEntity = subscription.customer.billingEntity;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const sequence = await tx.invoiceSequence.upsert({
          where: {
            billingEntityId_year: {
              billingEntityId: billingEntity.id,
              year: invoiceDate.getUTCFullYear(),
            },
          },
          create: {
            billingEntityId: billingEntity.id,
            year: invoiceDate.getUTCFullYear(),
            lastValue: 1,
          },
          update: { lastValue: { increment: 1 } },
        });
        const internalReference = `${billingEntity.code}-INV-${sequence.year}-${String(sequence.lastValue).padStart(6, '0')}`;
        const line = calculated.lines[0]!;
        const invoice = await tx.invoice.create({
          data: {
            customerId: subscription.customerId,
            billingEntityId: billingEntity.id,
            sourceSubscriptionId: subscription.id,
            internalReference,
            activeDraftKey,
            invoiceDate,
            currencyCode: subscription.currency,
            periodStart,
            periodEnd,
            customerCodeSnapshot: subscription.customer.customerCode,
            customerNameEnSnapshot: subscription.customer.nameEn,
            customerNameArSnapshot: subscription.customer.nameAr,
            customerAddressSnapshot: subscription.customer.address,
            customerCountrySnapshot: subscription.customer.country,
            customerPhoneSnapshot:
              subscription.customer.phoneNumbers[0]?.phoneNumber ?? subscription.customer.phone,
            customerTaxNumberSnapshot: subscription.customer.taxNumber,
            issuerCodeSnapshot: billingEntity.code,
            issuerLegalNameSnapshot: billingEntity.legalName,
            // BillingEntity has no Arabic legal-name field yet; absence remains explicit.
            issuerLegalNameArSnapshot: null,
            issuerTaxNumberSnapshot: billingEntity.taxNumber,
            issuerAddressSnapshot: billingEntity.address,
            issuerInvoiceEmailSnapshot: billingEntity.invoiceEmail,
            // The existing BillingEntity field is encrypted and not operationally exposed. Never
            // copy ciphertext into a printable invoice snapshot.
            issuerBankDetailsSnapshot: null,
            subtotal: calculated.subtotal,
            discountTotal: calculated.discountTotal,
            taxTotal: calculated.taxTotal,
            grandTotal: calculated.grandTotal,
            lines: {
              create: {
                sourceSubscriptionId: subscription.id,
                position: line.position,
                description: line.description,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                discountAmount: line.discountAmount,
                taxCategoryCode: null,
                taxRate: null,
                lineSubtotal: line.lineSubtotal,
                taxAmount: line.taxAmount,
                lineTotal: line.lineTotal,
                serviceTypeSnapshot: line.serviceTypeSnapshot,
                packageSnapshot: line.packageSnapshot,
                serviceSnapshotText: line.serviceSnapshotText,
                identifiersSnapshotJson:
                  line.identifiersSnapshotJson == null
                    ? undefined
                    : (line.identifiersSnapshotJson as Prisma.InputJsonValue),
                periodStart,
                periodEnd,
              },
            },
          },
          include: invoiceInclude,
        });
        await this.audit.record(
          {
            actorType: ActorType.USER,
            actorId: context.actorId,
            eventKey: 'invoice.created_from_subscription',
            subjectType: 'Invoice',
            subjectId: invoice.id,
            newState: this.auditSnapshot(invoice),
            metadata: { sourceSubscriptionId: subscription.id },
            ipAddress: context.ipAddress,
          },
          tx,
        );
        return this.toView(invoice);
      });
    } catch (error) {
      throwMappedPrismaError(error);
    }
  }

  async updateDraft(id: string, input: UpdateInvoiceDraftDto, context: MutationContext) {
    const oldState = await this.requireInvoice(id);
    this.requireStatus(oldState, InvoiceStatus.DRAFT, 'Only a DRAFT invoice can be edited.');

    const invoiceDate = input.invoiceDate ? new Date(input.invoiceDate) : oldState.invoiceDate;
    const periodStart = input.periodStart ? new Date(input.periodStart) : oldState.periodStart;
    const periodEnd = input.periodEnd ? new Date(input.periodEnd) : oldState.periodEnd;
    this.assertPeriod(periodStart, periodEnd);

    const lines = input.lines
      ? input.lines.map((line, index) =>
          this.toCalculationInput(
            line,
            oldState.lines[index],
            oldState.sourceSubscriptionId,
            periodStart,
            periodEnd,
          ),
        )
      : oldState.lines.map((line) => ({
          description: line.description,
          quantity: line.quantity.toString(),
          unitPrice: line.unitPrice.toString(),
          discountAmount: line.discountAmount.toString(),
          taxCategoryCode: line.taxCategoryCode,
          taxRate: line.taxRate?.toString() ?? null,
          periodStart: line.periodStart,
          periodEnd: line.periodEnd,
          sourceSubscriptionId: line.sourceSubscriptionId,
          serviceTypeSnapshot: line.serviceTypeSnapshot,
          packageSnapshot: line.packageSnapshot,
          serviceSnapshotText: line.serviceSnapshotText,
          identifiersSnapshotJson: line.identifiersSnapshotJson,
        }));
    const calculated = calculateInvoice(lines);
    const activeDraftKey = this.activeDraftKey(
      oldState.sourceSubscriptionId,
      periodStart,
      periodEnd,
    );

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
        const invoice = await tx.invoice.update({
          where: { id },
          data: {
            invoiceDate,
            periodStart,
            periodEnd,
            activeDraftKey,
            customerNameEnSnapshot: this.optionalText(input.customerNameEn),
            customerNameArSnapshot: this.optionalText(input.customerNameAr),
            customerAddressSnapshot: this.optionalText(input.customerAddress),
            customerCountrySnapshot: this.optionalText(input.customerCountry),
            customerPhoneSnapshot: this.optionalText(input.customerPhone),
            customerTaxNumberSnapshot: this.optionalText(input.customerTaxNumber),
            subtotal: calculated.subtotal,
            discountTotal: calculated.discountTotal,
            taxTotal: calculated.taxTotal,
            grandTotal: calculated.grandTotal,
            lines: {
              create: calculated.lines.map((line) => ({
                sourceSubscriptionId: line.sourceSubscriptionId,
                position: line.position,
                description: line.description,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                discountAmount: line.discountAmount,
                taxCategoryCode: this.cleanText(line.taxCategoryCode),
                taxRate: line.taxRate,
                lineSubtotal: line.lineSubtotal,
                taxAmount: line.taxAmount,
                lineTotal: line.lineTotal,
                serviceTypeSnapshot: line.serviceTypeSnapshot,
                packageSnapshot: line.packageSnapshot,
                serviceSnapshotText: line.serviceSnapshotText,
                identifiersSnapshotJson: line.identifiersSnapshotJson as Prisma.InputJsonValue,
                periodStart: line.periodStart ? new Date(line.periodStart) : null,
                periodEnd: line.periodEnd ? new Date(line.periodEnd) : null,
              })),
            },
          },
          include: invoiceInclude,
        });
        await this.audit.record(
          {
            actorType: ActorType.USER,
            actorId: context.actorId,
            eventKey: 'invoice.draft_updated',
            subjectType: 'Invoice',
            subjectId: id,
            oldState: this.auditSnapshot(oldState),
            newState: this.auditSnapshot(invoice),
            ipAddress: context.ipAddress,
          },
          tx,
        );
        return this.toView(invoice);
      });
    } catch (error) {
      throwMappedPrismaError(error);
    }
  }

  async preflight(id: string) {
    return this.preflightService.validate(await this.requireInvoice(id));
  }

  async markReady(id: string, context: MutationContext) {
    const oldState = await this.requireInvoice(id);
    this.requireStatus(oldState, InvoiceStatus.DRAFT, 'Only a DRAFT invoice can be marked ready.');
    const preflight = this.preflightService.validate(oldState);
    if (!preflight.valid) {
      throw new BadRequestException({
        message: 'Invoice preflight has blocking failures.',
        preflight,
      });
    }
    return this.transitionStatus(
      oldState,
      InvoiceStatus.READY_FOR_FAWTARA,
      'invoice.marked_ready_for_fawtara',
      context,
    );
  }

  async returnToDraft(id: string, context: MutationContext) {
    const oldState = await this.requireInvoice(id);
    if (
      oldState.status !== InvoiceStatus.READY_FOR_FAWTARA &&
      oldState.status !== InvoiceStatus.FAWTARA_REJECTED
    ) {
      throw new BadRequestException(
        'Only a READY or FAWTARA_REJECTED invoice can return to DRAFT.',
      );
    }
    const activeDraftKey = this.activeDraftKey(
      oldState.sourceSubscriptionId,
      oldState.periodStart,
      oldState.periodEnd,
    );
    return this.transitionStatus(
      oldState,
      InvoiceStatus.DRAFT,
      'invoice.returned_to_draft',
      context,
      { activeDraftKey },
    );
  }

  async recordFawtaraResult(id: string, input: RecordFawtaraResultDto, context: MutationContext) {
    const oldState = await this.requireInvoice(id);
    this.requireStatus(
      oldState,
      InvoiceStatus.READY_FOR_FAWTARA,
      'Only a READY_FOR_FAWTARA invoice can be officialized.',
    );
    if (!input.qrPayload?.trim() && !input.qrImageDataUrl?.trim()) {
      throw new BadRequestException('Record the official JoFotara QR payload or QR image.');
    }
    const acceptedAt = new Date(input.acceptedAt);
    if (!Number.isFinite(acceptedAt.getTime())) {
      throw new BadRequestException('A valid JoFotara acceptance date is required.');
    }

    const officialValues = {
      currencyCode: input.officialCurrencyCode ?? null,
      subtotal: input.officialSubtotal ?? null,
      discountTotal: input.officialDiscountTotal ?? null,
      taxTotal: input.officialTaxTotal ?? null,
      grandTotal: input.officialGrandTotal ?? null,
    };
    const discrepancies = this.officialDiscrepancies(oldState, officialValues);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const changed = await tx.invoice.updateMany({
          where: { id, status: InvoiceStatus.READY_FOR_FAWTARA },
          data: {
            status: InvoiceStatus.FAWTARA_ACCEPTED,
            activeDraftKey: null,
            fawtaraStatus: input.fawtaraStatus,
            fawtaraInvoiceNumber: input.invoiceNumber.trim(),
            fawtaraInvoiceUuid: this.cleanText(input.invoiceUuid),
            fawtaraQrPayload: this.cleanText(input.qrPayload),
            fawtaraQrImageDataUrl: this.cleanText(input.qrImageDataUrl),
            fawtaraSubmittedAt: acceptedAt,
            fawtaraAcceptedAt: acceptedAt,
            latestFawtaraMessage: input.note?.trim() || 'JoFotara acceptance recorded manually.',
            // Only normalized DTO fields are stored. Manual entry cannot persist a raw response
            // object that might contain future Client-Id/Secret-Key headers.
            latestFawtaraResultJson: {
              source: 'MANUAL',
              recordedStatus: input.fawtaraStatus,
            },
            officialCurrencyCode: officialValues.currencyCode,
            officialSubtotal: officialValues.subtotal,
            officialDiscountTotal: officialValues.discountTotal,
            officialTaxTotal: officialValues.taxTotal,
            officialGrandTotal: officialValues.grandTotal,
            officializationNote: this.cleanText(input.note),
          },
        });
        if (changed.count !== 1) {
          throw new ConflictException('Invoice status changed concurrently. Reload and try again.');
        }
        const invoice = await tx.invoice.findUniqueOrThrow({
          where: { id },
          include: invoiceInclude,
        });
        await this.audit.record(
          {
            actorType: ActorType.USER,
            actorId: context.actorId,
            eventKey: 'invoice.fawtara_result_recorded',
            subjectType: 'Invoice',
            subjectId: id,
            oldState: this.auditSnapshot(oldState),
            newState: this.auditSnapshot(invoice),
            metadata: {
              source: 'MANUAL',
              discrepancies,
              hasQrPayload: Boolean(input.qrPayload),
              hasQrImage: Boolean(input.qrImageDataUrl),
            },
            ipAddress: context.ipAddress,
          },
          tx,
        );
        return this.toView(invoice);
      });
    } catch (error) {
      throwMappedPrismaError(error);
    }
  }

  async recordFawtaraRejection(
    id: string,
    input: RecordFawtaraRejectionDto,
    context: MutationContext,
  ) {
    const oldState = await this.requireInvoice(id);
    this.requireStatus(
      oldState,
      InvoiceStatus.READY_FOR_FAWTARA,
      'Only a READY_FOR_FAWTARA invoice can record a rejection.',
    );
    try {
      return await this.prisma.$transaction(async (tx) => {
        const changed = await tx.invoice.updateMany({
          where: { id, status: InvoiceStatus.READY_FOR_FAWTARA },
          data: {
            status: InvoiceStatus.FAWTARA_REJECTED,
            activeDraftKey: null,
            fawtaraStatus: 'NOT_SUBMITTED',
            latestFawtaraMessage: input.message.trim(),
            latestFawtaraResultJson: {
              source: 'MANUAL',
              recordedStatus: 'NOT_SUBMITTED',
            },
          },
        });
        if (changed.count !== 1) {
          throw new ConflictException('Invoice status changed concurrently. Reload and try again.');
        }
        const invoice = await tx.invoice.findUniqueOrThrow({
          where: { id },
          include: invoiceInclude,
        });
        await this.audit.record(
          {
            actorType: ActorType.USER,
            actorId: context.actorId,
            eventKey: 'invoice.fawtara_rejection_recorded',
            subjectType: 'Invoice',
            subjectId: id,
            oldState: this.auditSnapshot(oldState),
            newState: this.auditSnapshot(invoice),
            metadata: { source: 'MANUAL' },
            ipAddress: context.ipAddress,
          },
          tx,
        );
        return this.toView(invoice);
      });
    } catch (error) {
      throwMappedPrismaError(error);
    }
  }

  private async transitionStatus(
    oldState: InvoiceWithLines,
    status: InvoiceStatus,
    eventKey: string,
    context: MutationContext,
    extraData: Prisma.InvoiceUpdateManyMutationInput = {},
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const changed = await tx.invoice.updateMany({
          where: { id: oldState.id, status: oldState.status },
          data: { status, ...extraData },
        });
        if (changed.count !== 1) {
          throw new ConflictException('Invoice status changed concurrently. Reload and try again.');
        }
        const invoice = await tx.invoice.findUniqueOrThrow({
          where: { id: oldState.id },
          include: invoiceInclude,
        });
        await this.audit.record(
          {
            actorType: ActorType.USER,
            actorId: context.actorId,
            eventKey,
            subjectType: 'Invoice',
            subjectId: invoice.id,
            oldState: this.auditSnapshot(oldState),
            newState: this.auditSnapshot(invoice),
            ipAddress: context.ipAddress,
          },
          tx,
        );
        return this.toView(invoice);
      });
    } catch (error) {
      throwMappedPrismaError(error);
    }
  }

  private async requireInvoice(id: string): Promise<InvoiceWithLines> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: invoiceInclude,
    });
    if (!invoice) throw new NotFoundException('Invoice not found.');
    return invoice;
  }

  private requireStatus(invoice: InvoiceWithLines, status: InvoiceStatus, message: string) {
    if (invoice.status !== status) throw new BadRequestException(message);
  }

  private toCalculationInput(
    input: InvoiceLineInputDto,
    existing: InvoiceWithLines['lines'][number] | undefined,
    sourceSubscriptionId: string,
    invoicePeriodStart: Date,
    invoicePeriodEnd: Date,
  ): InvoiceLineCalculationInput {
    return {
      ...input,
      description: input.description.trim(),
      discountAmount: input.discountAmount || '0',
      taxCategoryCode: this.cleanText(input.taxCategoryCode),
      taxRate: input.taxRate ?? null,
      periodStart: input.periodStart ? new Date(input.periodStart) : invoicePeriodStart,
      periodEnd: input.periodEnd ? new Date(input.periodEnd) : invoicePeriodEnd,
      sourceSubscriptionId: existing?.sourceSubscriptionId ?? sourceSubscriptionId,
      serviceTypeSnapshot: existing?.serviceTypeSnapshot,
      packageSnapshot: existing?.packageSnapshot,
      serviceSnapshotText: existing?.serviceSnapshotText,
      identifiersSnapshotJson: existing?.identifiersSnapshotJson,
    };
  }

  private activeDraftKey(subscriptionId: string, start: Date, end: Date) {
    return `${subscriptionId}:${this.dateKey(start)}:${this.dateKey(end)}`;
  }

  private dateKey(date: Date) {
    return date.toISOString().slice(0, 10);
  }

  private assertPeriod(start: Date, end: Date) {
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) {
      throw new BadRequestException('Service period end must be after its start date.');
    }
  }

  private optionalText(value: string | undefined) {
    return value === undefined ? undefined : this.cleanText(value);
  }

  private cleanText(value: string | null | undefined): string | null {
    const cleaned = value?.trim();
    return cleaned ? cleaned : null;
  }

  private officialDiscrepancies(
    invoice: InvoiceWithLines,
    official: {
      currencyCode: string | null;
      subtotal: string | null;
      discountTotal: string | null;
      taxTotal: string | null;
      grandTotal: string | null;
    },
  ) {
    const discrepancies: Array<{ field: string; crm: string; official: string }> = [];
    if (official.currencyCode && official.currencyCode !== invoice.currencyCode) {
      discrepancies.push({
        field: 'currencyCode',
        crm: invoice.currencyCode,
        official: official.currencyCode,
      });
    }
    for (const [field, crm, value] of [
      ['subtotal', invoice.subtotal, official.subtotal],
      ['discountTotal', invoice.discountTotal, official.discountTotal],
      ['taxTotal', invoice.taxTotal, official.taxTotal],
      ['grandTotal', invoice.grandTotal, official.grandTotal],
    ] as const) {
      if (value !== null && !moneyEqual(crm, value)) {
        discrepancies.push({ field, crm: crm.toString(), official: value });
      }
    }
    return discrepancies;
  }

  private auditSnapshot(invoice: InvoiceWithLines) {
    return {
      id: invoice.id,
      status: invoice.status,
      internalReference: invoice.internalReference,
      invoiceDate: invoice.invoiceDate,
      currencyCode: invoice.currencyCode,
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd,
      customerSnapshot: {
        code: invoice.customerCodeSnapshot,
        nameEn: invoice.customerNameEnSnapshot,
        nameAr: invoice.customerNameArSnapshot,
        taxNumber: invoice.customerTaxNumberSnapshot,
      },
      issuerSnapshot: {
        code: invoice.issuerCodeSnapshot,
        legalName: invoice.issuerLegalNameSnapshot,
        taxNumber: invoice.issuerTaxNumberSnapshot,
      },
      totals: {
        subtotal: invoice.subtotal,
        discountTotal: invoice.discountTotal,
        taxTotal: invoice.taxTotal,
        grandTotal: invoice.grandTotal,
      },
      fawtara: {
        status: invoice.fawtaraStatus,
        invoiceNumber: invoice.fawtaraInvoiceNumber,
        invoiceUuid: invoice.fawtaraInvoiceUuid,
        acceptedAt: invoice.fawtaraAcceptedAt,
        officialCurrencyCode: invoice.officialCurrencyCode,
        officialSubtotal: invoice.officialSubtotal,
        officialDiscountTotal: invoice.officialDiscountTotal,
        officialTaxTotal: invoice.officialTaxTotal,
        officialGrandTotal: invoice.officialGrandTotal,
        hasQrPayload: Boolean(invoice.fawtaraQrPayload),
        hasQrImage: Boolean(invoice.fawtaraQrImageDataUrl),
      },
      lines: invoice.lines.map((line) => ({
        position: line.position,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountAmount: line.discountAmount,
        taxCategoryCode: line.taxCategoryCode,
        taxRate: line.taxRate,
        lineSubtotal: line.lineSubtotal,
        taxAmount: line.taxAmount,
        lineTotal: line.lineTotal,
      })),
    };
  }

  private toView(invoice: InvoiceWithLines) {
    const discrepancies = this.officialDiscrepancies(invoice, {
      currencyCode: invoice.officialCurrencyCode,
      subtotal: invoice.officialSubtotal?.toString() ?? null,
      discountTotal: invoice.officialDiscountTotal?.toString() ?? null,
      taxTotal: invoice.officialTaxTotal?.toString() ?? null,
      grandTotal: invoice.officialGrandTotal?.toString() ?? null,
    });
    return {
      ...invoice,
      effectiveCurrencyCode: invoice.officialCurrencyCode ?? invoice.currencyCode,
      effectiveSubtotal: invoice.officialSubtotal ?? invoice.subtotal,
      effectiveDiscountTotal: invoice.officialDiscountTotal ?? invoice.discountTotal,
      effectiveTaxTotal: invoice.officialTaxTotal ?? invoice.taxTotal,
      effectiveGrandTotal: invoice.officialGrandTotal ?? invoice.grandTotal,
      officialValueDiscrepancies: discrepancies,
      locked: invoice.status === InvoiceStatus.FAWTARA_ACCEPTED,
    };
  }
}
