import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import type { MutationContext } from '../../common/mutation-context';
import { throwMappedPrismaError } from '../../common/prisma-errors';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { ActorType } from '../../generated/prisma/enums';
import { TechnicalConnectionSecretService } from '../../security/technical-connection-secret.service';
import type {
  CreateTechnicalConnectionDto,
  UpdateTechnicalConnectionDto,
} from './technical-connections.dto';

@Injectable()
export class TechnicalConnectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: TechnicalConnectionSecretService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const records = await this.prisma.technicalConnection.findMany({
      include: { _count: { select: { subscriptions: true } } },
      orderBy: { code: 'asc' },
    });
    return records.map((record) => this.serialize(record));
  }

  async findOne(id: string) {
    const record = await this.prisma.technicalConnection.findUnique({
      where: { id },
      include: { _count: { select: { subscriptions: true } } },
    });
    if (!record) throw new NotFoundException('Technical Connection not found.');
    return this.serialize(record);
  }

  async create(input: CreateTechnicalConnectionDto, context: MutationContext) {
    const credentialsCiphertext = input.credentials
      ? this.secrets.encryptCredentials(this.validateCredentials(input.credentials))
      : undefined;
    const data: Prisma.TechnicalConnectionUncheckedCreateInput = {
      code: input.code,
      name: input.name,
      type: input.type,
      endpoint: input.endpoint,
      environment: input.environment,
      enabled: input.enabled,
      capabilities: input.capabilities ? asJson(input.capabilities) : undefined,
      credentialsCiphertext,
    };
    try {
      return await this.prisma.$transaction(async (tx) => {
        const record = await tx.technicalConnection.create({
          data,
          include: { _count: { select: { subscriptions: true } } },
        });
        const safeRecord = this.serialize(record);
        await this.audit.record(
          {
            actorType: ActorType.USER,
            actorId: context.actorId,
            eventKey: 'technical_connection.created',
            subjectType: 'TechnicalConnection',
            subjectId: record.id,
            newState: safeRecord,
            ipAddress: context.ipAddress,
          },
          tx,
        );
        return safeRecord;
      });
    } catch (error) {
      throwMappedPrismaError(error);
    }
  }

  async update(id: string, input: UpdateTechnicalConnectionDto, context: MutationContext) {
    const existing = await this.prisma.technicalConnection.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Technical Connection not found.');
    const oldState = this.serialize(existing);
    if (input.credentials && input.clearCredentials) {
      throw new BadRequestException('Provide credentials or clear them, not both.');
    }
    const data: Prisma.TechnicalConnectionUncheckedUpdateInput = {
      name: input.name,
      endpoint: input.endpoint,
      environment: input.environment,
      enabled: input.enabled,
      capabilities: input.capabilities ? asJson(input.capabilities) : undefined,
      credentialsCiphertext: input.clearCredentials
        ? null
        : input.credentials
          ? this.secrets.encryptCredentials(this.validateCredentials(input.credentials))
          : undefined,
    };
    try {
      return await this.prisma.$transaction(async (tx) => {
        const record = await tx.technicalConnection.update({
          where: { id },
          data,
          include: { _count: { select: { subscriptions: true } } },
        });
        const safeRecord = this.serialize(record);
        await this.audit.record(
          {
            actorType: ActorType.USER,
            actorId: context.actorId,
            eventKey: 'technical_connection.updated',
            subjectType: 'TechnicalConnection',
            subjectId: record.id,
            oldState,
            newState: safeRecord,
            metadata: { credentialsChanged: Boolean(input.credentials || input.clearCredentials) },
            ipAddress: context.ipAddress,
          },
          tx,
        );
        return safeRecord;
      });
    } catch (error) {
      throwMappedPrismaError(error);
    }
  }

  private validateCredentials(credentials: Record<string, unknown>): Record<string, string> {
    const entries = Object.entries(credentials);
    if (!entries.length || entries.length > 50) {
      throw new BadRequestException('Credentials must contain between 1 and 50 fields.');
    }
    const result: Record<string, string> = {};
    for (const [key, value] of entries) {
      if (!key.trim() || typeof value !== 'string' || value.length > 10_000) {
        throw new BadRequestException('Credential fields must be named strings.');
      }
      result[key] = value;
    }
    return result;
  }

  private serialize<T extends { credentialsCiphertext: string | null }>(record: T) {
    const { credentialsCiphertext, ...safe } = record;
    const configured = Boolean(credentialsCiphertext);
    return {
      ...safe,
      credentials: configured ? '********' : null,
      credentialsConfigured: configured,
    };
  }
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
