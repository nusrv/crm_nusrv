import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { HealthStatus, IntegrationKind } from '../../generated/prisma/enums';

/**
 * Slice B §23 — minimal SMTP health signal only, not incident management. IntegrationHealthEvent
 * remains append-only (Slice A design): recovery is represented by a new HEALTHY row, never by
 * mutating an old one. To avoid flooding one event per email, a new event/row is only appended
 * when the computed status actually differs from MailConfiguration.lastHealthStatus; an unchanged
 * status still refreshes lastHealthCheckedAt as a heartbeat, but writes no new event.
 */
@Injectable()
export class MailHealthService {
  constructor(private readonly prisma: PrismaService) {}

  async record(mailConfigurationId: string, status: HealthStatus, message: string): Promise<void> {
    const config = await this.prisma.mailConfiguration.findUniqueOrThrow({
      where: { id: mailConfigurationId },
      select: { lastHealthStatus: true },
    });
    const now = new Date();
    const changed = config.lastHealthStatus !== status;

    await this.prisma.$transaction(async (tx) => {
      if (changed) {
        await tx.integrationHealthEvent.create({
          data: { integration: IntegrationKind.SMTP, status, message, mailConfigurationId },
        });
      }
      await tx.mailConfiguration.update({
        where: { id: mailConfigurationId },
        data: { lastHealthStatus: status, lastHealthCheckedAt: now },
      });
    });
  }
}
