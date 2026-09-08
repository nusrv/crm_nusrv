import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import type { MutationContext } from '../../common/mutation-context';
import { pageMetadata } from '../../common/page-query.dto';
import { throwMappedPrismaError } from '../../common/prisma-errors';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { ActorType, CustomerStatus, SubscriptionStatus } from '../../generated/prisma/enums';
import { CustomerCodeService } from './customer-code.service';
import type {
  CreateCustomerContactDto,
  CreateCustomerDto,
  CustomerListQueryDto,
  UpdateCustomerContactDto,
  UpdateCustomerDto,
} from './customers.dto';

const customerInclude = {
  billingEntity: { select: { id: true, code: true, name: true, active: true } },
  contacts: { orderBy: { createdAt: 'asc' as const } },
  _count: { select: { subscriptions: true } },
} as const;

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly customerCode: CustomerCodeService,
  ) {}

  async list(query: CustomerListQueryDto) {
    const search = query.search?.trim();
    const where = {
      billingEntityId: query.billingEntityId,
      status: query.status,
      // No `mode: 'insensitive'` here: that filter is Postgres/MongoDB-only and Prisma throws a
      // validation error for it against a mysql datasource. MariaDB's utf8mb4_unicode_ci columns
      // are already case-insensitive by collation, so a plain `contains` is sufficient.
      ...(search
        ? {
            OR: [
              { customerCode: { contains: search } },
              { nameEn: { contains: search } },
              { nameAr: { contains: search } },
              { primaryEmail: { contains: search } },
              { phone: { contains: search } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        include: customerInclude,
        orderBy: [{ sourceSequence: 'asc' }, { createdAt: 'asc' }, { customerCode: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.customer.count({ where }),
    ]);
    return { data, meta: pageMetadata(total, query.page, query.pageSize) };
  }

  async findOne(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        ...customerInclude,
        subscriptions: {
          include: { serviceType: true, _count: { select: { connections: true } } },
          orderBy: { renewalDate: 'asc' },
        },
      },
    });
    if (!customer) throw new NotFoundException('Customer not found.');
    return customer;
  }

  async create(input: CreateCustomerDto, context: MutationContext) {
    await this.requireActiveBillingEntity(input.billingEntityId);
    const { phoneCountryCallingCode, ...customerData } = input;
    if (
      input.phone &&
      (!phoneCountryCallingCode || !input.phone.startsWith(phoneCountryCallingCode))
    ) {
      throw new BadRequestException('Phone must start with its country calling code.');
    }
    // Both are inserted as separate rows keyed on (customerId, email); an identical pair would
    // hit that unique constraint and surface as an opaque "record already exists" conflict.
    if (input.secondaryEmail && input.secondaryEmail === input.primaryEmail) {
      throw new BadRequestException('Secondary email must be different from the primary email.');
    }
    if (!input.nameEn?.trim() && !input.nameAr?.trim()) {
      throw new BadRequestException(
        'Provide a Customer Name in English, Arabic, or both — it cannot be empty in both languages.',
      );
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const sourceSequence = await this.nextSourceSequence(tx);
        const customerCode = await this.customerCode.next(tx, input.billingEntityId);
        const customer = await tx.customer.create({
          data: {
            ...customerData,
            customerCode,
            sourceSequence,
            emailAddresses: {
              create: [
                {
                  email: input.primaryEmail,
                  holderName: input.contactName,
                  role: 'PRIMARY',
                  label: 'Primary',
                  primary: true,
                },
                ...(input.secondaryEmail
                  ? [
                      {
                        email: input.secondaryEmail,
                        holderName: input.contactName,
                        role: 'OTHER' as const,
                        label: 'Secondary',
                        primary: false,
                      },
                    ]
                  : []),
              ],
            },
            phoneNumbers:
              input.phone && phoneCountryCallingCode
                ? {
                    create: {
                      phoneNumber: input.phone,
                      countryCallingCode: phoneCountryCallingCode,
                      holderName: input.contactName,
                      role: 'PRIMARY',
                      label: 'Primary',
                      primary: true,
                    },
                  }
                : undefined,
          },
          include: customerInclude,
        });
        await this.audit.record(
          {
            actorType: ActorType.USER,
            actorId: context.actorId,
            eventKey: 'customer.created',
            subjectType: 'Customer',
            subjectId: customer.id,
            newState: customer,
            ipAddress: context.ipAddress,
          },
          tx,
        );
        return customer;
      });
    } catch (error) {
      throwMappedPrismaError(error);
    }
  }

  async update(id: string, input: UpdateCustomerDto, context: MutationContext) {
    const oldState = await this.prisma.customer.findUnique({
      where: { id },
      include: customerInclude,
    });
    if (!oldState) throw new NotFoundException('Customer not found.');
    if (input.billingEntityId) await this.requireActiveBillingEntity(input.billingEntityId);
    const { phoneCountryCallingCode, ...customerData } = input;
    // Only re-validate the calling-code prefix when the phone value is actually changing.
    // phoneCountryCallingCode is not persisted on this model (it only confirms consistency at
    // write time), so re-submitting an unchanged phone from form defaults must not require the
    // caller to retype the calling code on every unrelated edit.
    if (
      input.phone &&
      input.phone !== oldState.phone &&
      (!phoneCountryCallingCode || !input.phone.startsWith(phoneCountryCallingCode))
    ) {
      throw new BadRequestException('Phone must start with its country calling code.');
    }
    const effectiveNameEn = input.nameEn !== undefined ? input.nameEn : oldState.nameEn;
    const effectiveNameAr = input.nameAr !== undefined ? input.nameAr : oldState.nameAr;
    if (!effectiveNameEn?.trim() && !effectiveNameAr?.trim()) {
      throw new BadRequestException(
        'Provide a Customer Name in English, Arabic, or both — it cannot be empty in both languages.',
      );
    }
    // A customer becoming INACTIVE — through this generic edit form or the dedicated /deactivate
    // endpoint, which just calls this method — must suspend every one of its currently ACTIVE
    // subscriptions so they immediately stop generating renewal reminders (enforced independently
    // and defensively by the renewal engine's own query, not only by this cascade). Reactivating a
    // customer intentionally does NOT reverse this: a subscription may have been suspended for an
    // unrelated reason before the customer was deactivated, so blindly restoring everything to
    // ACTIVE on reactivation could wrongly reactivate a subscription that should stay suspended.
    // Subscription reactivation remains a deliberate, individual, manual action.
    const suspendingSubscriptions =
      input.status === CustomerStatus.INACTIVE && oldState.status !== CustomerStatus.INACTIVE;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const customer = await tx.customer.update({
          where: { id },
          data: customerData,
          include: customerInclude,
        });
        const suspended = suspendingSubscriptions
          ? await tx.subscription.updateMany({
              where: { customerId: id, status: SubscriptionStatus.ACTIVE },
              data: { status: SubscriptionStatus.SUSPENDED },
            })
          : null;
        const eventKey =
          input.status && input.status !== oldState.status
            ? 'customer.status_changed'
            : 'customer.updated';
        await this.audit.record(
          {
            actorType: ActorType.USER,
            actorId: context.actorId,
            eventKey,
            subjectType: 'Customer',
            subjectId: customer.id,
            oldState,
            newState: customer,
            metadata: suspended ? { subscriptionsSuspended: suspended.count } : undefined,
            ipAddress: context.ipAddress,
          },
          tx,
        );
        return customer;
      });
    } catch (error) {
      throwMappedPrismaError(error);
    }
  }

  async createContact(
    customerId: string,
    input: CreateCustomerContactDto,
    context: MutationContext,
  ) {
    if (
      !(await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } }))
    ) {
      throw new NotFoundException('Customer not found.');
    }
    return this.prisma.$transaction(async (tx) => {
      const contact = await tx.customerContact.create({ data: { ...input, customerId } });
      await this.audit.record(
        {
          actorType: ActorType.USER,
          actorId: context.actorId,
          eventKey: 'customer.contact_created',
          subjectType: 'CustomerContact',
          subjectId: contact.id,
          newState: contact,
          metadata: { customerId },
          ipAddress: context.ipAddress,
        },
        tx,
      );
      return contact;
    });
  }

  async updateContact(
    customerId: string,
    contactId: string,
    input: UpdateCustomerContactDto,
    context: MutationContext,
  ) {
    const oldState = await this.prisma.customerContact.findFirst({
      where: { id: contactId, customerId },
    });
    if (!oldState) throw new NotFoundException('Customer contact not found.');
    return this.prisma.$transaction(async (tx) => {
      const contact = await tx.customerContact.update({ where: { id: contactId }, data: input });
      await this.audit.record(
        {
          actorType: ActorType.USER,
          actorId: context.actorId,
          eventKey: 'customer.contact_updated',
          subjectType: 'CustomerContact',
          subjectId: contact.id,
          oldState,
          newState: contact,
          metadata: { customerId },
          ipAddress: context.ipAddress,
        },
        tx,
      );
      return contact;
    });
  }

  async deactivate(id: string, context: MutationContext) {
    return this.update(id, { status: CustomerStatus.INACTIVE }, context);
  }

  async deleteCustomer(id: string, context: MutationContext) {
    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({
        where: { id },
        select: { id: true, customerCode: true, nameEn: true, nameAr: true },
      });
      if (!customer) throw new NotFoundException('Customer not found.');

      const subscriptionIds = (
        await tx.subscription.findMany({ where: { customerId: id }, select: { id: true } })
      ).map((s) => s.id);

      const activeRenewalCases = subscriptionIds.length
        ? await tx.renewalCase.count({
            where: {
              subscriptionId: { in: subscriptionIds },
              status: { notIn: ['CLOSED', 'ERROR'] },
            },
          })
        : 0;
      if (activeRenewalCases > 0) {
        throw new BadRequestException(
          'Cannot delete a customer with active renewal cases. Close or cancel them first.',
        );
      }

      const renewalCaseIds = (
        await tx.renewalCase.findMany({
          where: { subscriptionId: { in: subscriptionIds } },
          select: { id: true },
        })
      ).map((r) => r.id);

      await tx.communicationOutbox.deleteMany({ where: { renewalCaseId: { in: renewalCaseIds } } });
      await tx.renewalEvaluationDecision.deleteMany({
        where: { renewalCaseId: { in: renewalCaseIds } },
      });
      await tx.renewalHold.deleteMany({ where: { renewalCaseId: { in: renewalCaseIds } } });
      await tx.renewalCase.deleteMany({ where: { subscriptionId: { in: subscriptionIds } } });
      await tx.legacyImportSubscriptionLink.deleteMany({
        where: { subscriptionId: { in: subscriptionIds } },
      });
      await tx.subscriptionIdentifier.deleteMany({
        where: { subscriptionId: { in: subscriptionIds } },
      });
      await tx.subscriptionConnection.deleteMany({
        where: { subscriptionId: { in: subscriptionIds } },
      });
      await tx.communicationOutbox.deleteMany({ where: { customerId: id } });
      await tx.subscription.deleteMany({ where: { customerId: id } });
      await tx.customerContact.deleteMany({ where: { customerId: id } });
      await tx.customerEmailAddress.deleteMany({ where: { customerId: id } });
      await tx.customerPhoneNumber.deleteMany({ where: { customerId: id } });

      await tx.legacyImportRow.updateMany({
        where: { approvedCustomerId: id },
        data: {
          approvedCustomerId: null,
          approvedById: null,
          approvedAt: null,
          status: 'REQUIRES_MANUAL_REVIEW',
        },
      });
      await tx.legacyImportRow.updateMany({
        where: { candidateCustomerId: id },
        data: { candidateCustomerId: null },
      });

      await tx.customer.delete({ where: { id } });

      await this.audit.record(
        {
          actorType: ActorType.USER,
          actorId: context.actorId,
          eventKey: 'customer.deleted',
          subjectType: 'Customer',
          subjectId: id,
          oldState: customer,
          newState: { deleted: true },
          metadata: { deletedSubscriptions: subscriptionIds.length },
          ipAddress: context.ipAddress,
        },
        tx,
      );

      return { id, deleted: true, deletedSubscriptions: subscriptionIds.length };
    });
  }

  private async nextSourceSequence(tx: Prisma.TransactionClient): Promise<number> {
    const highest = await tx.customer.aggregate({ _max: { sourceSequence: true } });
    return (highest._max.sourceSequence ?? 0) + 1;
  }

  private async requireActiveBillingEntity(id: string): Promise<void> {
    const entity = await this.prisma.billingEntity.findUnique({
      where: { id },
      select: { active: true },
    });
    if (!entity?.active) throw new BadRequestException('An active Billing Entity is required.');
  }
}
