import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import type { MutationContext } from '../../common/mutation-context';
import { throwMappedPrismaError } from '../../common/prisma-errors';
import { PrismaService } from '../../database/prisma.service';
import { ActorType } from '../../generated/prisma/enums';
import type { CreateBillingEntityDto, UpdateBillingEntityDto } from './billing-entities.dto';

const safeSelect = {
  id: true,
  code: true,
  name: true,
  legalName: true,
  paymentScope: true,
  taxNumber: true,
  address: true,
  invoiceEmail: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { customers: true } },
} as const;

@Injectable()
export class BillingEntitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.billingEntity.findMany({ select: safeSelect, orderBy: { name: 'asc' } });
  }

  async findOne(id: string) {
    const entity = await this.prisma.billingEntity.findUnique({
      where: { id },
      select: safeSelect,
    });
    if (!entity) throw new NotFoundException('Billing Entity not found.');
    return entity;
  }

  async create(input: CreateBillingEntityDto, context: MutationContext) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const entity = await tx.billingEntity.create({ data: input, select: safeSelect });
        await this.audit.record(
          {
            actorType: ActorType.USER,
            actorId: context.actorId,
            eventKey: 'billing_entity.created',
            subjectType: 'BillingEntity',
            subjectId: entity.id,
            newState: entity,
            ipAddress: context.ipAddress,
          },
          tx,
        );
        return entity;
      });
    } catch (error) {
      throwMappedPrismaError(error);
    }
  }

  async update(id: string, input: UpdateBillingEntityDto, context: MutationContext) {
    const oldState = await this.findOne(id);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const entity = await tx.billingEntity.update({
          where: { id },
          data: input,
          select: safeSelect,
        });
        await this.audit.record(
          {
            actorType: ActorType.USER,
            actorId: context.actorId,
            eventKey: 'billing_entity.updated',
            subjectType: 'BillingEntity',
            subjectId: entity.id,
            oldState,
            newState: entity,
            ipAddress: context.ipAddress,
          },
          tx,
        );
        return entity;
      });
    } catch (error) {
      throwMappedPrismaError(error);
    }
  }
}
