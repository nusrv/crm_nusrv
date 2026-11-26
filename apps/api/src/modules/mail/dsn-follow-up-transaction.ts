import { hasAsciiControl } from './mail-ascii-control';
import { prepareDsnLedgerEntry, decideDsnLedgerWrite, type DsnLedgerEntry, type ExistingDsnFollowUp } from './dsn-follow-up-ledger-plan';
import { resolveCurrentProviderBinding, type ProviderBindingSnapshot, type VerifiedProviderAccount } from './mail-provider-binding';
import type { VerifiedDsnProvenance } from './dsn-follow-up-plan';
import type { planDsnFollowUpFromRecordedAttempt } from './dsn-recorded-attempt';

type Candidate = Parameters<typeof planDsnFollowUpFromRecordedAttempt>[1];
type Corroboration = Awaited<ReturnType<typeof planDsnFollowUpFromRecordedAttempt>>;
type StoredFollowUp = ExistingDsnFollowUp & { id: string };
type NewFollowUp = Omit<ExistingDsnFollowUp, 'status'> & {
  status: 'OPEN'; revision: 1; resolvedById: null; resolvedAt: null; resolutionReason: null;
};

/** Internal adapter output only: neither a MIME parser nor an HTTP body can supply provider proof. */
export interface AuthenticatedDsnReport {
  account: VerifiedProviderAccount;
  provenance: VerifiedDsnProvenance;
  candidate: Candidate;
}

/** One transaction. Lock the parent mailbox/current binding before audit reads and task/observation keys.
 * Every evidence writer and binding mutator must use the same lock order. The corroboration adapter
 * must invoke planDsnFollowUpFromRecordedAttempt with this transaction's audit reader. No mail I/O
 * inside the transaction. Uniqueness or audit errors must roll back, never be caught and committed.
 */
export interface DsnEvidenceTransaction {
  lockCurrentBinding(mailConfigurationId: string): Promise<ProviderBindingSnapshot | null>;
  corroborateAttempt(candidate: Candidate, proof: VerifiedDsnProvenance): Promise<Corroboration>;
  lockFollowUp(followUpKey: string): Promise<StoredFollowUp | null>;
  findObservation(observationKey: string): Promise<DsnLedgerEntry | null>;
  insertFollowUp(task: NewFollowUp): Promise<{ id: string }>;
  insertObservation(entry: DsnLedgerEntry): Promise<number>;
  appendObservationAudit(event: {
    actorType: 'SYSTEM'; eventKey: 'mail.dsn.observation.recorded'; subjectType: 'MailDsnFollowUp'; subjectId: string;
    metadata: { observationKey: string; followUpKey: string; taskCreated: boolean };
  }): Promise<void>;
}
export interface DsnEvidenceStore {
  transaction<T>(operation: (tx: DsnEvidenceTransaction) => Promise<T>): Promise<T>;
}
export type DsnEvidenceCommitResult =
  | { outcome: 'REVIEW_ONLY'; reason: string }
  | { outcome: 'NO_CHANGE' }
  | { outcome: 'RECORDED'; taskCreated: boolean };

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 36 &&
    value === value.trim() && !hasAsciiControl(value) && !/[\ud800-\udfff]/u.test(value);
}

/** Unregistered coordinator. Does not authenticate a provider, modify delivery, or send anything.
 * REVIEW_ONLY means the caller still needs to retain/quarantine the report through a separate path.
 */
export async function commitCorroboratedDsnObservation(
  store: DsnEvidenceStore,
  captured: ProviderBindingSnapshot | null,
  report: AuthenticatedDsnReport | null,
): Promise<DsnEvidenceCommitResult> {
  if (!captured || !report?.account || !report.provenance || !report.candidate ||
      !validId(captured.mailConfigurationId) || report.account.mailConfigurationId !== captured.mailConfigurationId ||
      report.provenance.mailConfigurationId !== captured.mailConfigurationId ||
      report.candidate.mailConfigurationId !== captured.mailConfigurationId ||
      report.candidate.sourceObjectId !== report.provenance.sourceObjectId) {
    return { outcome: 'REVIEW_ONLY', reason: 'UNVERIFIED_SOURCE' };
  }
  return store.transaction(async (tx) => {
    const current = await tx.lockCurrentBinding(captured.mailConfigurationId);
    const binding = resolveCurrentProviderBinding(captured, current, report.account);
    if (binding.outcome !== 'BOUND') return { outcome: 'REVIEW_ONLY', reason: binding.outcome };
    const corroborated = await tx.corroborateAttempt(report.candidate, report.provenance);
    if (corroborated.outcome !== 'PLAN_HUMAN_FOLLOW_UP') return corroborated;
    const entry = prepareDsnLedgerEntry(corroborated, report.provenance, binding.binding);
    if (!entry) return { outcome: 'REVIEW_ONLY', reason: 'INVALID_IDENTITY' };
    const existingTask = await tx.lockFollowUp(entry.followUpKey);
    const existingObservation = await tx.findObservation(entry.observationKey);
    const decision = decideDsnLedgerWrite(entry, existingObservation, existingTask);
    if (decision.outcome !== 'INSERT_OBSERVATION') return decision;
    let taskId = existingTask?.id;
    if (decision.createFollowUp) {
      const task = await tx.insertFollowUp({ followUpKey: entry.followUpKey, mailConfigurationId: entry.mailConfigurationId,
        subjectType: entry.subjectType, subjectId: entry.subjectId, attemptId: entry.attemptId,
        recipient: entry.recipient, originalMessageId: entry.originalMessageId,
        status: 'OPEN', revision: 1, resolvedById: null, resolvedAt: null, resolutionReason: null });
      taskId = task.id;
    }
    if (!validId(taskId)) throw new Error('Missing durable follow-up identity; roll back.');
    const count = await tx.insertObservation(entry);
    if (count !== 1) throw new Error('Unexpected DSN observation insert count; roll back.');
    await tx.appendObservationAudit({ actorType: 'SYSTEM', eventKey: 'mail.dsn.observation.recorded',
      subjectType: 'MailDsnFollowUp', subjectId: taskId,
      metadata: { observationKey: entry.observationKey, followUpKey: entry.followUpKey, taskCreated: decision.createFollowUp } });
    return { outcome: 'RECORDED', taskCreated: decision.createFollowUp };
  });
}
