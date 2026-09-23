import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { IntegrationKind } from '../../generated/prisma/enums';
import { resolveImapAdapterCapability, resolveSmtpAdapterCapability, type MailAdapterCapability } from './deployment-mail-capability';

export interface LatestHealthEvent {
  status: string;
  checkedAt: Date;
  message: string;
}

/** Phase 3.1 §3 correction — the CRM must never display a single collapsed "enabled" bit for
 * something with this many independent layers. READY is the only value where a real send/sync
 * could actually happen right now; every other value names exactly which layer is blocking it. */
export type MailEffectiveStatus = 'READY' | 'NOT_CONFIGURED' | 'DISABLED' | 'BLOCKED_BY_DEPLOYMENT';

export interface MailChannelStatus {
  /** Credentials (ciphertext) are present on this MailConfiguration row. */
  configured: boolean;
  /** The DB, admin-managed, Settings-driven operational switch for this channel
   * (outboundSendEnabled for SMTP, inboundSyncEnabled for IMAP) — combined with the row's overall
   * `enabled` flag. This is the ONLY operational authority; MAIL_SEND_ENABLED/IMAP_SYNC_ENABLED env
   * vars are deprecated/parsed-only and never contribute to this value. */
  operationallyEnabled: boolean;
  /** Whether THIS deployment is even capable of the real adapter at all — see
   * deployment-mail-capability.ts. Read-only; an ADMIN cannot change this from Settings. */
  deploymentAdapter: MailAdapterCapability;
  /** The actual truth: whether a real send/sync could happen right now, and if not, exactly which
   * layer (configuration, operational switch, or deployment capability) is blocking it. Computed
   * from the three fields above — never a fourth, independently-tracked flag that could drift from
   * them. */
  effective: MailEffectiveStatus;
}

export interface MailIntegrationHealth {
  mailConfigurationId: string;
  scope: string;
  label: string;
  smtp: LatestHealthEvent | null;
  imap: LatestHealthEvent | null;
  smtpStatus: MailChannelStatus;
  imapStatus: MailChannelStatus;
}

export interface IntegrationHealthOverview {
  mail: MailIntegrationHealth[];
  ai: LatestHealthEvent | null;
}

function computeEffectiveStatus(configured: boolean, operationallyEnabled: boolean, deploymentAdapter: MailAdapterCapability): MailEffectiveStatus {
  if (!configured) return 'NOT_CONFIGURED';
  if (!operationallyEnabled) return 'DISABLED';
  if (deploymentAdapter === 'MOCK') return 'BLOCKED_BY_DEPLOYMENT';
  return 'READY';
}

/**
 * Phase 3.1 §L, corrected by §3 — read-only aggregation for Settings → Integration Health. Reuses
 * the existing IntegrationHealthEvent log exclusively (never a competing health model): SMTP's
 * latest status still comes from MailConfiguration.lastHealthStatus/lastHealthCheckedAt
 * (MailHealthService's own existing dedup baseline), while IMAP and AI — which deliberately never
 * touch those columns, per MailImapHealthService's/AiHealthService's own doc comments — are
 * resolved by reading each one's single latest IntegrationHealthEvent row directly.
 *
 * §3 correction — this is also the ONE place the CRM computes "effective truth" for mail: it reads
 * SMTP_MODE/IMAP_MODE through the exact same resolveSmtpAdapterCapability()/
 * resolveImapAdapterCapability() helpers the worker's real MAIL_TRANSPORT/MAILBOX_READER_FACTORY DI
 * selection uses (see worker-app.module.ts), so Settings can never display "Ready" while the worker
 * is actually using a mock adapter, or vice versa.
 */
@Injectable()
export class IntegrationHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getOverview(): Promise<IntegrationHealthOverview> {
    const configs = await this.prisma.mailConfiguration.findMany({
      orderBy: { scopeKey: 'asc' },
      select: {
        id: true,
        scopeKey: true,
        label: true,
        enabled: true,
        outboundSendEnabled: true,
        inboundSyncEnabled: true,
        smtpCredentialsCiphertext: true,
        lastHealthStatus: true,
        lastHealthCheckedAt: true,
      },
    });

    const smtpAdapter = resolveSmtpAdapterCapability(this.config);
    const imapAdapter = resolveImapAdapterCapability(this.config);

    const mail = await Promise.all(
      configs.map(async (config) => {
        const latestImap = await this.prisma.integrationHealthEvent.findFirst({
          where: { mailConfigurationId: config.id, integration: IntegrationKind.IMAP },
          orderBy: { createdAt: 'desc' },
          select: { status: true, createdAt: true, message: true },
        });
        const configured = Boolean(config.smtpCredentialsCiphertext);
        return {
          mailConfigurationId: config.id,
          scope: config.scopeKey,
          label: config.label,
          smtp: config.lastHealthCheckedAt
            ? { status: config.lastHealthStatus, checkedAt: config.lastHealthCheckedAt, message: '' }
            : null,
          imap: latestImap ? { status: latestImap.status, checkedAt: latestImap.createdAt, message: latestImap.message } : null,
          smtpStatus: {
            configured,
            operationallyEnabled: config.enabled && config.outboundSendEnabled,
            deploymentAdapter: smtpAdapter,
            effective: computeEffectiveStatus(configured, config.enabled && config.outboundSendEnabled, smtpAdapter),
          },
          imapStatus: {
            configured,
            operationallyEnabled: config.enabled && config.inboundSyncEnabled,
            deploymentAdapter: imapAdapter,
            effective: computeEffectiveStatus(configured, config.enabled && config.inboundSyncEnabled, imapAdapter),
          },
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
