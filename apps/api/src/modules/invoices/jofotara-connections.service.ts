import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { SecretEncryptionService } from '../../security/secret-encryption.service';
import { AuditService } from '../../audit/audit.service';
import { ActorType } from '../../generated/prisma/enums';
import type { MutationContext } from '../../common/mutation-context';
import type { JoFotaraConnection } from '../../generated/prisma/client';
import type { SaveJoFotaraConnectionDto } from './jofotara-connections.dto';
export function connectionView(c: JoFotaraConnection) {
  return {
    id: c.id,
    billingEntityId: c.billingEntityId,
    displayName: c.displayName,
    userLabel: c.userLabel,
    incomeSourceSequence: c.incomeSourceSequence,
    enabled: c.enabled,
    productionSubmissionEnabled: c.productionSubmissionEnabled,
    isDefault: c.defaultEntityKey !== null,
    clientIdConfigured: Boolean(c.clientIdCiphertext),
    secretKeyConfigured: Boolean(c.secretKeyCiphertext),
    clientIdMasked: c.clientIdCiphertext ? '********' : null,
    lastUsedAt: c.lastUsedAt,
    disabledAt: c.disabledAt,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}
@Injectable()
export class JoFotaraConnectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretEncryptionService,
    private readonly audit: AuditService,
  ) {}
  async list(billingEntityId: string) {
    return (
      await this.prisma.joFotaraConnection.findMany({
        where: { billingEntityId },
        orderBy: { createdAt: 'asc' },
      })
    ).map(connectionView);
  }
  async save(
    billingEntityId: string,
    id: string | null,
    input: SaveJoFotaraConnectionDto,
    context: MutationContext,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Serialize configuration/default changes for this issuer. No network calls exist here.
      await tx.$queryRaw`SELECT id FROM billing_entities WHERE id = ${billingEntityId} FOR UPDATE`;
      const entity = await tx.billingEntity.findUnique({ where: { id: billingEntityId } });
      if (!entity) throw new NotFoundException('Billing Entity not found.');
      const old = id
        ? await tx.joFotaraConnection.findFirst({ where: { id, billingEntityId } })
        : null;
      if (id && !old) throw new NotFoundException('Connection not found in this Billing Entity.');
      if (!old && (!input.displayName?.trim() || !input.incomeSourceSequence))
        throw new BadRequestException('Connection name and Income Source Sequence are required.');
      const enabled = input.enabled ?? old?.enabled ?? true;
      const isDefault = enabled && (input.isDefault ?? Boolean(old?.defaultEntityKey));
      if (isDefault)
        await tx.joFotaraConnection.updateMany({
          where: { billingEntityId, defaultEntityKey: billingEntityId },
          data: { defaultEntityKey: null },
        });
      const data = {
        displayName: input.displayName?.trim(),
        userLabel: input.userLabel?.trim(),
        incomeSourceSequence: input.incomeSourceSequence,
        enabled,
        productionSubmissionEnabled:
          enabled &&
          (input.productionSubmissionEnabled ?? old?.productionSubmissionEnabled ?? false),
        defaultEntityKey: isDefault ? billingEntityId : null,
        disabledAt: enabled ? null : new Date(),
        ...(input.clientId ? { clientIdCiphertext: this.secrets.encrypt(input.clientId) } : {}),
        ...(input.secretKey ? { secretKeyCiphertext: this.secrets.encrypt(input.secretKey) } : {}),
      };
      const c = old
        ? await tx.joFotaraConnection.update({ where: { id: old.id }, data })
        : await tx.joFotaraConnection.create({
            data: {
              ...data,
              billingEntityId,
              displayName: input.displayName!.trim(),
              incomeSourceSequence: input.incomeSourceSequence!,
            },
          });
      await this.audit.record(
        {
          actorType: ActorType.USER,
          actorId: context.actorId,
          eventKey: 'jofotara.connection_saved',
          subjectType: 'JoFotaraConnection',
          subjectId: c.id,
          oldState: old ? connectionView(old) : undefined,
          newState: connectionView(c),
          metadata: {
            clientIdReplaced: Boolean(input.clientId),
            secretKeyReplaced: Boolean(input.secretKey),
          },
          ipAddress: context.ipAddress,
        },
        tx,
      );
      return connectionView(c);
    });
  }
}
