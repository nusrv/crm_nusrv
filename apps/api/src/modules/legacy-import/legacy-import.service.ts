import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import type { MutationContext } from '../../common/mutation-context';
import { pageMetadata } from '../../common/page-query.dto';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import {
  ActorType,
  CustomerStatus,
  LegacyCustomerResolution,
  LegacyImportBatchStatus,
  LegacyImportRowStatus,
  LegacyValidationStatus,
} from '../../generated/prisma/enums';
import { SecretEncryptionService } from '../../security/secret-encryption.service';
import type {
  ImportBatchListQueryDto,
  ImportRowListQueryDto,
  LegacyCustomerMappingDto,
  LegacySubscriptionMappingDto,
  ReviewLegacyRowDto,
} from './legacy-import.dto';
import { parseLegacyWorkbook } from './legacy-workbook.parser';

export interface UploadedLegacyFile {
  originalname: string;
  size: number;
  buffer: Buffer;
}

interface DuplicateCandidate {
  customerId: string;
  customerCode: string;
  companyName: string;
  reasons: string[];
  score: number;
}

interface ApprovedMapping {
  customerResolution: LegacyCustomerResolution;
  candidateCustomerId?: string;
  customer?: LegacyCustomerMappingDto;
  subscriptions: LegacySubscriptionMappingDto[];
}

@Injectable()
export class LegacyImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: SecretEncryptionService,
    private readonly audit: AuditService,
  ) {}

  async createBatch(file: UploadedLegacyFile | undefined, context: MutationContext) {
    if (!file?.buffer?.length) throw new BadRequestException('An Excel file is required.');
    if (file.size > 10 * 1024 * 1024)
      throw new BadRequestException('The Excel file exceeds 10 MB.');
    if (!/\.xlsx?$/i.test(file.originalname)) {
      throw new BadRequestException('Only .xls and .xlsx files are accepted.');
    }
    const sourceFileHash = createHash('sha256').update(file.buffer).digest('hex');
    const existing = await this.prisma.legacyImportBatch.findUnique({
      where: { sourceFileHash },
      include: { _count: { select: { rows: true } } },
    });
    if (existing) {
      await this.audit.record({
        actorType: ActorType.USER,
        actorId: context.actorId,
        eventKey: 'legacy_import.reimport_detected',
        subjectType: 'LegacyImportBatch',
        subjectId: existing.id,
        metadata: { sourceFileName: file.originalname, sourceFileHash, reused: true },
        ipAddress: context.ipAddress,
      });
      return { batch: existing, reused: true };
    }

    let parsedRows;
    try {
      parsedRows = parseLegacyWorkbook(file.buffer, file.originalname);
    } catch {
      throw new BadRequestException('The workbook could not be parsed as a supported Excel file.');
    }
    if (!parsedRows.length)
      throw new BadRequestException('The workbook contains no stageable rows.');

    const [customers, billingEntities, serviceTypes, servicePackages] = await Promise.all([
      this.prisma.customer.findMany({
        select: {
          id: true,
          customerCode: true,
          companyName: true,
          primaryEmail: true,
          secondaryEmail: true,
          phone: true,
          subscriptions: { select: { name: true, description: true, sourceLegacyReference: true } },
        },
      }),
      this.prisma.billingEntity.findMany({
        where: { active: true },
        select: { id: true, name: true },
      }),
      this.prisma.serviceType.findMany({
        where: { active: true },
        select: { id: true, name: true },
      }),
      this.prisma.servicePackage.findMany({
        where: { active: true },
        select: {
          id: true,
          code: true,
          name: true,
          kind: true,
          serviceTypeId: true,
          specifications: true,
        },
      }),
    ]);

    const batch = await this.prisma.$transaction(async (tx) => {
      const created = await tx.legacyImportBatch.create({
        data: {
          sourceFileName: file.originalname,
          sourceFileHash,
          sourceFileSize: file.size,
          uploadedById: context.actorId,
          totalRows: parsedRows.length,
        },
      });
      for (const row of parsedRows) {
        const duplicateCandidates = this.findDuplicates(row.suggestions, customers);
        const billingEntity = billingEntities.find(
          (entry) => normalize(entry.name) === normalize(row.suggestions.billingEntityName),
        );
        const serviceType = serviceTypes.find(
          (entry) => normalize(entry.name) === normalize(row.suggestions.serviceTypeName),
        );
        const servicePackage = servicePackages.find(
          (entry) => entry.code === row.suggestions.servicePackageCode,
        );
        const issues = [...row.suggestions.issues];
        if (row.suggestions.servicePackageCode && !servicePackage) {
          issues.push('Suggested package is not present in the active catalog.');
        }
        if (duplicateCandidates.length) {
          issues.push('Possible duplicate customer requires an explicit human resolution.');
        }
        const mappedCustomer = compactJson({
          companyName: row.suggestions.companyName,
          contactName: row.suggestions.contactName,
          primaryEmail: row.suggestions.primaryEmail,
          secondaryEmail: row.suggestions.secondaryEmail,
          phone: row.suggestions.phone,
          address: row.suggestions.address,
          billingEntityId: billingEntity?.id,
          preferredLanguage: 'en',
          contacts: row.suggestions.contacts,
        });
        const mappedSubscriptions = serviceType
          ? [
              compactJson({
                serviceTypeId: serviceType.id,
                servicePackageId: servicePackage?.id,
                name: row.suggestions.servicePackageName ?? row.suggestions.serviceTypeName,
                description: row.suggestions.description,
                startDate: null,
                renewalDate: null,
                billingFrequency: row.suggestions.billingFrequency,
                renewalIntervalMonths: row.suggestions.renewalIntervalMonths,
                contractTermMonths: row.suggestions.renewalIntervalMonths,
                sellingPrice: row.suggestions.sellingPrice,
                currency: row.suggestions.currency,
                providerAutoRenews: true,
                graceHours: 24,
                sourceRegistration: row.suggestions.sourceRegistration,
                packageNameSnapshot:
                  row.suggestions.servicePackageName ?? row.suggestions.sourcePackageName,
                packageSpecificationsSnapshot: servicePackage?.specifications,
                customPackage: row.suggestions.classificationStatus === 'CUSTOM',
                classificationStatus: row.suggestions.classificationStatus,
                classificationEvidence: {
                  ...row.suggestions.classificationEvidence,
                  sourceRenewalReminderDate: row.suggestions.sourceRenewalReminderDate,
                },
                identifiers: row.suggestions.identifiers,
              }),
            ]
          : [];
        await tx.legacyImportRow.create({
          data: {
            batchId: created.id,
            sheetName: row.sheetName,
            sourceRowNumber: row.sourceRowNumber,
            sourceReference: row.sourceReference,
            rowFingerprint: row.rowFingerprint,
            rawValuesCiphertext: this.encryption.encrypt(row.rawValues),
            rawPreview: asJson(row.rawPreview),
            mappedCustomer: asJson(mappedCustomer),
            mappedSubscriptions: asJson(mappedSubscriptions),
            duplicateCandidates: asJson(duplicateCandidates),
            validationIssues: asJson(issues),
            status: LegacyImportRowStatus.REQUIRES_MANUAL_REVIEW,
            validationStatus: issues.some((issue) => /ambiguous/i.test(issue))
              ? LegacyValidationStatus.AMBIGUOUS
              : LegacyValidationStatus.INVALID,
            billingEntityId: billingEntity?.id,
            manualReviewReason: issues.join(' '),
          },
        });
      }
      await this.audit.record(
        {
          actorType: ActorType.USER,
          actorId: context.actorId,
          eventKey: 'legacy_import.batch_created',
          subjectType: 'LegacyImportBatch',
          subjectId: created.id,
          newState: {
            sourceFileName: created.sourceFileName,
            sourceFileHash: created.sourceFileHash,
            totalRows: parsedRows.length,
          },
          ipAddress: context.ipAddress,
        },
        tx,
      );
      return created;
    });
    return { batch, reused: false };
  }

  async listBatches(query: ImportBatchListQueryDto) {
    const where = { status: query.status };
    const [data, total] = await Promise.all([
      this.prisma.legacyImportBatch.findMany({
        where,
        include: {
          _count: { select: { rows: true } },
          uploadedBy: { select: { displayName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.legacyImportBatch.count({ where }),
    ]);
    return { data, meta: pageMetadata(total, query.page, query.pageSize) };
  }

  async getBatch(id: string) {
    const batch = await this.prisma.legacyImportBatch.findUnique({
      where: { id },
      include: {
        uploadedBy: { select: { id: true, displayName: true } },
        rows: {
          select: {
            status: true,
            customerResolution: true,
            duplicateCandidates: true,
            subscriptionLinks: { select: { id: true } },
          },
        },
      },
    });
    if (!batch) throw new NotFoundException('Import batch not found.');
    const summary = {
      totalSourceRows: batch.totalRows,
      successfullyStaged: batch.rows.length,
      approved: batch.rows.filter((row) => row.status === LegacyImportRowStatus.APPROVED).length,
      createdCustomers: batch.rows.filter(
        (row) =>
          row.status === LegacyImportRowStatus.APPROVED &&
          row.customerResolution !== LegacyCustomerResolution.ATTACH_EXISTING,
      ).length,
      createdSubscriptions: batch.rows.reduce(
        (total, row) => total + row.subscriptionLinks.length,
        0,
      ),
      matchedExistingCustomers: batch.rows.filter(
        (row) => row.customerResolution === LegacyCustomerResolution.ATTACH_EXISTING,
      ).length,
      duplicateCandidates: batch.rows.filter(
        (row) => Array.isArray(row.duplicateCandidates) && row.duplicateCandidates.length > 0,
      ).length,
      manualReviewRequired: batch.rows.filter(
        (row) => row.status === LegacyImportRowStatus.REQUIRES_MANUAL_REVIEW,
      ).length,
      failedRecords: batch.rows.filter((row) => row.status === LegacyImportRowStatus.FAILED).length,
      skippedRecords: batch.rows.filter((row) => row.status === LegacyImportRowStatus.SKIPPED)
        .length,
    };
    const safeBatch = Object.fromEntries(Object.entries(batch).filter(([key]) => key !== 'rows'));
    return { ...safeBatch, summary };
  }

  async listRows(batchId: string, query: ImportRowListQueryDto) {
    await this.requireBatch(batchId);
    const search = query.search?.trim();
    const where = {
      batchId,
      status: query.status,
      sheetName: query.sheetName,
      ...(search
        ? {
            OR: [
              { sourceReference: { contains: search, mode: 'insensitive' as const } },
              { manualReviewReason: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.legacyImportRow.findMany({
        where,
        omit: { rawValuesCiphertext: true },
        include: {
          candidateCustomer: { select: { id: true, customerCode: true, companyName: true } },
          approvedCustomer: { select: { id: true, customerCode: true, companyName: true } },
          subscriptionLinks: {
            include: { subscription: { select: { id: true, subscriptionCode: true, name: true } } },
          },
        },
        orderBy: [{ sheetName: 'asc' }, { sourceRowNumber: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.legacyImportRow.count({ where }),
    ]);
    return { data, meta: pageMetadata(total, query.page, query.pageSize) };
  }

  async reviewRow(id: string, input: ReviewLegacyRowDto, context: MutationContext) {
    const oldState = await this.prisma.legacyImportRow.findUnique({
      where: { id },
      omit: { rawValuesCiphertext: true },
    });
    if (!oldState) throw new NotFoundException('Staged row not found.');
    if (oldState.status === LegacyImportRowStatus.APPROVED) {
      throw new ConflictException('Approved source rows are immutable.');
    }
    const customer = await this.validateReview(input);
    const duplicateCandidates = Array.isArray(oldState.duplicateCandidates)
      ? oldState.duplicateCandidates
      : [];
    const result = await this.prisma.$transaction(async (tx) => {
      const reviewed = await tx.legacyImportRow.update({
        where: { id },
        data: {
          mappedCustomer: input.customer ? asJson(input.customer) : undefined,
          mappedSubscriptions: asJson(input.subscriptions),
          customerResolution: input.customerResolution,
          candidateCustomerId: input.candidateCustomerId,
          billingEntityId: customer.billingEntityId,
          validationIssues: asJson([]),
          validationStatus: LegacyValidationStatus.VALID,
          status: LegacyImportRowStatus.READY_FOR_APPROVAL,
          manualReviewReason: null,
          resolutionNotes: input.resolutionNotes,
        },
        omit: { rawValuesCiphertext: true },
      });
      await this.audit.record(
        {
          actorType: ActorType.USER,
          actorId: context.actorId,
          eventKey: 'legacy_import.row_corrected',
          subjectType: 'LegacyImportRow',
          subjectId: id,
          oldState,
          newState: reviewed,
          ipAddress: context.ipAddress,
        },
        tx,
      );
      if (duplicateCandidates.length) {
        await this.audit.record(
          {
            actorType: ActorType.USER,
            actorId: context.actorId,
            eventKey: 'legacy_import.duplicate_resolved',
            subjectType: 'LegacyImportRow',
            subjectId: id,
            newState: {
              customerResolution: input.customerResolution,
              candidateCustomerId: input.candidateCustomerId,
            },
            ipAddress: context.ipAddress,
          },
          tx,
        );
      }
      return reviewed;
    });
    await this.prisma.legacyImportBatch.update({
      where: { id: oldState.batchId },
      data: { status: LegacyImportBatchStatus.IN_REVIEW },
    });
    return result;
  }

  async approveRow(id: string, context: MutationContext) {
    const result = await this.prisma.$transaction(async (tx) => {
      const row = await tx.legacyImportRow.findUnique({
        where: { id },
        include: { subscriptionLinks: { include: { subscription: true } } },
      });
      if (!row) throw new NotFoundException('Staged row not found.');
      if (row.status === LegacyImportRowStatus.APPROVED) {
        return {
          customerId: row.approvedCustomerId,
          subscriptions: row.subscriptionLinks,
          reused: true,
        };
      }
      if (row.status !== LegacyImportRowStatus.READY_FOR_APPROVAL) {
        throw new BadRequestException('The staged row must be validated before approval.');
      }
      const claimed = await tx.legacyImportRow.updateMany({
        where: { id, status: LegacyImportRowStatus.READY_FOR_APPROVAL },
        data: { status: LegacyImportRowStatus.STAGED },
      });
      if (claimed.count !== 1)
        throw new ConflictException('The staged row is already being processed.');

      const mapping = this.readApprovedMapping(row);
      let customerId: string;
      if (mapping.customerResolution === LegacyCustomerResolution.ATTACH_EXISTING) {
        if (!mapping.candidateCustomerId)
          throw new BadRequestException('Existing customer is required.');
        const customer = await tx.customer.findUnique({
          where: { id: mapping.candidateCustomerId },
        });
        if (!customer)
          throw new BadRequestException('Selected existing customer no longer exists.');
        customerId = customer.id;
      } else {
        if (!mapping.customer) throw new BadRequestException('Mapped customer data is required.');
        const { contacts, ...customerInput } = mapping.customer;
        const customer = await tx.customer.create({
          data: {
            ...customerInput,
            customerCode: this.generatedCode('LEG-C', row.sourceReference),
            sourceLegacyReference: row.sourceReference,
            status: CustomerStatus.ACTIVE,
            contacts: contacts?.length
              ? {
                  create: contacts.map((contact) => ({
                    ...contact,
                    sourceLegacyReference: row.sourceReference,
                  })),
                }
              : undefined,
          },
        });
        customerId = customer.id;
        await this.audit.record(
          {
            actorType: ActorType.USER,
            actorId: context.actorId,
            eventKey: 'legacy_import.live_customer_created',
            subjectType: 'Customer',
            subjectId: customer.id,
            newState: customer,
            metadata: { importRowId: row.id, sourceReference: row.sourceReference },
            ipAddress: context.ipAddress,
          },
          tx,
        );
      }

      const subscriptions = [];
      for (const [index, subscriptionInput] of mapping.subscriptions.entries()) {
        const { identifiers, ...liveSubscriptionInput } = subscriptionInput;
        const subscription = await tx.subscription.create({
          data: {
            ...liveSubscriptionInput,
            packageSpecificationsSnapshot: liveSubscriptionInput.packageSpecificationsSnapshot
              ? asJson(liveSubscriptionInput.packageSpecificationsSnapshot)
              : undefined,
            classificationEvidence: liveSubscriptionInput.classificationEvidence
              ? asJson(liveSubscriptionInput.classificationEvidence)
              : undefined,
            customerId,
            subscriptionCode: this.generatedCode(
              'LEG-S',
              `${row.sourceReference}:${String(index + 1)}`,
            ),
            startDate: new Date(subscriptionInput.startDate),
            renewalDate: new Date(subscriptionInput.renewalDate),
            sourceLegacyReference: row.sourceReference,
            identifiers: identifiers?.length ? { create: identifiers } : undefined,
          },
        });
        await tx.legacyImportSubscriptionLink.create({
          data: { importRowId: row.id, subscriptionId: subscription.id },
        });
        subscriptions.push(subscription);
        await this.audit.record(
          {
            actorType: ActorType.USER,
            actorId: context.actorId,
            eventKey: 'legacy_import.live_subscription_created',
            subjectType: 'Subscription',
            subjectId: subscription.id,
            newState: subscription,
            metadata: { importRowId: row.id, sourceReference: row.sourceReference },
            ipAddress: context.ipAddress,
          },
          tx,
        );
      }

      await tx.legacyImportRow.update({
        where: { id },
        data: {
          status: LegacyImportRowStatus.APPROVED,
          approvedCustomerId: customerId,
          approvedById: context.actorId,
          approvedAt: new Date(),
        },
      });
      await this.audit.record(
        {
          actorType: ActorType.USER,
          actorId: context.actorId,
          eventKey: 'legacy_import.row_approved',
          subjectType: 'LegacyImportRow',
          subjectId: row.id,
          oldState: { status: LegacyImportRowStatus.READY_FOR_APPROVAL },
          newState: {
            status: LegacyImportRowStatus.APPROVED,
            customerId,
            subscriptionIds: subscriptions.map((subscription) => subscription.id),
          },
          metadata: { sourceReference: row.sourceReference },
          ipAddress: context.ipAddress,
        },
        tx,
      );
      return { customerId, subscriptions, reused: false, batchId: row.batchId };
    });
    if ('batchId' in result && result.batchId) await this.refreshBatchStatus(result.batchId);
    return result;
  }

  private async validateReview(input: ReviewLegacyRowDto): Promise<{ billingEntityId: string }> {
    if (new Set(input.subscriptions.map((subscription) => subscription.serviceTypeId)).size === 0) {
      throw new BadRequestException('At least one subscription is required.');
    }
    for (const subscription of input.subscriptions) {
      if (new Date(subscription.startDate) >= new Date(subscription.renewalDate)) {
        throw new BadRequestException('Each renewal date must be after its start date.');
      }
    }
    if (
      input.subscriptions.some((subscription) =>
        ['UNCLASSIFIED', 'MANUAL_REVIEW'].includes(subscription.classificationStatus),
      )
    ) {
      throw new BadRequestException('Resolve every package classification before approval.');
    }
    const serviceTypes = await this.prisma.serviceType.findMany({
      where: {
        id: { in: input.subscriptions.map((subscription) => subscription.serviceTypeId) },
        active: true,
      },
      select: { id: true },
    });
    if (
      serviceTypes.length !== new Set(input.subscriptions.map((entry) => entry.serviceTypeId)).size
    ) {
      throw new BadRequestException('Every mapped Service Type must exist and be active.');
    }
    const packageIds = input.subscriptions
      .map((entry) => entry.servicePackageId)
      .filter((id): id is string => Boolean(id));
    const servicePackages = await this.prisma.servicePackage.findMany({
      where: { id: { in: packageIds }, active: true },
      select: { id: true, serviceTypeId: true, kind: true },
    });
    const packagesById = new Map(servicePackages.map((entry) => [entry.id, entry]));
    for (const subscription of input.subscriptions) {
      const servicePackage = subscription.servicePackageId
        ? packagesById.get(subscription.servicePackageId)
        : undefined;
      if (!servicePackage || servicePackage.serviceTypeId !== subscription.serviceTypeId) {
        throw new BadRequestException(
          'Select an active package belonging to the mapped Service Type.',
        );
      }
      if (
        subscription.classificationStatus === 'CUSTOM' &&
        (servicePackage.kind !== 'CUSTOM_TEMPLATE' || !subscription.customPackage)
      ) {
        throw new BadRequestException(
          'Custom classification requires the service-specific Custom package.',
        );
      }
    }

    if (input.customerResolution === LegacyCustomerResolution.ATTACH_EXISTING) {
      if (!input.candidateCustomerId)
        throw new BadRequestException('Select the existing customer.');
      const customer = await this.prisma.customer.findUnique({
        where: { id: input.candidateCustomerId },
        select: { billingEntityId: true },
      });
      if (!customer) throw new BadRequestException('Selected customer does not exist.');
      return customer;
    }
    if (!input.customer) throw new BadRequestException('Complete the mapped customer data.');
    const entity = await this.prisma.billingEntity.findUnique({
      where: { id: input.customer.billingEntityId },
      select: { active: true },
    });
    if (!entity?.active) throw new BadRequestException('Select an active Billing Entity.');
    return { billingEntityId: input.customer.billingEntityId };
  }

  private readApprovedMapping(row: {
    customerResolution: LegacyCustomerResolution | null;
    candidateCustomerId: string | null;
    mappedCustomer: unknown;
    mappedSubscriptions: unknown;
  }): ApprovedMapping {
    if (!row.customerResolution || !Array.isArray(row.mappedSubscriptions)) {
      throw new BadRequestException('Validated mapping data is incomplete.');
    }
    return {
      customerResolution: row.customerResolution,
      candidateCustomerId: row.candidateCustomerId ?? undefined,
      customer: row.mappedCustomer as LegacyCustomerMappingDto | undefined,
      subscriptions: row.mappedSubscriptions as LegacySubscriptionMappingDto[],
    };
  }

  private findDuplicates(
    suggestions: {
      companyName?: string;
      primaryEmail?: string;
      phone?: string;
      description?: string;
    },
    customers: Array<{
      id: string;
      customerCode: string;
      companyName: string;
      primaryEmail: string;
      secondaryEmail: string | null;
      phone: string | null;
      subscriptions: Array<{
        name: string;
        description: string | null;
        sourceLegacyReference: string | null;
      }>;
    }>,
  ): DuplicateCandidate[] {
    const sourceName = normalize(suggestions.companyName);
    const sourceEmail = normalize(suggestions.primaryEmail);
    const sourcePhone = normalizePhone(suggestions.phone);
    const sourceDomains = extractDomains(
      [suggestions.companyName, suggestions.primaryEmail, suggestions.description]
        .filter(Boolean)
        .join(' '),
    );
    return customers
      .map((customer) => {
        const reasons: string[] = [];
        let score = similarity(sourceName, normalize(customer.companyName));
        if (sourceName && sourceName === normalize(customer.companyName)) {
          reasons.push('Exact company name');
          score = 1;
        } else if (score >= 0.72) reasons.push('Similar company name');
        const emails = [customer.primaryEmail, customer.secondaryEmail].map(normalize);
        if (sourceEmail && emails.includes(sourceEmail)) {
          reasons.push('Same email');
          score = 1;
        }
        if (sourcePhone && sourcePhone === normalizePhone(customer.phone)) {
          reasons.push('Same phone');
          score = Math.max(score, 0.95);
        }
        const existingDomains = extractDomains(
          [
            customer.companyName,
            customer.primaryEmail,
            ...customer.subscriptions.flatMap((subscription) => [
              subscription.name,
              subscription.description,
              subscription.sourceLegacyReference,
            ]),
          ]
            .filter(Boolean)
            .join(' '),
        );
        if ([...sourceDomains].some((domain) => existingDomains.has(domain))) {
          reasons.push('Same domain');
          score = Math.max(score, 0.95);
        }
        return {
          customerId: customer.id,
          customerCode: customer.customerCode,
          companyName: customer.companyName,
          reasons,
          score,
        };
      })
      .filter((candidate) => candidate.reasons.length > 0 && candidate.score >= 0.6)
      .sort((left, right) => right.score - left.score)
      .slice(0, 5);
  }

  private async requireBatch(id: string): Promise<void> {
    if (
      !(await this.prisma.legacyImportBatch.findUnique({ where: { id }, select: { id: true } }))
    ) {
      throw new NotFoundException('Import batch not found.');
    }
  }

  private async refreshBatchStatus(batchId: string): Promise<void> {
    const [remaining, failed] = await Promise.all([
      this.prisma.legacyImportRow.count({
        where: {
          batchId,
          status: {
            in: [
              LegacyImportRowStatus.STAGED,
              LegacyImportRowStatus.REQUIRES_MANUAL_REVIEW,
              LegacyImportRowStatus.READY_FOR_APPROVAL,
            ],
          },
        },
      }),
      this.prisma.legacyImportRow.count({
        where: { batchId, status: LegacyImportRowStatus.FAILED },
      }),
    ]);
    await this.prisma.legacyImportBatch.update({
      where: { id: batchId },
      data: {
        status:
          remaining > 0
            ? LegacyImportBatchStatus.IN_REVIEW
            : failed > 0
              ? LegacyImportBatchStatus.COMPLETED_WITH_ERRORS
              : LegacyImportBatchStatus.COMPLETED,
      },
    });
  }

  private generatedCode(prefix: string, source: string): string {
    return `${prefix}-${createHash('sha256').update(source).digest('hex').slice(0, 16).toUpperCase()}`;
  }
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function compactJson(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function normalize(value: unknown): string {
  return typeof value === 'string'
    ? value
        .toLowerCase()
        .normalize('NFKC')
        .replace(/[^\p{L}\p{N}@.]+/gu, ' ')
        .trim()
    : '';
}

function normalizePhone(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\D/g, '') : '';
}

function extractDomains(value: string): Set<string> {
  return new Set(
    (value.toLowerCase().match(/(?:[a-z0-9-]+\.)+[a-z]{2,}/g) ?? []).map((domain) =>
      domain.replace(/^www\./, ''),
    ),
  );
}

function similarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftTokens = new Set(left.split(' ').filter(Boolean));
  const rightTokens = new Set(right.split(' ').filter(Boolean));
  const common = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return (2 * common) / (leftTokens.size + rightTokens.size);
}
