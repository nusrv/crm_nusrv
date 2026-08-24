import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import type { MutationContext } from '../../common/mutation-context';
import { throwMappedPrismaError } from '../../common/prisma-errors';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { ActorType } from '../../generated/prisma/enums';
import type {
  CreateSubscriptionConnectionDto,
  UpdateSubscriptionConnectionDto,
} from './subscription-connections.dto';

const mappingInclude = {
  subscription: { select: { id: true, subscriptionCode: true, name: true } },
  technicalConnection: {
    select: { id: true, code: true, name: true, type: true, enabled: true },
  },
} as const;

@Injectable()
export class SubscriptionConnectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(subscriptionId?: string) {
    return this.prisma.subscriptionConnection.findMany({
      where: { subscriptionId },
      include: mappingInclude,
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(input: CreateSubscriptionConnectionDto, context: MutationContext) {
    await this.requireParents(input.subscriptionId, input.technicalConnectionId);
    const data: Prisma.SubscriptionConnectionUncheckedCreateInput = {
      subscriptionId: input.subscriptionId,
      technicalConnectionId: input.technicalConnectionId,
      remoteIdentifier: input.remoteIdentifier,
      active: input.active,
      actionProfile: input.actionProfile ? asJson(input.actionProfile) : undefined,
      metadata: input.metadata ? asJson(input.metadata) : undefined,
    };
    try {
      return await this.prisma.$transaction(async (tx) => {
        const mapping = await tx.subscriptionConnection.create({ data, include: mappingInclude });
        await this.audit.record(
          {
            actorType: ActorType.USER,
            actorId: context.actorId,
            eventKey: 'subscription_connection.created',
            subjectType: 'SubscriptionConnection',
            subjectId: mapping.id,
            newState: mapping,
            ipAddress: context.ipAddress,
          },
          tx,
        );
        return mapping;
      });
    } catch (error) {
      throwMappedPrismaError(error);
    }
  }

  async update(id: string, input: UpdateSubscriptionConnectionDto, context: MutationContext) {
    const oldState = await this.prisma.subscriptionConnection.findUnique({
      where: { id },
      include: mappingInclude,
    });
    if (!oldState) throw new NotFoundException('Subscription connection mapping not found.');
    if (input.technicalConnectionId) {
      await this.requireParents(oldState.subscriptionId, input.technicalConnectionId);
    }
    const data: Prisma.SubscriptionConnectionUncheckedUpdateInput = {
      technicalConnectionId: input.technicalConnectionId,
      remoteIdentifier: input.remoteIdentifier,
      active: input.active,
      actionProfile: input.actionProfile ? asJson(input.actionProfile) : undefined,
      metadata: input.metadata ? asJson(input.metadata) : undefined,
    };
    try {
      return await this.prisma.$transaction(async (tx) => {
        const mapping = await tx.subscriptionConnection.update({
          where: { id },
          data,
          include: mappingInclude,
        });
        await this.audit.record(
          {
            actorType: ActorType.USER,
            actorId: context.actorId,
            eventKey: 'subscription_connection.updated',
            subjectType: 'SubscriptionConnection',
            subjectId: mapping.id,
            oldState,
            newState: mapping,
            ipAddress: context.ipAddress,
          },
          tx,
        );
        return mapping;
      });
    } catch (error) {
      throwMappedPrismaError(error);
    }
  }

  private async requireParents(subscriptionId: string, connectionId: string): Promise<void> {
    const [subscription, connection] = await Promise.all([
      this.prisma.subscription.findUnique({ where: { id: subscriptionId }, select: { id: true } }),
      this.prisma.technicalConnection.findUnique({
        where: { id: connectionId },
        select: { enabled: true },
      }),
    ]);
    if (!subscription) throw new BadRequestException('Subscription does not exist.');
    if (!connection?.enabled)
      throw new BadRequestException('An enabled Technical Connection is required.');
  }
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
