import {
  classifyObservedMailEvidence,
  type ObservedMailEvidence,
  type OriginalOutboundIdentity,
} from './active-email-evidence';

const expected: OriginalOutboundIdentity = {
  mailConfigurationId: 'mailbox-A',
  messageId: '<CaseSensitive@provider.example>',
  intendedRecipient: 'billing@example.test',
  attemptId: 'attempt-1',
};

function evidence(overrides: Partial<ObservedMailEvidence> = {}): ObservedMailEvidence {
  return {
    stream: 'SENT',
    mailConfigurationId: expected.mailConfigurationId,
    sourceObjectId: 'source-42',
    folder: 'Sent Items',
    messageId: expected.messageId,
    envelopeRecipient: expected.intendedRecipient,
    attemptId: expected.attemptId,
    ...overrides,
  };
}

describe('P2.A read-only email evidence classification (OD-12 / CL-5 / CL-6)', () => {
  it('does not infer SMTP acceptance or recipient delivery from an observed Sent copy', () => {
    expect(classifyObservedMailEvidence(expected, evidence())).toEqual({
      kind: 'OBSERVED_SENT', deliveryStatus: 'UNKNOWN', sourceObjectId: 'source-42',
    });
  });

  it('treats DSN content as a candidate, never a confirmed bounce or automatic resend', () => {
    expect(classifyObservedMailEvidence(expected, evidence({
      stream: 'DSN', dsnDisposition: 'HARD', folder: 'INBOX',
    }))).toEqual({
      kind: 'CANDIDATE_DSN', disposition: 'HARD',
      deliveryStatus: 'UNKNOWN', sourceObjectId: 'source-42',
    });
    expect(classifyObservedMailEvidence(expected, evidence({
      stream: 'DSN', folder: 'INBOX',
    }))).toMatchObject({ disposition: 'UNCLASSIFIED', deliveryStatus: 'UNKNOWN' });
  });

  it('rejects a message ID with changed case even when the database collation may be insensitive', () => {
    expect(classifyObservedMailEvidence(expected, evidence({
      messageId: '<casesensitive@provider.example>',
    }))).toEqual({ kind: 'UNMATCHED', reason: 'IDENTITY_MISMATCH' });
  });

  it('rejects other mailbox, recipient and attempt evidence rather than guessing', () => {
    for (const bad of [
      { mailConfigurationId: 'mailbox-B' },
      { envelopeRecipient: 'other@example.test' },
      { attemptId: 'attempt-2' },
      { messageId: '<other@provider.example>' },
    ]) {
      expect(classifyObservedMailEvidence(expected, evidence(bad)).kind).toBe('UNMATCHED');
    }
  });

  it('fails closed on missing source identity, folder, recipient, or unbound attempt', () => {
    for (const bad of [
      { sourceObjectId: ' ' },
      { folder: null },
      { messageId: null },
      { envelopeRecipient: null },
      { attemptId: null },
    ]) {
      expect(classifyObservedMailEvidence(expected, evidence(bad))).toEqual({
        kind: 'UNMATCHED', reason: 'SOURCE_INCOMPLETE',
      });
    }
  });

  it('accepts a provider observation without an IMAP folder but still leaves delivery UNKNOWN', () => {
    expect(classifyObservedMailEvidence(expected, evidence({
      stream: 'PROVIDER', folder: null,
    }))).toEqual({
      kind: 'PROVIDER_OBSERVATION', deliveryStatus: 'UNKNOWN', sourceObjectId: 'source-42',
    });
  });

  it('does not treat a generic inbound observation as an authenticated customer reply', () => {
    expect(classifyObservedMailEvidence(expected, evidence({
      stream: 'INBOX', folder: 'INBOX',
    }))).toEqual({
      kind: 'INBOUND_OBSERVATION', deliveryStatus: 'UNKNOWN', sourceObjectId: 'source-42',
    });
  });
});
