import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { IntegrationKind } from '../../generated/prisma/enums';
import { AiSettingsResolverService } from '../ai/ai-settings-resolver.service';
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

/** §L correction — the effective selected provider/model are always reported (even before any
 * health check has ever run), never hidden behind a null health event, and never hardcoded to
 * "OpenAI" — `provider`/`model` always reflect the actual persisted AiSettings row via
 * AiSettingsResolverService, the same source of truth DynamicLlmGateway uses at runtime. */
/**
 * P2.A observational inventory only: "CONFIGURED_ONLY" means the source has
 * configuration prerequisites, NOT that the mailbox was reached or that an
 * email was accepted/delivered. Sent/provider/DSN are intentionally reported
 * as NOT_IMPLEMENTED until their separate folder-scoped evidence paths exist.
 */
export type EvidenceSourceState =
  | 'DISABLED'
  | 'NOT_CONFIGURED'
  | 'BLOCKED_BY_DEPLOYMENT'
  | 'CONFIGURED_ONLY'
  | 'NOT_IMPLEMENTED';

export interface EvidenceSourceInventory {
  mailConfigurationId: string;
  scope: string;
  label: string;
  configuredInboundFolder: string | null;
  lastInboundSyncAt: Date | null;
  inboundFolder: EvidenceSourceState;
  sentFolder: 'BLOCKED_BY_DEPLOYMENT' | 'BASELINE_REQUIRED' | 'OBSERVING' | 'REVIEW_REQUIRED';
  providerEvents: 'NOT_IMPLEMENTED';
  dsnCorrelation: 'NOT_IMPLEMENTED' | 'REVIEW_CAPTURE_ONLY';
}

export interface IntegrationHealthOverview {
  mail: MailIntegrationHealth[];
  ai: { provider: string; model: string | null; health: LatestHealthEvent | null };
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
    private readonly aiSettings: AiSettingsResolverService,
  ) {}

  /**
   * Read-only, per-configuration P2 evidence coverage inventory.
   * Never opens an IMAP or SMTP connection, advances a cursor, decrypts
   * credentials, requests provider evidence, or writes to the database.
   */
  async getEvidenceSources(): Promise<EvidenceSourceInventory[]> {
    const configs = await this.prisma.mailConfiguration.findMany({
      orderBy: { scopeKey: 'asc' },
      select: {
        id: true,
        scopeKey: true,
        label: true,
        enabled: true,
        inboundSyncEnabled: true,
        imapHost: true,
        imapUsername: true,
        imapFolder: true,
        imapCredentialsCiphertext: true,
        lastSyncedAt: true,
      },
    });
    const adapter = resolveImapAdapterCapability(this.config);
    const sentReleased = this.config.get<string>('P2_SENT_OBSERVATION_ENABLED') === 'true' && adapter === 'REAL';
    const dsnReviewReleased = this.config.get<string>('P2_DSN_REVIEW_CAPTURE_ENABLED') === 'true';
    return Promise.all(configs.map(async (item): Promise<EvidenceSourceInventory> => {
      let inboundFolder: EvidenceSourceState;
      if (!item.enabled || !item.inboundSyncEnabled) {
        inboundFolder = 'DISABLED';
      } else if (!item.imapHost.trim() || !item.imapUsername.trim() ||
                 !item.imapFolder.trim() || !item.imapCredentialsCiphertext) {
        inboundFolder = 'NOT_CONFIGURED';
      } else if (adapter !== 'REAL') {
        inboundFolder = 'BLOCKED_BY_DEPLOYMENT';
      } else {
        inboundFolder = 'CONFIGURED_ONLY';
      }
      let sentFolder: EvidenceSourceInventory['sentFolder'] = 'BLOCKED_BY_DEPLOYMENT';
      if (sentReleased) {
        const epoch = await this.prisma.mailSentConnectionEpoch.findUnique({ where: { mailConfigurationId: item.id } });
        const checkpoint = epoch && await this.prisma.mailEvidenceFolderCheckpoint.findFirst({ where: { mailConfigurationId: item.id, connectionGeneration: epoch.generation, sourceKind: 'SENT', syncEnabled: true, capability: 'AVAILABLE' }, select: { lastError: true } });
        sentFolder = checkpoint ? (checkpoint.lastError ? 'REVIEW_REQUIRED' : 'OBSERVING') : 'BASELINE_REQUIRED';
      }
      return {
        mailConfigurationId: item.id,
        scope: item.scopeKey,
        label: item.label,
        configuredInboundFolder: item.imapFolder.trim() || null,
        lastInboundSyncAt: item.lastSyncedAt,
        inboundFolder,
        sentFolder,
        providerEvents: 'NOT_IMPLEMENTED',
        dsnCorrelation: dsnReviewReleased ? 'REVIEW_CAPTURE_ONLY' : 'NOT_IMPLEMENTED',
      };
    }));
  }

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
    const aiSettings = await this.aiSettings.getSettings();

    return {
      mail,
      ai: {
        provider: aiSettings.provider,
        model: aiSettings.model,
        health: latestAi ? { status: latestAi.status, checkedAt: latestAi.createdAt, message: latestAi.message } : null,
      },
    };
  }
}
