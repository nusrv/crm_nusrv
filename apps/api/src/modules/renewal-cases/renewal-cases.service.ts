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
import { ActorType } from '../../generated/prisma/enums';
import { BusinessTimeService } from '../../time/business-time.service';
import { ClockService } from '../../time/clock.service';
import {
  CreateRenewalHoldDto,
  RenewalCaseListQueryDto,
  RenewalHoldFilter,
} from './renewal-cases.dto';

const renewalCaseInclude = {
  subscription: {
    include: {
      customer: {
        select: {
          id: true,
          customerCode: true,
          companyName: true,
          primaryEmail: true,
          billingEntity: { select: { id: true, code: true, name: true } },
        },
      },
      serviceType: { select: { id: true, code: true, name: true } },
    },
  },
  holds: { orderBy: { createdAt: 'desc' as const } },
  _count: { select: { communicationOutbox: true } },
} as const;

@Injectable()
export class RenewalCasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly businessTime: BusinessTimeService,
  ) {}

  async list(query: RenewalCaseListQueryDto) {
    const now = this.clock.now();
    const search = query.search?.trim();
    const activeHold = {
      active: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    };
    const dueDate =
      query.daysBeforeDue !== undefined
        ? this.businessTime.addBusinessDays(now, query.daysBeforeDue)
        : query.dueFrom || query.dueTo
          ? {
              gte: query.dueFrom ? new Date(query.dueFrom) : undefined,
              lte: query.dueTo ? new Date(query.dueTo) : undefined,
            }
          : undefined;
    const where = {
      dueDate,
      status: query.status,
      subscription: {
        customerId: query.customerId,
        serviceTypeId: query.serviceTypeId,
        ...(search
          ? {
              OR: [
                { subscriptionCode: { contains: search, mode: 'insensitive' as const } },
                { name: { contains: search, mode: 'insensitive' as const } },
                { customer: { companyName: { contains: search, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      },
      holds:
        query.holdStatus === RenewalHoldFilter.ACTIVE
          ? { some: activeHold }
          : query.holdStatus === RenewalHoldFilter.NONE
            ? { none: activeHold }
            : undefined,
    };
    const [data, total] = await Promise.all([
      this.prisma.renewalCase.findMany({
        where,
        include: renewalCaseInclude,
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.renewalCase.count({ where }),
    ]);
    return { data, meta: pageMetadata(total, query.page, query.pageSize), asOf: now.toISOString() };
  }

  async findOne(id: string) {
    const record = await this.prisma.renewalCase.findUnique({
      where: { id },
      include: {
        ...renewalCaseInclude,
        communicationOutbox: { orderBy: { queuedAt: 'desc' }, take: 100 },
        evaluationDecisions: { orderBy: { createdAt: 'desc' }, take: 100 },
      },
    });
    if (!record) throw new NotFoundException('Renewal Case not found.');
    return record;
  }

  async createHold(id: string, input: CreateRenewalHoldDto, context: MutationContext) {
    const renewalCase = await this.prisma.renewalCase.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!renewalCase) throw new NotFoundException('Renewal Case not found.');
    const reason = input.reason.trim();
    if (reason.length < 3) throw new BadRequestException('Hold reason is required.');
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && expiresAt <= this.clock.now()) {
      throw new BadRequestException('Hold expiration must be in the future.');
    }
    return this.prisma.$transaction(async (tx) => {
      const hold = await tx.renewalHold.create({
        data: {
          renewalCaseId: id,
          reason,
          stopsCustomerReminders: input.stopsCustomerReminders,
          stopsInternalNotifications: input.stopsInternalNotifications,
          expiresAt,
          createdById: context.actorId,
        },
      });
      await this.audit.record(
        {
          actorType: ActorType.USER,
          actorId: context.actorId,
          eventKey: 'renewal.hold.created',
          subjectType: 'RenewalHold',
          subjectId: hold.id,
          newState: hold,
          metadata: { renewalCaseId: id },
          ipAddress: context.ipAddress,
        },
        tx,
      );
      return hold;
    });
  }

  async releaseHold(caseId: string, holdId: string, context: MutationContext) {
    const oldState = await this.prisma.renewalHold.findFirst({
      where: { id: holdId, renewalCaseId: caseId },
    });
    if (!oldState) throw new NotFoundException('Renewal hold not found.');
    if (!oldState.active) throw new ConflictException('Renewal hold is already released.');
    return this.prisma.$transaction(async (tx) => {
      const hold = await tx.renewalHold.update({
        where: { id: holdId },
        data: { active: false, releasedById: context.actorId, releasedAt: this.clock.now() },
      });
      await this.audit.record(
        {
          actorType: ActorType.USER,
          actorId: context.actorId,
          eventKey: 'renewal.hold.released',
          subjectType: 'RenewalHold',
          subjectId: hold.id,
          oldState,
          newState: hold,
          metadata: { renewalCaseId: caseId },
          ipAddress: context.ipAddress,
        },
        tx,
      );
      return hold;
    });
  }
}
