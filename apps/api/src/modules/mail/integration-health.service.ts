import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { IntegrationKind } from '../../generated/prisma/enums';

export interface LatestHealthEvent {
  status: string;
  checkedAt: Date;
  message: string;
}

export interface MailIntegrationHealth {
  mailConfigurationId: string;
  scope: string;
  label: string;
  smtp: LatestHealthEvent | null;
  imap: LatestHealthEvent | null;
}

export interface IntegrationHealthOverview {
  mail: MailIntegrationHealth[];
  ai: LatestHealthEvent | null;
}

/**
 * Phase 3.1 §L — read-only aggregation for Settings → Integration Health. Reuses the existing
 * IntegrationHealthEvent log exclusively (never a competing health model): SMTP's latest status
 * still comes from MailConfiguration.lastHealthStatus/lastHealthCheckedAt (MailHealthService's own
 * existing dedup baseline), while IMAP and AI — which deliberately never touch those columns, per
 * MailImapHealthService's/AiHealthService's own doc comments — are resolved by reading each one's
 * single latest IntegrationHealthEvent row directly.
 */
@Injectable()
export class IntegrationHealthService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(): Promise<IntegrationHealthOverview> {
    const configs = await this.prisma.mailConfiguration.findMany({
      orderBy: { scopeKey: 'asc' },
      select: { id: true, scopeKey: true, label: true, lastHealthStatus: true, lastHealthCheckedAt: true },
    });

    const mail = await Promise.all(
      configs.map(async (config) => {
        const latestImap = await this.prisma.integrationHealthEvent.findFirst({
          where: { mailConfigurationId: config.id, integration: IntegrationKind.IMAP },
          orderBy: { createdAt: 'desc' },
          select: { status: true, createdAt: true, message: true },
        });
        return {
          mailConfigurationId: config.id,
          scope: config.scopeKey,
          label: config.label,
          smtp: config.lastHealthCheckedAt
            ? { status: config.lastHealthStatus, checkedAt: config.lastHealthCheckedAt, message: '' }
            : null,
          imap: latestImap ? { status: latestImap.status, checkedAt: latestImap.createdAt, message: latestImap.message } : null,
        };
      }),
    );

    const latestAi = await this.prisma.integrationHealthEvent.findFirst({
      where: { integration: IntegrationKind.AI, mailConfigurationId: null },
      orderBy: { createdAt: 'desc' },
      select: { status: true, createdAt: true, message: true },
    });

    return {
      mail,
      ai: latestAi ? { status: latestAi.status, checkedAt: latestAi.createdAt, message: latestAi.message } : null,
    };
  }
}
