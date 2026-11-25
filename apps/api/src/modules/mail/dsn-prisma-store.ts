import type { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import type { AuditService } from '../../audit/audit.service';
import type { DsnEvidenceStore, DsnEvidenceTransaction } from './dsn-follow-up-transaction';
import type { ResolutionStore, ResolutionTransaction } from './dsn-follow-up-resolution';
import { planDsnFollowUpFromRecordedAttempt } from './dsn-recorded-attempt';
import { resolveCurrentProviderBinding } from './mail-provider-binding';

// Unregistered concrete persistence adapters. Do not expose either to arbitrary
// callers: only authenticated provider proof and a verified access session may
// enter the respective coordinator. No network or mail operation occurs here.
type Client = Pick<PrismaService, '$transaction'>;
type Auditor = Pick<AuditService, 'record'>;

function taskStatus(value: string): 'OPEN' | 'RESOLVED' {
  if (value !== 'OPEN' && value !== 'RESOLVED') throw new Error('Invalid stored follow-up status.');
  return value;
}
function subjectType(value: string): 'CommunicationOutbox' | 'OperatorReplyOutbox' {
  if (value !== 'CommunicationOutbox' && value !== 'OperatorReplyOutbox') throw new Error('Invalid stored follow-up subject.');
  return value;
}

function evidenceTransaction(tx: Prisma.TransactionClient, audit: Auditor): DsnEvidenceTransaction {
  return {
    async lockCurrentBinding(mailConfigurationId) {
      // Parent row is also the serialization point for settings invalidation.
      await tx.$queryRaw`SELECT id FROM mail_configurations WHERE id = ${mailConfigurationId} FOR UPDATE`;
      const config = await tx.mailConfiguration.findUnique({ where: { id: mailConfigurationId }, select: { id: true, enabled: true } });
      if (!config || config.id !== mailConfigurationId) return null;
      await tx.$queryRaw`SELECT generation FROM mail_provider_evidence_bindings WHERE current_mailbox_key = ${mailConfigurationId} FOR UPDATE`;
      const row = await tx.mailProviderEvidenceBinding.findUnique({ where: { currentMailboxKey: mailConfigurationId } });
      if (!row || row.mailConfigurationId !== mailConfigurationId || row.currentMailboxKey !== mailConfigurationId) return null;
      const snapshot = { mailConfigurationId, generation: row.generation, providerNamespace: row.providerNamespace,
        providerAccountId: row.providerAccountId, enabled: config.enabled, observationEnabled: row.observationEnabled };
      // Recompute persisted key from identity. Disabled rows remain fail-closed.
      const enabled = { ...snapshot, enabled: true, observationEnabled: true };
      const check = resolveCurrentProviderBinding(enabled, enabled, enabled);
      if (check.outcome !== 'BOUND' || check.binding.sourceBindingKey !== row.sourceBindingKey) return null;
      return snapshot;
    },
    corroborateAttempt(candidate, proof) { return planDsnFollowUpFromRecordedAttempt(tx, candidate, proof); },
    async lockFollowUp(followUpKey) {
      await tx.$queryRaw`SELECT id FROM mail_dsn_follow_ups WHERE follow_up_key = ${followUpKey} FOR UPDATE`;
      const row = await tx.mailDsnFollowUp.findUnique({ where: { followUpKey } });
      return row ? { ...row, subjectType: subjectType(row.subjectType), status: taskStatus(row.status) } : null;
    },
    async findObservation(observationKey) {
      const row = await tx.mailDsnObservation.findUnique({ where: { observationKey }, include: { followUp: true } });
      if (!row) return null;
      const task = row.followUp;
      if (row.bindingMailboxId !== row.mailConfigurationId || task.mailConfigurationId !== row.mailConfigurationId ||
          task.followUpKey !== row.followUpKey) throw new Error('Stored DSN observation scope mismatch.');
      return { observationKey: row.observationKey, followUpKey: row.followUpKey, mailConfigurationId: row.mailConfigurationId,
        sourceBindingKey: row.sourceBindingKey, sourceObjectId: row.sourceObjectId, folder: row.folder,
        enhancedStatus: row.enhancedStatus, subjectType: subjectType(task.subjectType), subjectId: task.subjectId,
        attemptId: task.attemptId, recipient: task.recipient, originalMessageId: task.originalMessageId };
    },
    insertFollowUp(task) { return tx.mailDsnFollowUp.create({ data: task, select: { id: true } }); },
    async insertObservation(entry) {
      // The subject fields are stored once on the immutable task identity.
      const { observationKey, followUpKey, mailConfigurationId, sourceBindingKey, sourceObjectId, folder, enhancedStatus } = entry;
      const result = await tx.mailDsnObservation.createMany({ data: [{ observationKey, followUpKey,
        mailConfigurationId, sourceBindingKey, bindingMailboxId: mailConfigurationId, sourceObjectId, folder, enhancedStatus }] });
      return result.count;
    },
    async appendObservationAudit(event) { await audit.record(event, tx); },
  };
}

function resolutionTransaction(tx: Prisma.TransactionClient, audit: Auditor): ResolutionTransaction {
  return {
    async lockCurrentActor(context) {
      // Lock the user, owned session and role membership before the task. A
      // concurrent logout, account disable or role removal must wait or abort.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${context.actorId} FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: context.actorId }, select: { id: true, active: true } });
      if (!user || user.id !== context.actorId || !user.active) return null;
      await tx.$queryRaw`SELECT id FROM auth_sessions WHERE id = ${context.sessionId} FOR UPDATE`;
      const session = await tx.authSession.findUnique({ where: { id: context.sessionId }, select: { id: true, userId: true, createdAt: true, expiresAt: true, revokedAt: true } });
      if (!session || session.id !== context.sessionId || session.userId !== user.id) return null;
      const roles = await tx.$queryRaw<Array<{ code: string }>>`SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ${user.id} FOR UPDATE`;
      return { actorId: user.id, sessionId: session.id, active: user.active, roles: roles.map(row => row.code),
        sessionUserId: session.userId, sessionCreatedAt: session.createdAt, sessionExpiresAt: session.expiresAt, sessionRevokedAt: session.revokedAt };
    },
    async lockTask(taskId) {
      await tx.$queryRaw`SELECT id FROM mail_dsn_follow_ups WHERE id = ${taskId} FOR UPDATE`;
      const task = await tx.mailDsnFollowUp.findUnique({ where: { id: taskId } });
      return task ? { ...task, status: taskStatus(task.status) } : null;
    },
    async compareAndResolve(taskId, expectedRevision, change) {
      const result = await tx.mailDsnFollowUp.updateMany({ where: { id: taskId, revision: expectedRevision,
        status: 'OPEN', resolvedById: null, resolvedAt: null, resolutionReason: null }, data: change });
      return result.count;
    },
    async appendAudit(event) { await audit.record(event, tx); },
  };
}

// ReadCommitted avoids a stale consistent-read snapshot after a row-lock wait.
// No automatic retry: deadlock/uniqueness/audit failures abort the transaction.
export function createPrismaDsnEvidenceStore(prisma: Client, audit: Auditor): DsnEvidenceStore {
  return { transaction: operation => prisma.$transaction(tx => operation(evidenceTransaction(tx, audit)), { isolationLevel: 'ReadCommitted' }) };
}
export function createPrismaDsnResolutionStore(prisma: Client, audit: Auditor): ResolutionStore {
  return { transaction: operation => prisma.$transaction(tx => operation(resolutionTransaction(tx, audit)), { isolationLevel: 'ReadCommitted' }) };
}
