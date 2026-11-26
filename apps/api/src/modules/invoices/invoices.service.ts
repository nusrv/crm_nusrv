import { readIssuerPresentation } from '@cp/shared';
import {
  snapshotPresentation,
  visibilitySchema,
} from '../invoice-branding/invoice-branding.schema';
import { isManualQrImage } from './manual-qr';
import { SecretEncryptionService } from '../../security/secret-encryption.service';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FawtaraMapper } from './fawtara-mapper';
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
import { isVerifiedOfficialInvoice, officialInvoiceEvidence } from './official-invoice-eligibility';
import { acceptedRenewalPeriod, lockAcceptedRenewal } from '../renewal-cases/accepted-renewal-invoice';
import type {
  CreateManualInvoiceDto,
  InvoiceLineInputDto,
  InvoiceListQueryDto,
  RecordFawtaraRejectionDto,
  RecordFawtaraResultDto,
  UpdateInvoiceDraftDto,
} from './invoices.dto';

const invoiceInclude = {
  lines: { orderBy: { position: 'asc' as const } },
  customer: { select: { id: true, customerCode: true, nameEn: true, nameAr: true } },
  billingEntity: { select: { id: true, code: true, name: true, active: true, issuerType: true } },
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
    private readonly mapper: FawtaraMapper = new FawtaraMapper(),
    private readonly secrets?: SecretEncryptionService,
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
    const invoice = await this.requireInvoice(id);
    const asset = invoice.issuerLogoAssetId
      ? await this.prisma.invoiceBrandingAsset.findFirst({
          where: { id: invoice.issuerLogoAssetId, billingEntityId: invoice.billingEntityId },
          select: { bytes: true, mimeType: true },
        })
      : null;
    return {
      ...this.toView(invoice),
      issuerLogoDataUrl: asset
        ? `data:${asset.mimeType};base64,${Buffer.from(asset.bytes).toString('base64')}`
        : null,
    };
  }

  async createForRenewal(caseId: string, context: MutationContext) {
    const renewal = await this.prisma.renewalCase.findUnique({ where: { id: caseId } });
    if (!renewal) throw new NotFoundException('Renewal case not found.');
    return this.createFromSubscription(renewal.subscriptionId, context, caseId);
  }

  async createFromSubscription(subscriptionId: string, context: MutationContext, renewalCaseId?: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        customer: {
          include: {
            billingEntity: { include: { invoiceBranding: true } },
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

    const renewal = renewalCaseId
      ? await this.prisma.renewalCase.findUnique({ where: { id: renewalCaseId } })
      : null;
    if (renewalCaseId && (!renewal || renewal.subscriptionId !== subscriptionId)) {
      throw new NotFoundException('Renewal case not found.');
    }
    const proposed = renewal ? acceptedRenewalPeriod(renewal) : null;
    const periodStart = proposed?.start ?? subscription.startDate;
    const periodEnd = proposed?.end ?? subscription.currentTermEndDate ?? subscription.renewalDate;
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
        if (renewalCaseId) {
          const current = await lockAcceptedRenewal(tx, renewalCaseId, subscriptionId);
          if (
            current.period.start.getTime() !== periodStart.getTime() ||
            current.period.end.getTime() !== periodEnd.getTime() ||
            current.renewal.subscription.customerId !== subscription.customerId ||
            current.renewal.subscription.customer.billingEntityId !== billingEntity.id
          ) throw new ConflictException('Accepted renewal details changed. Reload the case.');
          const issued = await tx.invoice.findUnique({ where: { renewalOfficialKey: renewalCaseId } });
          if (issued) throw new ConflictException('An official invoice already exists for this renewal.');
        }
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
        const currentIssuer = await tx.billingEntity.update({
          where: { id: billingEntity.id },
          data: { lastInvoiceCounter: { increment: 1 } },
          include: { invoiceBranding: true },
        });
        if (!currentIssuer.active) throw new BadRequestException('Choose an active invoice issuer.');
        const presentation = snapshotPresentation(currentIssuer, currentIssuer.invoiceBranding);
        const line = calculated.lines[0]!;
        const invoice = await tx.invoice.create({
          data: {
            customerId: subscription.customerId,
            billingEntityId: billingEntity.id,
            sourceSubscriptionId: subscription.id,
            ...(renewalCaseId ? { sourceRenewalCaseId: renewalCaseId } : {}),
            internalReference,
            invoiceCounter: currentIssuer.lastInvoiceCounter,
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
            issuerCodeSnapshot: currentIssuer.code,
            issuerLegalNameSnapshot: currentIssuer.legalName,
            // BillingEntity has no Arabic legal-name field yet; absence remains explicit.
            issuerLegalNameArSnapshot: currentIssuer.legalNameAr ?? null,
            issuerCountryCodeSnapshot: currentIssuer.countryCode ?? null,
            issuerPresentationSnapshot: presentation as unknown as Prisma.InputJsonValue,
            issuerLogoAssetId: presentation.logoAssetId,
            issuerTaxNumberSnapshot: currentIssuer.taxNumber,
            issuerAddressSnapshot: currentIssuer.address,
            issuerInvoiceEmailSnapshot: currentIssuer.invoiceEmail,
            // Decrypt configured bank data once into this immutable invoice snapshot.
            issuerBankDetailsSnapshot: currentIssuer.bankDetailsCiphertext
              ? this.decryptBankDetails(currentIssuer.bankDetailsCiphertext)
              : null,
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
            metadata: { sourceSubscriptionId: subscription.id, renewalCaseId },
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

  async createManualDraft(input: CreateManualInvoiceDto, context: MutationContext) {
    const invoiceDate = new Date(input.invoiceDate);
    const periodStart = new Date(input.periodStart);
    const periodEnd = new Date(input.periodEnd);
    this.assertPeriod(periodStart, periodEnd);
    if (!Number.isFinite(invoiceDate.getTime()) || !/^[A-Z]{3}$/.test(input.currencyCode) ||
        !input.lines?.length) {
      throw new BadRequestException('Supply an invoice date, currency and at least one line.');
    }
    if (!input.customerId && !this.optionalText(input.customerNameEn) && !this.optionalText(input.customerNameAr)) {
      throw new BadRequestException('Supply a one-time buyer name in English or Arabic.');
    }
    const totals = calculateInvoice(input.lines.map((line) =>
      this.toCalculationInput(line, undefined, null, periodStart, periodEnd)));
    try {
      return await this.prisma.$transaction(async (tx) => {
        const customer = input.customerId
          ? await tx.customer.findUnique({ where: { id: input.customerId }, include: {
              phoneNumbers: { where: { active: true }, orderBy: [{ primary: 'desc' }, { createdAt: 'asc' }], take: 1 },
            } })
          : null;
        if (input.customerId && (!customer || customer.billingEntityId !== input.billingEntityId ||
            customer.status !== 'ACTIVE')) {
          throw new BadRequestException('Choose an active customer belonging to the invoice issuer.');
        }
        const sequence = await tx.invoiceSequence.upsert({
          where: { billingEntityId_year: { billingEntityId: input.billingEntityId, year: invoiceDate.getUTCFullYear() } },
          create: { billingEntityId: input.billingEntityId, year: invoiceDate.getUTCFullYear(), lastValue: 1 },
          update: { lastValue: { increment: 1 } },
        });
        const issuer = await tx.billingEntity.update({
          where: { id: input.billingEntityId },
          data: { lastInvoiceCounter: { increment: 1 } },
          include: { invoiceBranding: true },
        });
        if (!issuer.active) throw new BadRequestException('Choose an active invoice issuer.');
        const presentation = snapshotPresentation(issuer, issuer.invoiceBranding);
        const invoice = await tx.invoice.create({
          data: {
            customerId: customer?.id,
            billingEntityId: issuer.id,
            internalReference: `${issuer.code}-INV-${sequence.year}-${String(sequence.lastValue).padStart(6, '0')}`,
            invoiceCounter: issuer.lastInvoiceCounter,
            invoiceDate,
            periodStart,
            periodEnd,
            currencyCode: input.currencyCode,
            customerCodeSnapshot: customer?.customerCode ?? 'ONE-TIME',
            customerNameEnSnapshot: this.optionalText(input.customerNameEn) ?? customer?.nameEn,
            customerNameArSnapshot: this.optionalText(input.customerNameAr) ?? customer?.nameAr,
            customerAddressSnapshot: this.optionalText(input.customerAddress) ?? customer?.address,
            customerCountrySnapshot: this.optionalText(input.customerCountry) ?? customer?.country,
            customerPhoneSnapshot: this.optionalText(input.customerPhone) ?? customer?.phoneNumbers[0]?.phoneNumber ?? customer?.phone,
            customerTaxNumberSnapshot: this.optionalText(input.customerTaxNumber) ?? customer?.taxNumber,
            issuerCodeSnapshot: issuer.code,
            issuerLegalNameSnapshot: issuer.legalName,
            issuerLegalNameArSnapshot: issuer.legalNameAr,
            issuerCountryCodeSnapshot: issuer.countryCode,
            issuerPresentationSnapshot: presentation as unknown as Prisma.InputJsonValue,
            issuerLogoAssetId: presentation.logoAssetId,
            issuerTaxNumberSnapshot: issuer.taxNumber,
            issuerAddressSnapshot: issuer.address,
            issuerInvoiceEmailSnapshot: issuer.invoiceEmail,
            issuerBankDetailsSnapshot: issuer.bankDetailsCiphertext
              ? this.decryptBankDetails(issuer.bankDetailsCiphertext)
              : null,
            subtotal: totals.subtotal,
            discountTotal: totals.discountTotal,
            taxTotal: totals.taxTotal,
            grandTotal: totals.grandTotal,
            lines: { create: totals.lines.map((line) => ({
              position: line.position,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discountAmount: line.discountAmount,
              lineSubtotal: line.lineSubtotal,
              taxAmount: line.taxAmount,
              lineTotal: line.lineTotal,
              taxCategoryCode: line.taxCategoryCode,
              taxRate: line.taxRate,
              periodStart: line.periodStart,
              periodEnd: line.periodEnd,
            })) },
          },
          include: invoiceInclude,
        });
        await this.audit.record({
          actorType: ActorType.USER,
          actorId: context.actorId,
          eventKey: 'invoice.manual_draft_created',
          subjectType: 'Invoice',
          subjectId: invoice.id,
          newState: this.auditSnapshot(invoice),
          ipAddress: context.ipAddress,
        }, tx);
        return this.toView(invoice);
      });
    } catch (error) {
      throwMappedPrismaError(error);
    }
  }

  async updateDraft(id: string, input: UpdateInvoiceDraftDto, context: MutationContext) {
    const oldState = await this.requireInvoice(id);
    this.requireStatus(oldState, InvoiceStatus.DRAFT, 'Only a DRAFT invoice can be edited.');

    let presentation = readIssuerPresentation(oldState.issuerPresentationSnapshot);
    if (input.presentationVisibility) {
      const parsed = visibilitySchema.safeParse(input.presentationVisibility);
      if (!parsed.success) throw new BadRequestException('Invalid presentation visibility fields.');
      presentation = { ...(presentation ?? snapshotPresentation({})), visibility: parsed.data };
      // Preserve the existing immutable logo reference; overrides cannot select another issuer/asset.
      presentation.logoAssetId = oldState.issuerLogoAssetId ?? null;
      if (!oldState.issuerPresentationSnapshot && oldState.issuerCodeSnapshot === 'NEW_SERVE_LOCAL')
        presentation.legacyNusrvLogo = true;
      if (
        Object.keys(input).every(
          (k) =>
            k === 'presentationVisibility' || input[k as keyof UpdateInvoiceDraftDto] === undefined,
        )
      ) {
        return this.transitionStatus(
          oldState,
          InvoiceStatus.DRAFT,
          'invoice.presentation_overridden',
          context,
          { issuerPresentationSnapshot: presentation as unknown as Prisma.InputJsonValue },
        );
      }
    }
    if (input.selectedConnectionId) {
      const connection = await this.prisma.joFotaraConnection.findFirst({
        where: { id: input.selectedConnectionId, billingEntityId: oldState.billingEntityId },
      });
      if (!connection)
        throw new BadRequestException('Connection does not belong to this Billing Entity.');
    }
    const invoiceDate = input.invoiceDate ? new Date(input.invoiceDate) : oldState.invoiceDate;
    const periodStart = input.periodStart ? new Date(input.periodStart) : oldState.periodStart;
    const periodEnd = input.periodEnd ? new Date(input.periodEnd) : oldState.periodEnd;
    this.assertPeriod(periodStart, periodEnd);
    const sourceSubscriptionId = oldState.sourceSubscriptionId;
    if (oldState.sourceRenewalCaseId &&
        (periodStart.getTime() !== oldState.periodStart.getTime() ||
          periodEnd.getTime() !== oldState.periodEnd.getTime())) {
      throw new BadRequestException('Renewal invoice dates must match the accepted renewal case.');
    }

    const lines = input.lines
      ? input.lines.map((line, index) =>
          this.toCalculationInput(
            line,
            oldState.lines[index],
            sourceSubscriptionId,
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
    const activeDraftKey = sourceSubscriptionId
      ? this.activeDraftKey(sourceSubscriptionId, periodStart, periodEnd)
      : null;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const reserved = await tx.invoice.updateMany({
          where: {
            id,
            status: InvoiceStatus.DRAFT,
            submissionLock: null,
            revision: oldState.revision,
          },
          data: { revision: { increment: 1 } },
        });
        if (reserved.count !== 1)
          throw new ConflictException('Invoice changed concurrently. Reload.');
        await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
        const invoice = await tx.invoice.update({
          where: { id },
          data: {
            invoiceDate,
            invoiceTypeName: input.invoiceTypeName,
            issuerPresentationSnapshot: input.presentationVisibility
              ? (presentation as unknown as Prisma.InputJsonValue)
              : undefined,
            issuerCountryCodeSnapshot: input.issuerCountryCode,
            buyerCountryCodeSnapshot: input.buyerCountryCode,
            selectedConnectionId: input.selectedConnectionId,
            issuerBankDetailsSnapshot: input.issuerBankDetails,
            issuerLegalNameArSnapshot: input.issuerLegalNameAr,
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

  async cancelDraft(id: string, reason: string, context: MutationContext) {
    if (!reason?.trim()) throw new BadRequestException('Cancellation reason is required.');
    const oldState = await this.requireInvoice(id);
    this.requireStatus(oldState, InvoiceStatus.DRAFT, 'Only a DRAFT invoice can be cancelled.');
    return this.transitionStatus(
      oldState,
      InvoiceStatus.CANCELLED,
      'invoice.draft_cancelled',
      context,
      {
        activeDraftKey: null,
        cancellationReason: reason.trim(),
        cancelledAt: this.clock.now(),
        cancelledBy: context.actorId,
      },
    );
  }

  async reconcile(id: string, note: string, context: MutationContext) {
    if (!note?.trim()) throw new BadRequestException('Reconciliation note is required.');
    const oldState = await this.requireInvoice(id);
    this.requireStatus(
      oldState,
      InvoiceStatus.FAWTARA_ACCEPTED,
      'Only accepted invoices can be reconciled.',
    );
    if (!oldState.reconciliationRequired)
      throw new BadRequestException('No reconciliation is required.');
    // Acknowledgement does not rewrite draft lines. The final document explicitly separates
    // historical CRM line values and authoritative official totals when they differ.
    return this.transitionStatus(
      oldState,
      InvoiceStatus.FAWTARA_ACCEPTED,
      'invoice.official_values_reconciled',
      context,
      {
        reconciliationRequired: false,
        reconciledAt: this.clock.now(),
        reconciledBy: context.actorId,
        reconciliationNote: note.trim(),
      },
    );
  }

  async preflight(id: string) {
    const invoice = await this.requireInvoice(id);
    const result = this.preflightService.validate(invoice);
    result.checks.push({ code: 'BILLING_ENTITY', label: 'Legal issuer', status: invoice.billingEntity.active ? 'PASS' : 'FAIL', blocking: true, message: 'An active legal issuer is required.' });
    result.valid = result.valid && invoice.billingEntity.active;
    result.scopeNote = 'Manual official issue: invoice snapshot and arithmetic readiness. JoFotara API credentials are not required. No network request is performed.';
    return result;
  }

  async markReady(id: string, context: MutationContext) {
    const oldState = await this.requireInvoice(id);
    this.requireStatus(oldState, InvoiceStatus.DRAFT, 'Only a DRAFT invoice can be marked ready.');
    const preflight = await this.preflight(id);
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
    const activeDraftKey = oldState.sourceSubscriptionId
      ? this.activeDraftKey(oldState.sourceSubscriptionId, oldState.periodStart, oldState.periodEnd)
      : null;
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
    if (!isManualQrImage(input.qrImageDataUrl)) {
      throw new BadRequestException(
        'An official graphical QR image is required for manual officialization.',
      );
    }
    if (
      !['SUBMITTED', 'ALREADY_SUBMITTED'].includes(input.fawtaraStatus) ||
      !input.invoiceNumber?.trim()
    ) {
      throw new BadRequestException('Accepted EINV status and official number are required.');
    }
    const acceptedAt = new Date(input.acceptedAt);
    if (!Number.isFinite(acceptedAt.getTime()) || acceptedAt < oldState.invoiceDate ||
        acceptedAt > this.clock.now()) {
      throw new BadRequestException('Acceptance date must be between the invoice date and the present.');
    }

    const officialValues = {
      currencyCode: input.officialCurrencyCode ?? null,
      subtotal: input.officialSubtotal ?? null,
      discountTotal: input.officialDiscountTotal ?? null,
      taxTotal: input.officialTaxTotal ?? null,
      grandTotal: input.officialGrandTotal ?? null,
    };
    if (!officialValues.currencyCode || !/^[A-Z]{3}$/.test(officialValues.currencyCode) ||
        [officialValues.subtotal, officialValues.discountTotal, officialValues.taxTotal, officialValues.grandTotal]
          .some((amount) => amount === null || !/^\d{1,11}(?:\.\d{1,3})?$/.test(amount))) {
      throw new BadRequestException('The official invoice currency and all official monetary values are required.');
    }
    if (this.matchesOfficialization(oldState, input, acceptedAt)) return this.toView(oldState);
    this.requireStatus(
      oldState,
      InvoiceStatus.READY_FOR_FAWTARA,
      'Only a READY_FOR_FAWTARA invoice can be officialized.',
    );
    const preflight = this.preflightService.validate(oldState);
    if (!preflight.valid || !oldState.billingEntity.active) {
      throw new BadRequestException({ message: 'Invoice and issuer details must pass preflight.', preflight });
    }
    const presentation = readIssuerPresentation(oldState.issuerPresentationSnapshot) ??
      snapshotPresentation({ issuerType: oldState.billingEntity.issuerType });
    const discrepancies = this.officialDiscrepancies(oldState, officialValues);

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (oldState.sourceRenewalCaseId) {
          if (!oldState.sourceSubscriptionId) throw new ConflictException('Renewal invoice has no linked subscription.');
          const { renewal, period } = await lockAcceptedRenewal(tx, oldState.sourceRenewalCaseId, oldState.sourceSubscriptionId);
          if (oldState.customerId !== renewal.subscription.customerId ||
              oldState.billingEntityId !== renewal.subscription.customer.billingEntityId ||
              oldState.periodStart.getTime() !== period.start.getTime() ||
              oldState.periodEnd.getTime() !== period.end.getTime()) {
            throw new ConflictException('The linked invoice no longer matches the accepted renewal.');
          }
        }
        const changed = await tx.invoice.updateMany({
          where: {
            id,
            status: InvoiceStatus.READY_FOR_FAWTARA,
            submissionLock: null,
            revision: oldState.revision,
            billingEntity: { active: true },
          },
          data: {
            status: InvoiceStatus.FAWTARA_ACCEPTED,
            revision: { increment: 1 },
            activeDraftKey: null,
            ...(oldState.sourceRenewalCaseId ? { renewalOfficialKey: oldState.sourceRenewalCaseId } : {}),
            issuerPresentationSnapshot: {
              ...presentation,
              templateVersion: presentation.issuerType === 'INDIVIDUAL' ? 'personal-v1' : 'nusrv-company-v1',
              logoAssetId: oldState.issuerLogoAssetId,
            },
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
            officializationProvenance: 'MANUAL',
            reconciliationRequired: discrepancies.length > 0,
          },
        });
        if (changed.count !== 1) {
          const current = await tx.invoice.findUniqueOrThrow({ where: { id }, include: invoiceInclude });
          if (this.matchesOfficialization(current, input, acceptedAt)) return this.toView(current);
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
          where: {
            id,
            status: InvoiceStatus.READY_FOR_FAWTARA,
            submissionLock: null,
            revision: oldState.revision,
          },
          data: {
            status: InvoiceStatus.FAWTARA_REJECTED,
            revision: { increment: 1 },
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
          where: {
            id: oldState.id,
            status: oldState.status,
            submissionLock: null,
            revision: oldState.revision,
          },
          data: { status, revision: { increment: 1 }, ...extraData },
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
    sourceSubscriptionId: string | null,
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

  private decryptBankDetails(ciphertext: string): string {
    if (!this.secrets)
      throw new BadRequestException('Bank snapshot encryption service unavailable.');
    try {
      const value: unknown = this.secrets.decrypt(ciphertext);
      if (typeof value !== 'string') throw new Error();
      return value;
    } catch {
      throw new BadRequestException('Billing Entity bank details cannot be decrypted.');
    }
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

  private matchesOfficialization(invoice: InvoiceWithLines, input: RecordFawtaraResultDto, acceptedAt: Date) {
    const verified = officialInvoiceEvidence(invoice);
    const amounts = [
      [invoice.officialSubtotal, input.officialSubtotal],
      [invoice.officialDiscountTotal, input.officialDiscountTotal],
      [invoice.officialTaxTotal, input.officialTaxTotal],
      [invoice.officialGrandTotal, input.officialGrandTotal],
    ] as const;
    return Boolean(verified &&
      invoice.officializationProvenance === 'MANUAL' &&
      verified.invoiceNumber === input.invoiceNumber.trim() &&
      verified.currency === input.officialCurrencyCode &&
      invoice.fawtaraStatus === input.fawtaraStatus &&
      invoice.fawtaraAcceptedAt?.getTime() === acceptedAt.getTime() &&
      invoice.fawtaraInvoiceUuid === this.cleanText(input.invoiceUuid) &&
      invoice.fawtaraQrPayload === this.cleanText(input.qrPayload) &&
      invoice.fawtaraQrImageDataUrl === this.cleanText(input.qrImageDataUrl) &&
      invoice.officializationNote === this.cleanText(input.note) &&
      amounts.every(([stored, submitted]) => stored && submitted !== undefined && moneyEqual(stored, submitted)));
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
      invoiceTypeName: invoice.invoiceTypeName,
      invoiceCounter: invoice.invoiceCounter?.toString(),
      submissionUuid: invoice.submissionUuid,
      selectedConnectionId: invoice.selectedConnectionId,
      issuerCountryCode: invoice.issuerCountryCodeSnapshot,
      buyerCountryCode: invoice.buyerCountryCodeSnapshot,
      issuerBankDetails: invoice.issuerBankDetailsSnapshot,
      cancellationReason: invoice.cancellationReason,
      reconciliationRequired: invoice.reconciliationRequired,
      reconciledAt: invoice.reconciledAt,
      reconciledBy: invoice.reconciledBy,
      reconciliationNote: invoice.reconciliationNote,
      officializationProvenance: invoice.officializationProvenance,
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
      issuerPresentation: invoice.issuerPresentationSnapshot,
      issuerLogoAssetId: invoice.issuerLogoAssetId,
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
      invoiceCounter: invoice.invoiceCounter?.toString() ?? null,
      effectiveCurrencyCode: invoice.officialCurrencyCode ?? invoice.currencyCode,
      effectiveSubtotal: invoice.officialSubtotal ?? invoice.subtotal,
      effectiveDiscountTotal: invoice.officialDiscountTotal ?? invoice.discountTotal,
      effectiveTaxTotal: invoice.officialTaxTotal ?? invoice.taxTotal,
      effectiveGrandTotal: invoice.officialGrandTotal ?? invoice.grandTotal,
      verifiedOfficial: isVerifiedOfficialInvoice(invoice),
      officialValueDiscrepancies: discrepancies,
      submissionPending: Boolean(invoice.submissionLock),
      finalPrintEnabled:
        isVerifiedOfficialInvoice(invoice) &&
        !invoice.reconciliationRequired &&
        Boolean(
          invoice.issuerLegalNameSnapshot?.trim() &&
          invoice.issuerAddressSnapshot?.trim() &&
          invoice.issuerTaxNumberSnapshot?.trim(),
        ),
      locked: invoice.status !== InvoiceStatus.DRAFT,
    };
  }
}
