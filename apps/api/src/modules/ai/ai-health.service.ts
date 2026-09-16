import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { HealthStatus, IntegrationKind } from '../../generated/prisma/enums';
import type { Prisma } from '../../generated/prisma/client';

/**
 * Slice D §16 — AI is global/provider-level in this slice, never attached to a MailConfiguration:
 * every event is written with `mailConfigurationId: null`. Follows the exact anti-flood PATTERN
 * established by MailImapHealthService (dedup against the latest event for this integration, not
 * the shared MailConfiguration.lastHealthStatus scalar — irrelevant here anyway since
 * mailConfigurationId is always null) — deliberately a SEPARATE service, not a shared one, so AI
 * health can never be accidentally mixed with SMTP/IMAP health bookkeeping.
 */
@Injectable()
export class AiHealthService {
  constructor(private readonly prisma: PrismaService) {}

  async record(status: HealthStatus, message: string, context?: Prisma.InputJsonValue): Promise<void> {
    const lastEvent = await this.prisma.integrationHealthEvent.findFirst({
      where: { integration: IntegrationKind.AI, mailConfigurationId: null },
      orderBy: { createdAt: 'desc' },
      select: { status: true },
    });
    if (lastEvent?.status === status) return;

    await this.prisma.integrationHealthEvent.create({
      data: { integration: IntegrationKind.AI, status, message, mailConfigurationId: null, context },
    });
  }
}
