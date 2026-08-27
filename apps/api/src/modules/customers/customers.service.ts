import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import type { MutationContext } from '../../common/mutation-context';
import { pageMetadata } from '../../common/page-query.dto';
import { throwMappedPrismaError } from '../../common/prisma-errors';
import { PrismaService } from '../../database/prisma.service';
import { ActorType, CustomerStatus } from '../../generated/prisma/enums';
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
  ) {}

  async list(query: CustomerListQueryDto) {
    const search = query.search?.trim();
    const where = {
      billingEntityId: query.billingEntityId,
      status: query.status,
      ...(search
        ? {
            OR: [
              { customerCode: { contains: search, mode: 'insensitive' as const } },
              { companyName: { contains: search, mode: 'insensitive' as const } },
              { primaryEmail: { contains: search, mode: 'insensitive' as const } },
              { phone: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        include: customerInclude,
        orderBy: [{ companyName: 'asc' }, { customerCode: 'asc' }],
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
    try {
      return await this.prisma.$transaction(async (tx) => {
        const customer = await tx.customer.create({ data: input, include: customerInclude });
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
    try {
      return await this.prisma.$transaction(async (tx) => {
        const customer = await tx.customer.update({
          where: { id },
          data: input,
          include: customerInclude,
        });
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

  private async requireActiveBillingEntity(id: string): Promise<void> {
    const entity = await this.prisma.billingEntity.findUnique({
      where: { id },
      select: { active: true },
    });
    if (!entity?.active) throw new BadRequestException('An active Billing Entity is required.');
  }
}
