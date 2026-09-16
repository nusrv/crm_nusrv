import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { HealthStatus, IntegrationKind } from '../../generated/prisma/enums';
import type { Prisma } from '../../generated/prisma/client';

/**
 * Slice C §28 — the IMAP counterpart of MailHealthService, following the same anti-flood PATTERN
 * (append a new IntegrationHealthEvent only when status actually changed) but DELIBERATELY NOT
 * reusing MailHealthService itself or its dedup baseline.
 *
 * MailConfiguration has exactly one `lastHealthStatus`/`lastHealthCheckedAt` pair of columns
 * (Slice A schema — frozen, no migration in this slice), and MailHealthService already uses that
 * pair exclusively for SMTP (Slice B, shipped, not to be redesigned). If this service wrote to the
 * same columns for IMAP, an IMAP status change would corrupt SMTP's own dedup baseline (and vice
 * versa) — e.g. an IMAP DEGRADED event would make the next successful SMTP send look like a
 * "changed" status and emit a spurious HEALTHY event, exactly the flooding the anti-flood pattern
 * exists to prevent. So this service never touches MailConfiguration.lastHealthStatus /
 * lastHealthCheckedAt at all; its dedup baseline is the most recent IntegrationHealthEvent row for
 * (mailConfigurationId, integration=IMAP) instead, which is scoped correctly by construction.
 */
@Injectable()
export class MailImapHealthService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    mailConfigurationId: string,
    status: HealthStatus,
    message: string,
    context?: Prisma.InputJsonValue,
  ): Promise<void> {
    const lastEvent = await this.prisma.integrationHealthEvent.findFirst({
      where: { mailConfigurationId, integration: IntegrationKind.IMAP },
      orderBy: { createdAt: 'desc' },
      select: { status: true },
    });
    if (lastEvent?.status === status) return;

    await this.prisma.integrationHealthEvent.create({
      data: { integration: IntegrationKind.IMAP, status, message, mailConfigurationId, context },
    });
  }
}
