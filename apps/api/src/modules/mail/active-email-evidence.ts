/**
 * P2.A — read-only evidence classification, deliberately NOT wired to ingestion
 * workers, customer state transitions, or outbound delivery logic.
 *
 * This is not an SMTP/IMAP identity verifier. Upstream trusted adapters must
 * separately verify mailbox ownership, provider source, DSN structure and the
 * exact outbound attempt before evidence may become authoritative. A Sent
 * folder copy and a parsed DSN can never, by themselves, prove acceptance,
 * recipient delivery or a hard bounce.
 */
export type EvidenceStream = 'INBOX' | 'SENT' | 'PROVIDER' | 'DSN';
export type DsnDisposition = 'HARD' | 'SOFT' | 'UNCLASSIFIED';

export interface OriginalOutboundIdentity {
  mailConfigurationId: string;
  messageId: string;
  intendedRecipient: string;
  attemptId: string;
}

export interface ObservedMailEvidence {
  stream: EvidenceStream;
  mailConfigurationId: string;
  sourceObjectId: string;
  /** Exact provider/IMAP folder name. Do not silently substitute Inbox/Sent. */
  folder: string | null;
  messageId: string | null;
  envelopeRecipient: string | null;
  /** Only an adapter with reliable attempt-level provenance may supply this. */
  attemptId: string | null;
  dsnDisposition?: DsnDisposition;
}

export type EvidenceReviewResult =
  | { kind: 'UNMATCHED'; reason: 'SOURCE_INCOMPLETE' | 'SOURCE_SCOPE_MISMATCH' | 'IDENTITY_MISMATCH' }
  | { kind: 'OBSERVED_SENT'; deliveryStatus: 'UNKNOWN'; sourceObjectId: string }
  | { kind: 'POSSIBLE_REPLY'; deliveryStatus: 'UNKNOWN'; sourceObjectId: string }
  | { kind: 'CANDIDATE_DSN'; disposition: DsnDisposition; deliveryStatus: 'UNKNOWN'; sourceObjectId: string }
  | { kind: 'PROVIDER_OBSERVATION'; deliveryStatus: 'UNKNOWN'; sourceObjectId: string };

/** No normalization of Message-ID local tokens: identity is case-sensitive. */
export function classifyObservedMailEvidence(
  expected: OriginalOutboundIdentity,
  observed: ObservedMailEvidence,
): EvidenceReviewResult {
  const sourceObjectId = observed.sourceObjectId.trim();

  if (!sourceObjectId || !observed.folder?.trim() && observed.stream !== 'PROVIDER' ||
      !observed.mailConfigurationId.trim() || !expected.mailConfigurationId.trim() ||
      !observed.messageId?.trim() || !observed.envelopeRecipient?.trim() ||
      !observed.attemptId?.trim() || !expected.attemptId.trim() ||
      !expected.messageId.trim() || !expected.intendedRecipient.trim()) {
    return { kind: 'UNMATCHED', reason: 'SOURCE_INCOMPLETE' };
  }
  if (observed.mailConfigurationId !== expected.mailConfigurationId) {
    return { kind: 'UNMATCHED', reason: 'SOURCE_SCOPE_MISMATCH' };
  }
  if (observed.messageId !== expected.messageId ||
      observed.envelopeRecipient !== expected.intendedRecipient ||
      observed.attemptId !== expected.attemptId) {
    return { kind: 'UNMATCHED', reason: 'IDENTITY_MISMATCH' };
  }

  // These are observations for later administrative review. There is
  // intentionally no ACCEPTED, DELIVERED, or CONFIRMED_BOUNCE result here.
  switch (observed.stream) {
    case 'SENT':
      return { kind: 'OBSERVED_SENT', deliveryStatus: 'UNKNOWN', sourceObjectId };
    case 'DSN':
      return {
        kind: 'CANDIDATE_DSN',
        disposition: observed.dsnDisposition ?? 'UNCLASSIFIED',
        deliveryStatus: 'UNKNOWN',
        sourceObjectId,
      };
    case 'PROVIDER':
      return { kind: 'PROVIDER_OBSERVATION', deliveryStatus: 'UNKNOWN', sourceObjectId };
    case 'INBOX':
      return { kind: 'POSSIBLE_REPLY', deliveryStatus: 'UNKNOWN', sourceObjectId };
  }
}
