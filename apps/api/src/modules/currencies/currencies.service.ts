import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import type { MutationContext } from '../../common/mutation-context';
import { throwMappedPrismaError } from '../../common/prisma-errors';
import { PrismaService } from '../../database/prisma.service';
import { ActorType } from '../../generated/prisma/enums';
import type { CreateCurrencyDto, CurrencyListQueryDto, UpdateCurrencyDto } from './currencies.dto';

@Injectable()
export class CurrenciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(query: CurrencyListQueryDto) {
    return this.prisma.currency.findMany({
      where: query.active === undefined ? undefined : { active: query.active },
      orderBy: { code: 'asc' },
    });
  }

  async create(input: CreateCurrencyDto, context: MutationContext) {
    const data = this.normalize(input.code, input);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const currency = await tx.currency.create({ data });
        await this.audit.record(
          {
            actorType: ActorType.USER,
            actorId: context.actorId,
            eventKey: 'currency.created',
            subjectType: 'Currency',
            subjectId: currency.code,
            newState: currency,
            metadata: { direction: `1 ${currency.code} = ${String(currency.rateToJod)} JOD` },
            ipAddress: context.ipAddress,
          },
          tx,
        );
        return currency;
      });
    } catch (error) {
      throwMappedPrismaError(error);
    }
  }

  async update(code: string, input: UpdateCurrencyDto, context: MutationContext) {
    const normalizedCode = code.trim().toUpperCase();
    const oldState = await this.prisma.currency.findUnique({ where: { code: normalizedCode } });
    if (!oldState) throw new NotFoundException('Currency not found.');
    const data = this.normalize(normalizedCode, {
      name: input.name ?? oldState.name,
      rateToJod: input.rateToJod ?? oldState.rateToJod?.toString(),
      effectiveDate: input.effectiveDate ?? oldState.effectiveDate?.toISOString(),
      active: input.active ?? oldState.active,
    });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const currency = await tx.currency.update({ where: { code: normalizedCode }, data });
        await this.audit.record(
          {
            actorType: ActorType.USER,
            actorId: context.actorId,
            eventKey: 'currency.updated',
            subjectType: 'Currency',
            subjectId: currency.code,
            oldState,
            newState: currency,
            metadata: {
              direction: `1 ${currency.code} = ${String(currency.rateToJod)} JOD`,
              changeReason: input.changeReason,
            },
            ipAddress: context.ipAddress,
          },
          tx,
        );
        return currency;
      });
    } catch (error) {
      throwMappedPrismaError(error);
    }
  }

  private normalize(
    code: string,
    input: { name: string; rateToJod?: string; effectiveDate?: string; active: boolean },
  ) {
    if (!input.rateToJod || !input.effectiveDate) {
      throw new BadRequestException('An exchange rate and effective date are required.');
    }
    if (code === 'JOD' && (input.rateToJod !== '1' || !input.active)) {
      throw new BadRequestException('JOD must remain active with a rate of exactly 1.');
    }
    return {
      name: input.name.trim(),
      code,
      rateToJod: input.rateToJod,
      effectiveDate: new Date(input.effectiveDate),
      active: input.active,
    };
  }
}
