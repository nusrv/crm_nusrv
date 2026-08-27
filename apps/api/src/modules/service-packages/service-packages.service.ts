import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import type { MutationContext } from '../../common/mutation-context';
import { throwMappedPrismaError } from '../../common/prisma-errors';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { ActorType } from '../../generated/prisma/enums';
import type { CreateServicePackageDto, UpdateServicePackageDto } from './service-packages.dto';

const includePackage = {
  serviceType: { select: { id: true, code: true, name: true, active: true } },
  terms: { orderBy: { termMonths: 'asc' as const } },
  _count: { select: { subscriptions: true } },
} as const;

@Injectable()
export class ServicePackagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(serviceTypeId?: string, active?: boolean) {
    return this.prisma.servicePackage.findMany({
      where: { serviceTypeId, active },
      include: includePackage,
      orderBy: [{ serviceType: { name: 'asc' } }, { name: 'asc' }],
    });
  }

  async findOne(id: string) {
    const value = await this.prisma.servicePackage.findUnique({
      where: { id },
      include: includePackage,
    });
    if (!value) throw new NotFoundException('Service Package not found.');
    return value;
  }

  async create(input: CreateServicePackageDto, context: MutationContext) {
    await this.requireServiceType(input.serviceTypeId);
    this.validateTerms(input.terms);
    const { terms, ...data } = input;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.servicePackage.create({
          data: {
            ...data,
            specifications: data.specifications as Prisma.InputJsonValue | undefined,
            terms: { create: terms },
          },
          include: includePackage,
        });
        await this.audit.record(
          {
            actorType: ActorType.USER,
            actorId: context.actorId,
            eventKey: 'service_package.created',
            subjectType: 'ServicePackage',
            subjectId: created.id,
            newState: created,
            ipAddress: context.ipAddress,
          },
          tx,
        );
        return created;
      });
    } catch (error) {
      throwMappedPrismaError(error);
    }
  }

  async update(id: string, input: UpdateServicePackageDto, context: MutationContext) {
    const oldState = await this.findOne(id);
    if (input.serviceTypeId) await this.requireServiceType(input.serviceTypeId);
    if (input.terms) this.validateTerms(input.terms);
    const { terms, serviceTypeId, ...data } = input;
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (terms) {
          await tx.servicePackageTerm.deleteMany({ where: { servicePackageId: id } });
        }
        const updated = await tx.servicePackage.update({
          where: { id },
          data: {
            ...data,
            specifications: data.specifications as Prisma.InputJsonValue | undefined,
            serviceType: serviceTypeId ? { connect: { id: serviceTypeId } } : undefined,
            terms: terms ? { create: terms } : undefined,
          },
          include: includePackage,
        });
        await this.audit.record(
          {
            actorType: ActorType.USER,
            actorId: context.actorId,
            eventKey: 'service_package.updated',
            subjectType: 'ServicePackage',
            subjectId: updated.id,
            oldState,
            newState: updated,
            ipAddress: context.ipAddress,
          },
          tx,
        );
        return updated;
      });
    } catch (error) {
      throwMappedPrismaError(error);
    }
  }

  private validateTerms(terms: ReadonlyArray<{ termMonths: number; currency: string }>): void {
    const keys = terms.map((term) => `${term.termMonths}:${term.currency.toUpperCase()}`);
    if (new Set(keys).size !== keys.length) {
      throw new BadRequestException('Package terms must be unique by interval and currency.');
    }
  }

  private async requireServiceType(id: string): Promise<void> {
    const value = await this.prisma.serviceType.findUnique({
      where: { id },
      select: { active: true },
    });
    if (!value?.active) throw new BadRequestException('An active Service Type is required.');
  }
}
