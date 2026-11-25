import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mailWorkersPaused } from './mail-worker-maintenance';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../database/prisma.service';
import type { MailConfiguration, Prisma } from '../../generated/prisma/client';
import { ActorType } from '../../generated/prisma/enums';
import type { VerifiedAccessContext } from '../../identity/verified-access-context';
import { ImapMailboxReaderFactory } from './imap-mailbox-reader-factory';
import { isMailConfigEnvironmentAllowed } from './mail-environment-guard';
import { planFutureOnlySentBaseline } from './mail-sent-folder-discovery';
import { previewSentFolderObservations } from './mail-evidence-sent-preview';
import { commitSentObservationPreview } from './mail-sent-observation-commit';
import type { SentObservationPlanCheckpoint } from './mail-sent-observation-plan';

@Injectable()
export class MailSentObservationService {
  private readonly logger = new Logger(MailSentObservationService.name);
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService,
    private readonly readers: ImapMailboxReaderFactory, private readonly audit: AuditService) {}

  enabled() {
    return this.config.get<string>('P2_SENT_OBSERVATION_ENABLED') === 'true' &&
      this.config.get<string>('IMAP_MODE') === 'real';
  }

  private eligible(row: MailConfiguration) {
    return row.enabled && row.inboundSyncEnabled && row.imapSecure &&
      Boolean(row.imapHost.trim() && row.imapUsername.trim() && row.imapCredentialsCiphertext) &&
      isMailConfigEnvironmentAllowed(row.environment, this.config.get<string>('NODE_ENV') ?? 'development');
  }

  private async requireAdmin(tx: Prisma.TransactionClient, actor: VerifiedAccessContext) {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${actor.actorId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM auth_sessions WHERE id = ${actor.sessionId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: actor.actorId }, select: { active: true } });
    const session = await tx.authSession.findUnique({ where: { id: actor.sessionId } });
    const roles = await tx.$queryRaw<Array<{ code: string }>>`SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ${actor.actorId} FOR UPDATE`;
    const now = Date.now();
    if (!user?.active || !roles.some(r => r.code === 'ADMIN') || !session ||
        session.userId !== actor.actorId || session.revokedAt !== null ||
        now < session.createdAt.getTime() || now >= Math.min(actor.accessExpiresAt, session.expiresAt.getTime(), session.createdAt.getTime() + 86_400_000)) {
      throw new ForbiddenException('Current ADMIN session required.');
    }
  }

  async status(id: string) {
    if (!this.enabled()) return { enabled: false, state: 'BLOCKED_BY_DEPLOYMENT' };
    const row = await this.prisma.mailConfiguration.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Mailbox not found.');
    if (!this.eligible(row)) return { enabled: true, state: 'DISABLED_OR_NOT_CONFIGURED' };
    const epoch = await this.prisma.mailSentConnectionEpoch.findUnique({ where: { mailConfigurationId: id } });
    const checkpoint = epoch && await this.prisma.mailEvidenceFolderCheckpoint.findFirst({
      where: { mailConfigurationId: id, connectionGeneration: epoch.generation, sourceKind: 'SENT', syncEnabled: true },
      select: { folderName: true, lastProbeAt: true, lastObservedAt: true, lastError: true },
    });
    return checkpoint ? { enabled: true, state: 'OBSERVING', ...checkpoint } : { enabled: true, state: 'BASELINE_REQUIRED' };
  }

  /** Explicit future-only baseline; never silently rewinds or imports a historical folder. */
  async activate(id: string, actor: VerifiedAccessContext) {
    if (!this.enabled() || mailWorkersPaused(this.config.get<string>('MAIL_WORKERS_PAUSED'))) throw new ServiceUnavailableException('Sent observation activation is unavailable during maintenance or when the release gate is disabled.');
    const snapshot = await this.prisma.$transaction(async tx => {
      await this.requireAdmin(tx, actor);
      await tx.$queryRaw`SELECT id FROM mail_configurations WHERE id = ${id} FOR UPDATE`;
      const row = await tx.mailConfiguration.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('Mailbox not found.');
      if (!this.eligible(row)) throw new ConflictException('An enabled real TLS IMAP configuration is required.');
      let epoch = await tx.mailSentConnectionEpoch.findUnique({ where: { mailConfigurationId: id } });
      if (epoch && await tx.mailEvidenceFolderCheckpoint.findFirst({ where: {
        mailConfigurationId: id, connectionGeneration: epoch.generation, sourceKind: 'SENT',
      } })) throw new ConflictException('This connection already has a baseline.');
      epoch ??= await tx.mailSentConnectionEpoch.create({ data: { mailConfigurationId: id, generation: randomUUID() } });
      return { row, generation: epoch.generation };
    }, { isolationLevel: 'ReadCommitted' });

    const reader = this.readers.createReader(snapshot.row);
    const checkpointId = randomUUID();
    try {
      const discovery = await reader.discoverSentFolder();
      if (discovery.outcome !== 'AVAILABLE') throw new ConflictException('Server has not identified a unique Sent folder.');
      const state = await reader.readSentBaselineSource(discovery.folder.folderName);
      if (!state) throw new ConflictException('Sent folder identity could not be confirmed.');
      const checkpoint = { ...discovery.folder, id: checkpointId, sourceKind: 'SENT', syncEnabled: false, uidValidity: null, lastUid: null };
      const plan = planFutureOnlySentBaseline(checkpoint, discovery, discovery.folder.folderName, state);
      if (plan.outcome !== 'BASELINE_PROPOSED') throw new ConflictException('Invalid Sent baseline.');
      // Confirm the provider supports the bounded reader before committing the baseline.
      const probe = await reader.fetchSentMessagesSince(state.folderName, plan.uidValidity, plan.lastUid, 1);
      if (probe.outcome !== 'ok') throw new ConflictException('Sent provider does not support safe bounded observation.');
      return await this.prisma.$transaction(async tx => {
        await this.requireAdmin(tx, actor);
        await tx.$queryRaw`SELECT id FROM mail_configurations WHERE id = ${id} FOR UPDATE`;
        const current = await tx.mailConfiguration.findUnique({ where: { id } });
        const epoch = await tx.mailSentConnectionEpoch.findUnique({ where: { mailConfigurationId: id } });
        if (!current || !this.eligible(current) || epoch?.generation !== snapshot.generation ||
            await tx.mailEvidenceFolderCheckpoint.findFirst({ where: { mailConfigurationId: id, connectionGeneration: snapshot.generation, sourceKind: 'SENT' } })) {
          throw new ConflictException('Mailbox or baseline changed during verification.');
        }
        const saved = await tx.mailEvidenceFolderCheckpoint.create({ data: {
          id: checkpointId, mailConfigurationId: id, connectionGeneration: snapshot.generation,
          folderName: state.folderName, folderIdentityKey: state.folderIdentityKey, sourceKind: 'SENT',
          syncEnabled: true, capability: 'AVAILABLE', uidValidity: plan.uidValidity, lastUid: plan.lastUid, lastProbeAt: new Date(),
        } });
        await this.audit.record({ actorType: ActorType.USER, actorId: actor.actorId,
          eventKey: 'mail.sent.baseline_activated', subjectType: 'MailConfiguration', subjectId: id,
          metadata: { checkpointId, folder: saved.folderName, generation: snapshot.generation, futureOnly: true } }, tx);
        return { enabled: true, state: 'OBSERVING', folderName: saved.folderName };
      }, { isolationLevel: 'ReadCommitted' });
    } catch (error) {
      if (error instanceof ConflictException || error instanceof ForbiddenException) throw error;
      throw new ConflictException('Sent verification failed; no baseline was activated.');
    } finally { await reader.close().catch(() => undefined); }
  }

  /** Explicit stop preserves every checkpoint and observation, even a pending activation. */
  async stop(id: string, actor: VerifiedAccessContext) {
    if (!this.enabled()) throw new ServiceUnavailableException('Sent observation release gate is disabled.');
    return this.prisma.$transaction(async tx => {
      await this.requireAdmin(tx, actor);
      await tx.$queryRaw`SELECT id FROM mail_configurations WHERE id = ${id} FOR UPDATE`;
      const row = await tx.mailConfiguration.findUnique({ where: { id }, select: { id: true } });
      if (!row) throw new NotFoundException('Mailbox not found.');
      const epoch = await tx.mailSentConnectionEpoch.findUnique({ where: { mailConfigurationId: id } });
      if (epoch) {
        await tx.mailEvidenceFolderCheckpoint.updateMany({ where: { mailConfigurationId: id,
          connectionGeneration: epoch.generation, sourceKind: 'SENT', syncEnabled: true },
          data: { syncEnabled: false, capability: 'UNPROBED', lastError: 'STOPPED_BY_ADMIN' } });
        await tx.mailSentConnectionEpoch.delete({ where: { mailConfigurationId: id } });
        await this.audit.record({ actorType: ActorType.USER, actorId: actor.actorId, eventKey: 'mail.sent.observation_stopped',
          subjectType: 'MailConfiguration', subjectId: id, metadata: { generation: epoch.generation } }, tx);
      }
      return { enabled: true, state: 'BASELINE_REQUIRED' };
    }, { isolationLevel: 'ReadCommitted' });
  }

  private async retire(checkpoint: SentObservationPlanCheckpoint, reason: string) {
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM mail_configurations WHERE id = ${checkpoint.mailConfigurationId} FOR UPDATE`;
      const epoch = await tx.mailSentConnectionEpoch.findUnique({ where: { mailConfigurationId: checkpoint.mailConfigurationId } });
      if (epoch?.generation !== checkpoint.connectionGeneration) return;
      const result = await tx.mailEvidenceFolderCheckpoint.updateMany({
        where: { id: checkpoint.id, syncEnabled: true, uidValidity: checkpoint.uidValidity, lastUid: checkpoint.lastUid },
        data: { syncEnabled: false, capability: 'UNPROBED', lastError: reason, lastProbeAt: new Date() },
      });
      if (result.count !== 1) return;
      await tx.mailSentConnectionEpoch.delete({ where: { mailConfigurationId: checkpoint.mailConfigurationId } });
      await this.audit.record({ actorType: ActorType.SYSTEM, eventKey: 'mail.sent.baseline_retired',
        subjectType: 'MailConfiguration', subjectId: checkpoint.mailConfigurationId,
        metadata: { checkpointId: checkpoint.id, reason } }, tx);
    }, { isolationLevel: 'ReadCommitted' });
  }

  async syncEnabled() {
    if (!this.enabled() || mailWorkersPaused(this.config.get<string>('MAIL_WORKERS_PAUSED'))) return;
    // Bounded fair batch. Legacy rows never enter the operational path.
    const checkpoints = await this.prisma.mailEvidenceFolderCheckpoint.findMany({
      where: { sourceKind: 'SENT', syncEnabled: true, capability: 'AVAILABLE', connectionGeneration: { not: 'legacy' } },
      orderBy: [{ lastProbeAt: 'asc' }, { id: 'asc' }], take: 10,
    });
    for (const checkpoint of checkpoints) {
      const stamp = async (error: string | null) => {
        await this.prisma.mailEvidenceFolderCheckpoint.updateMany({
          where: { id: checkpoint.id, syncEnabled: true, connectionGeneration: checkpoint.connectionGeneration },
          data: { lastProbeAt: new Date(), lastError: error },
        });
      };
      try {
        const snapshot = await this.prisma.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM mail_configurations WHERE id = ${checkpoint.mailConfigurationId} FOR UPDATE`;
          const row = await tx.mailConfiguration.findUnique({ where: { id: checkpoint.mailConfigurationId } });
          const epoch = await tx.mailSentConnectionEpoch.findUnique({ where: { mailConfigurationId: checkpoint.mailConfigurationId } });
          return row && this.eligible(row) && epoch?.generation === checkpoint.connectionGeneration ? row : null;
        }, { isolationLevel: 'ReadCommitted' });
        if (!snapshot) { await stamp('CONNECTION_NOT_CURRENT'); continue; }
        const reader = this.readers.createReader(snapshot);
        try {
          const discovery = await reader.discoverSentFolder();
          if (discovery.outcome !== 'AVAILABLE' || discovery.folder.folderName !== checkpoint.folderName) {
            await this.retire(checkpoint, 'SENT_FOLDER_CHANGED'); continue;
          }
          const preview = await previewSentFolderObservations(checkpoint, reader);
          if (preview.outcome === 'PREVIEW_ONLY') {
            await commitSentObservationPreview(this.prisma, checkpoint, preview);
            await stamp(null);
          } else if (preview.outcome === 'UIDVALIDITY_CHANGED' || preview.outcome === 'INVALID_CURSOR' ||
              preview.outcome === 'NEEDS_BASELINE' || preview.outcome === 'FOLDER_IDENTITY_MISMATCH') {
            await this.retire(checkpoint, preview.outcome);
          } else await stamp(preview.outcome);
        } finally { await reader.close().catch(() => undefined); }
      } catch {
        await stamp('SENT_OBSERVATION_FAILED').catch(() => undefined);
        this.logger.warn('Sent observation did not complete; cursor was not intentionally reset.');
      }
    }
  }
}
