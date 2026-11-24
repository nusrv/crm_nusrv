import { parseDsnCandidate } from './dsn-candidate-parser';
import { planDsnFollowUp, type VerifiedDsnProvenance } from './dsn-follow-up-plan';

const original = {
  mailConfigurationId: 'mailbox-1',
  messageId: '<Original@crm.example.test>',
  intendedRecipient: 'billing@example.test',
  attemptId: 'attempt-1',
};

const provenance: VerifiedDsnProvenance = {
  mailConfigurationId: original.mailConfigurationId,
  sourceObjectId: 'report-1',
  folder: 'INBOX',
  originalMessageId: original.messageId,
  attemptId: original.attemptId,
  envelopeRecipient: original.intendedRecipient,
  enhancedStatus: '5.1.1',
};

function candidate(sourceObjectId = provenance.sourceObjectId, action = 'failed', status = '5.1.1') {
  const result = parseDsnCandidate({
    mailConfigurationId: original.mailConfigurationId,
    sourceObjectId,
    outerContentType: 'multipart/report; report-type=delivery-status',
    reportPartContentType: 'message/delivery-status',
    reportPartText: `Reporting-MTA: dns; provider.example.test\n\nFinal-Recipient: rfc822; ${original.intendedRecipient}\nAction: ${action}\nStatus: ${status}`,
  });
  if (result.kind !== 'CANDIDATE_DSN') throw new Error('Invalid DSN test fixture');
  return result;
}

describe('DSN human follow-up plan', () => {
  it('keeps even a well-formed hard failure in review without independent provenance', () => {
    expect(planDsnFollowUp(candidate(), original, null)).toEqual({
      outcome: 'REVIEW_ONLY', reason: 'UNVERIFIED_SOURCE',
    });
  });

  it.each([
    { mailConfigurationId: 'other-mailbox' },
    { sourceObjectId: 'another-object' },
    { originalMessageId: '<original@crm.example.test>' },
    { attemptId: 'other-attempt' },
    { envelopeRecipient: 'other@example.test' },
    { enhancedStatus: '5.0.0' },
    { folder: '' },
    { folder: 'INBOX\r\n' },
  ])('requires consistent, exact source and attempt evidence (%j)', (overrides) => {
    expect(planDsnFollowUp(candidate(), original, { ...provenance, ...overrides })).toEqual({
      outcome: 'REVIEW_ONLY', reason: 'IDENTITY_MISMATCH',
    });
  });

  it('keeps a matched, temporary failure in review', () => {
    expect(planDsnFollowUp(candidate('report-1', 'delayed', '4.1.1'), original, {
      ...provenance, enhancedStatus: '4.1.1',
    })).toEqual({ outcome: 'REVIEW_ONLY', reason: 'NO_HARD_FAILURE' });
  });

  it('plans a single human action per exact attempt while retaining individual source identities', () => {
    const first = planDsnFollowUp(candidate(), original, provenance);
    const repeated = planDsnFollowUp(candidate('report-2'), original, { ...provenance, sourceObjectId: 'report-2' });
    const next = planDsnFollowUp(candidate(), { ...original, attemptId: 'attempt-2' }, {
      ...provenance, attemptId: 'attempt-2',
    });
    if (first.outcome !== 'PLAN_HUMAN_FOLLOW_UP' || repeated.outcome !== 'PLAN_HUMAN_FOLLOW_UP' ||
        next.outcome !== 'PLAN_HUMAN_FOLLOW_UP') throw new Error('Missing follow-up plans');
    expect(first).toEqual({
      outcome: 'PLAN_HUMAN_FOLLOW_UP', deduplicationKey: first.deduplicationKey,
      mailConfigurationId: original.mailConfigurationId, attemptId: original.attemptId, sourceObjectId: 'report-1',
    });
    expect(repeated.deduplicationKey).toBe(first.deduplicationKey);
    expect(repeated.sourceObjectId).toBe('report-2');
    expect(next.deduplicationKey).not.toBe(first.deduplicationKey);
  });
});
