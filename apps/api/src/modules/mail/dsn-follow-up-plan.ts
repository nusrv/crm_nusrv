import { createHash } from 'node:crypto';
import { classifyObservedMailEvidence, type OriginalOutboundIdentity } from './active-email-evidence';
import type { DsnCandidateParseResult } from './dsn-candidate-parser';
import { hasAsciiControl } from './mail-evidence-text';

type Candidate = Extract<DsnCandidateParseResult, { kind: 'CANDIDATE_DSN' }>;

export interface OutboundDsnSubject {
  type: 'CommunicationOutbox' | 'OperatorReplyOutbox';
  id: string;
}

type DsnOutboundIdentity = OriginalOutboundIdentity & { subject: OutboundDsnSubject };

/**
 * An independently authenticated provider report, resolved by a server-side adapter.
 * MIME headers, sender address, mailbox membership and Sent observations cannot populate this
 * contract. There is currently no registered adapter or caller that supplies this value.
 */
export interface VerifiedDsnProvenance {
  subject: OutboundDsnSubject;
  mailConfigurationId: string;
  sourceObjectId: string;
  folder: string;
  originalMessageId: string;
  attemptId: string;
  envelopeRecipient: string;
  enhancedStatus: string;
}

type DsnFollowUpPlan =
  | { outcome: 'REVIEW_ONLY'; reason: 'UNVERIFIED_SOURCE' | 'IDENTITY_MISMATCH' | 'NO_HARD_FAILURE' }
  | {
    outcome: 'PLAN_HUMAN_FOLLOW_UP';
    deduplicationKey: string;
    subject: OutboundDsnSubject;
    mailConfigurationId: string;
    attemptId: string;
    sourceObjectId: string;
    folder: string;
    originalMessageId: string;
    recipient: string;
    enhancedStatus: string;
  };

/** Plan one human action per exact attempt/recipient across repeated provider reports. */
export function planDsnFollowUp(
  candidate: Candidate,
  original: DsnOutboundIdentity,
  provenance: VerifiedDsnProvenance | null,
): DsnFollowUpPlan {
  if (!provenance) return { outcome: 'REVIEW_ONLY', reason: 'UNVERIFIED_SOURCE' };
  const identityFields = [
    provenance.mailConfigurationId, provenance.sourceObjectId, provenance.folder,
    provenance.originalMessageId, provenance.attemptId, provenance.envelopeRecipient, provenance.enhancedStatus,
    provenance.subject.id,
  ];
  if (candidate.mailConfigurationId !== provenance.mailConfigurationId ||
      candidate.sourceObjectId !== provenance.sourceObjectId ||
      original.subject.type !== provenance.subject.type || original.subject.id !== provenance.subject.id ||
      identityFields.some((value) => typeof value !== 'string' || !value ||
        value !== value.trim() || hasAsciiControl(value))) {
    return { outcome: 'REVIEW_ONLY', reason: 'IDENTITY_MISMATCH' };
  }

  const identity = classifyObservedMailEvidence(original, {
    stream: 'DSN',
    mailConfigurationId: provenance.mailConfigurationId,
    sourceObjectId: provenance.sourceObjectId,
    folder: provenance.folder,
    messageId: provenance.originalMessageId,
    envelopeRecipient: provenance.envelopeRecipient,
    attemptId: provenance.attemptId,
  });
  const matches = candidate.recipients.filter((entry) => entry.claimedFinalRecipient === provenance.envelopeRecipient);
  const recipient = matches[0];
  if (identity.kind !== 'CANDIDATE_DSN' || matches.length !== 1 ||
      recipient?.enhancedStatus !== provenance.enhancedStatus) {
    return { outcome: 'REVIEW_ONLY', reason: 'IDENTITY_MISMATCH' };
  }
  if (recipient.action !== 'failed' || recipient.disposition !== 'HARD' ||
      !/^5\.[0-9]{1,3}\.[0-9]{1,3}$/.test(provenance.enhancedStatus)) {
    return { outcome: 'REVIEW_ONLY', reason: 'NO_HARD_FAILURE' };
  }

  const tuple = JSON.stringify([
    original.mailConfigurationId, original.subject.type, original.subject.id,
    original.attemptId, original.intendedRecipient,
  ]);
  return {
    outcome: 'PLAN_HUMAN_FOLLOW_UP',
    deduplicationKey: `dsn-hard:v2:${createHash('sha256').update(tuple, 'utf8').digest('hex')}`,
    subject: original.subject,
    mailConfigurationId: original.mailConfigurationId,
    attemptId: original.attemptId,
    sourceObjectId: provenance.sourceObjectId,
    folder: provenance.folder,
    originalMessageId: provenance.originalMessageId,
    recipient: provenance.envelopeRecipient,
    enhancedStatus: provenance.enhancedStatus,
  };
}
