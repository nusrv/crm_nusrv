import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import type { MutationContext } from '../../common/mutation-context';
import { throwMappedPrismaError } from '../../common/prisma-errors';
import { PrismaService } from '../../database/prisma.service';
import { ActorType } from '../../generated/prisma/enums';
import type { CreateServiceTypeDto, UpdateServiceTypeDto } from './service-types.dto';

const includeCounts = { _count: { select: { subscriptions: true } } } as const;

@Injectable()
export class ServiceTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.serviceType.findMany({ include: includeCounts, orderBy: { name: 'asc' } });
  }

  async findOne(id: string) {
    const serviceType = await this.prisma.serviceType.findUnique({
      where: { id },
      include: includeCounts,
    });
    if (!serviceType) throw new NotFoundException('Service Type not found.');
    return serviceType;
  }

  async create(input: CreateServiceTypeDto, context: MutationContext) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const serviceType = await tx.serviceType.create({ data: input, include: includeCounts });
        await this.audit.record(
          {
            actorType: ActorType.USER,
            actorId: context.actorId,
            eventKey: 'service_type.created',
            subjectType: 'ServiceType',
            subjectId: serviceType.id,
            newState: serviceType,
            ipAddress: context.ipAddress,
          },
          tx,
        );
        return serviceType;
      });
    } catch (error) {
      throwMappedPrismaError(error);
    }
  }

  async update(id: string, input: UpdateServiceTypeDto, context: MutationContext) {
    const oldState = await this.findOne(id);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const serviceType = await tx.serviceType.update({
          where: { id },
          data: input,
          include: includeCounts,
        });
        await this.audit.record(
          {
            actorType: ActorType.USER,
            actorId: context.actorId,
            eventKey: 'service_type.updated',
            subjectType: 'ServiceType',
            subjectId: serviceType.id,
            oldState,
            newState: serviceType,
            ipAddress: context.ipAddress,
          },
          tx,
        );
        return serviceType;
      });
    } catch (error) {
      throwMappedPrismaError(error);
    }
  }
}
