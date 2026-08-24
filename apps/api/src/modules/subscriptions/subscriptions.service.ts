import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import type { MutationContext } from '../../common/mutation-context';
import { pageMetadata } from '../../common/page-query.dto';
import { throwMappedPrismaError } from '../../common/prisma-errors';
import { PrismaService } from '../../database/prisma.service';
import { ActorType } from '../../generated/prisma/enums';
import type {
  CreateSubscriptionDto,
  SubscriptionListQueryDto,
  UpdateSubscriptionDto,
} from './subscriptions.dto';

const subscriptionInclude = {
  customer: { select: { id: true, customerCode: true, companyName: true, status: true } },
  serviceType: { select: { id: true, code: true, name: true, active: true } },
  connections: {
    include: {
      technicalConnection: {
        select: { id: true, code: true, name: true, type: true, enabled: true },
      },
    },
    orderBy: { createdAt: 'asc' as const },
  },
} as const;

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: SubscriptionListQueryDto) {
    const search = query.search?.trim();
    const where = {
      customerId: query.customerId,
      serviceTypeId: query.serviceTypeId,
      status: query.status,
      renewalDate:
        query.renewalFrom || query.renewalTo
          ? {
              gte: query.renewalFrom ? new Date(query.renewalFrom) : undefined,
              lte: query.renewalTo ? new Date(query.renewalTo) : undefined,
            }
          : undefined,
      ...(search
        ? {
            OR: [
              { subscriptionCode: { contains: search, mode: 'insensitive' as const } },
              { name: { contains: search, mode: 'insensitive' as const } },
              { customer: { companyName: { contains: search, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.subscription.findMany({
        where,
        include: subscriptionInclude,
        orderBy: [{ renewalDate: 'asc' }, { subscriptionCode: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.subscription.count({ where }),
    ]);
    return { data, meta: pageMetadata(total, query.page, query.pageSize) };
  }

  async findOne(id: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
      include: subscriptionInclude,
    });
    if (!subscription) throw new NotFoundException('Subscription not found.');
    return subscription;
  }

  async create(input: CreateSubscriptionDto, context: MutationContext) {
    this.validateDates(input.startDate, input.renewalDate);
    await this.requireParents(input.customerId, input.serviceTypeId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const subscription = await tx.subscription.create({
          data: {
            ...input,
            startDate: new Date(input.startDate),
            renewalDate: new Date(input.renewalDate),
          },
          include: subscriptionInclude,
        });
        await this.audit.record(
          {
            actorType: ActorType.USER,
            actorId: context.actorId,
            eventKey: 'subscription.created',
            subjectType: 'Subscription',
            subjectId: subscription.id,
            newState: subscription,
            ipAddress: context.ipAddress,
          },
          tx,
        );
        return subscription;
      });
    } catch (error) {
      throwMappedPrismaError(error);
    }
  }

  async update(id: string, input: UpdateSubscriptionDto, context: MutationContext) {
    const oldState = await this.findOne(id);
    const startDate = input.startDate ?? oldState.startDate.toISOString();
    const renewalDate = input.renewalDate ?? oldState.renewalDate.toISOString();
    this.validateDates(startDate, renewalDate);
    if (input.customerId || input.serviceTypeId) {
      await this.requireParents(
        input.customerId ?? oldState.customerId,
        input.serviceTypeId ?? oldState.serviceTypeId,
      );
    }
    const data = {
      ...input,
      startDate: input.startDate ? new Date(input.startDate) : undefined,
      renewalDate: input.renewalDate ? new Date(input.renewalDate) : undefined,
    };
    try {
      return await this.prisma.$transaction(async (tx) => {
        const subscription = await tx.subscription.update({
          where: { id },
          data,
          include: subscriptionInclude,
        });
        await this.audit.record(
          {
            actorType: ActorType.USER,
            actorId: context.actorId,
            eventKey: 'subscription.updated',
            subjectType: 'Subscription',
            subjectId: subscription.id,
            oldState,
            newState: subscription,
            ipAddress: context.ipAddress,
          },
          tx,
        );
        return subscription;
      });
    } catch (error) {
      throwMappedPrismaError(error);
    }
  }

  private validateDates(startDate: string, renewalDate: string): void {
    if (new Date(startDate) >= new Date(renewalDate)) {
      throw new BadRequestException('Renewal date must be after start date.');
    }
  }

  private async requireParents(customerId: string, serviceTypeId: string): Promise<void> {
    const [customer, serviceType] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: customerId }, select: { status: true } }),
      this.prisma.serviceType.findUnique({
        where: { id: serviceTypeId },
        select: { active: true },
      }),
    ]);
    if (!customer) throw new BadRequestException('Customer does not exist.');
    if (!serviceType?.active) throw new BadRequestException('An active Service Type is required.');
  }
}
