import { createHash } from 'node:crypto';
import type { planDsnFollowUp, VerifiedDsnProvenance } from './dsn-follow-up-plan';

type CorroboratedPlan = Extract<ReturnType<typeof planDsnFollowUp>, { outcome: 'PLAN_HUMAN_FOLLOW_UP' }>;

/** An independently verified, current provider-account binding, not a MIME header or caller-supplied account. */
export interface DsnSourceBinding {
  mailConfigurationId: string;
  sourceBindingKey: string;
}

export interface DsnLedgerEntry {
  observationKey: string;
  followUpKey: string;
  mailConfigurationId: string;
  sourceBindingKey: string;
  sourceObjectId: string;
  folder: string;
  subjectType: 'CommunicationOutbox' | 'OperatorReplyOutbox';
  subjectId: string;
  attemptId: string;
  recipient: string;
  originalMessageId: string;
  enhancedStatus: string;
}

type FollowUpIdentity = Pick<DsnLedgerEntry, 'followUpKey' | 'mailConfigurationId' | 'subjectType' | 'subjectId' | 'attemptId' | 'recipient' | 'originalMessageId'>;
export type ExistingDsnFollowUp = FollowUpIdentity & { status: 'OPEN' | 'RESOLVED' };
export type DsnLedgerDecision =
  | { outcome: 'REVIEW_ONLY'; reason: 'INVALID_IDENTITY' | 'OBSERVATION_CONFLICT' | 'FOLLOW_UP_CONFLICT' | 'MISSING_FOLLOW_UP' }
  | { outcome: 'NO_CHANGE' }
  | { outcome: 'INSERT_OBSERVATION'; createFollowUp: boolean };

function identity(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum &&
    value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value) &&
    !/[\ud800-\udfff]/u.test(value);
}

function hash(prefix: string, fields: string[]): string {
  return prefix + createHash('sha256').update(JSON.stringify(fields), 'utf8').digest('hex');
}

/**
 * Inert write-plan only. Invoke only after independent provider authentication
 * and planDsnFollowUpFromRecordedAttempt. Binding must come from the trusted
 * current account, and sourceObjectId must be a stable provider event identity
 * within that binding (not a MIME Message-ID or a bare IMAP UID).
 * Neither this function nor a matching hash authenticates provider evidence.
 */
export function prepareDsnLedgerEntry(
  plan: CorroboratedPlan | null,
  proof: VerifiedDsnProvenance | null,
  binding: DsnSourceBinding | null,
): DsnLedgerEntry | null {
  if (!plan || plan.outcome !== 'PLAN_HUMAN_FOLLOW_UP' || !proof || !binding ||
      !proof.subject || !plan.subject ||
      !identity(binding.sourceBindingKey, 128) || !identity(binding.mailConfigurationId, 36) ||
      proof.mailConfigurationId !== binding.mailConfigurationId || plan.mailConfigurationId !== binding.mailConfigurationId ||
      !identity(proof.sourceObjectId, 256) || plan.sourceObjectId !== proof.sourceObjectId ||
      !identity(proof.folder, 255) || plan.folder !== proof.folder ||
      (proof.subject.type !== 'CommunicationOutbox' && proof.subject.type !== 'OperatorReplyOutbox') ||
      !identity(proof.subject.id, 36) || plan.subject.type !== proof.subject.type || plan.subject.id !== proof.subject.id ||
      !identity(proof.attemptId, 36) || plan.attemptId !== proof.attemptId ||
      !identity(proof.envelopeRecipient, 320) || plan.recipient !== proof.envelopeRecipient || !/^[^\s;<>@]+@[^\s;<>@]+$/u.test(proof.envelopeRecipient) ||
      !identity(proof.originalMessageId, 500) || plan.originalMessageId !== proof.originalMessageId || !/^<[^<>\s]+@[^<>\s]+>$/u.test(proof.originalMessageId) ||
      !identity(proof.enhancedStatus, 9) || plan.enhancedStatus !== proof.enhancedStatus || !/^5\.[0-9]{1,3}\.[0-9]{1,3}$/u.test(proof.enhancedStatus)) return null;

  const followUpKey = hash('dsn-hard:v2:', [binding.mailConfigurationId, proof.subject.type,
    proof.subject.id, proof.attemptId, proof.envelopeRecipient]);
  if (followUpKey !== plan.deduplicationKey) return null;
  return {
    observationKey: hash('dsn-event:v1:', [binding.mailConfigurationId, binding.sourceBindingKey, proof.sourceObjectId]),
    followUpKey,
    mailConfigurationId: binding.mailConfigurationId,
    sourceBindingKey: binding.sourceBindingKey,
    sourceObjectId: proof.sourceObjectId,
    folder: proof.folder,
    subjectType: proof.subject.type,
    subjectId: proof.subject.id,
    attemptId: proof.attemptId,
    recipient: proof.envelopeRecipient,
    originalMessageId: proof.originalMessageId,
    enhancedStatus: proof.enhancedStatus,
  };
}

const OBSERVATION_FIELDS = [
  'observationKey', 'followUpKey', 'mailConfigurationId', 'sourceBindingKey', 'sourceObjectId', 'folder',
  'subjectType', 'subjectId', 'attemptId', 'recipient', 'originalMessageId', 'enhancedStatus',
] as const satisfies readonly (keyof DsnLedgerEntry)[];
const FOLLOW_UP_FIELDS = [
  'followUpKey', 'mailConfigurationId', 'subjectType', 'subjectId', 'attemptId', 'recipient', 'originalMessageId',
] as const satisfies readonly (keyof FollowUpIdentity)[];

/**
 * Future transaction contract: lock/recheck the current binding, load both
 * records by unique keys, decide and insert atomically. On a uniqueness race,
 * reload and re-plan, never update or reopen an existing task. A conflicting
 * reused source identity (including multi-recipient ambiguity) is review-only.
 * No delivery, SMTP acceptance, case state, or send operation is represented.
 */
export function decideDsnLedgerWrite(
  entry: DsnLedgerEntry | null,
  existingObservation: DsnLedgerEntry | null,
  existingFollowUp: ExistingDsnFollowUp | null,
): DsnLedgerDecision {
  if (!entry) return { outcome: 'REVIEW_ONLY', reason: 'INVALID_IDENTITY' };
  if (existingObservation && OBSERVATION_FIELDS.some((key) => existingObservation[key] !== entry[key])) {
    return { outcome: 'REVIEW_ONLY', reason: 'OBSERVATION_CONFLICT' };
  }
  if (existingFollowUp && (FOLLOW_UP_FIELDS.some((key) => existingFollowUp[key] !== entry[key]) ||
      (existingFollowUp.status !== 'OPEN' && existingFollowUp.status !== 'RESOLVED'))) {
    return { outcome: 'REVIEW_ONLY', reason: 'FOLLOW_UP_CONFLICT' };
  }
  if (existingObservation) return existingFollowUp ? { outcome: 'NO_CHANGE' } :
    { outcome: 'REVIEW_ONLY', reason: 'MISSING_FOLLOW_UP' };
  return { outcome: 'INSERT_OBSERVATION', createFollowUp: !existingFollowUp };
}
