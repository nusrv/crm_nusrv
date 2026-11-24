import { jest } from '@jest/globals';
import type { Prisma } from '../../generated/prisma/client';
import { planDsnFollowUpFromRecordedAttempt } from './dsn-recorded-attempt';
import type { VerifiedDsnProvenance } from './dsn-follow-up-plan';

const proof: VerifiedDsnProvenance = {
  subject: { type: 'CommunicationOutbox', id: 'outbox-1' },
  sourceObjectId: 'provider-object-1',
  mailConfigurationId: 'mailbox-1',
  folder: 'INBOX',
  originalMessageId: '<Original@crm.example.test>',
  attemptId: 'attempt-1',
  envelopeRecipient: 'accounts@example.test',
  enhancedStatus: '5.1.1',
};
const candidate: Parameters<typeof planDsnFollowUpFromRecordedAttempt>[1] = {
  kind: 'CANDIDATE_DSN',
  sourceObjectId: proof.sourceObjectId,
  mailConfigurationId: proof.mailConfigurationId,
  deliveryStatus: 'UNKNOWN',
  requiresHumanReview: true,
  recipients: [{
    action: 'failed', disposition: 'HARD', enhancedStatus: '5.1.1', claimedFinalRecipient: proof.envelopeRecipient,
  }],
};

type AuditRow = Pick<Prisma.AuditEventGetPayload<Record<string, never>>,
  'actorType' | 'subjectType' | 'subjectId' | 'eventKey' | 'metadata'>;
const started: AuditRow = {
  actorType: 'SYSTEM', subjectType: proof.subject.type, subjectId: proof.subject.id, eventKey: 'mail.send.attempt_started',
  metadata: {
    attemptId: proof.attemptId, mailConfigurationId: proof.mailConfigurationId,
    messageId: proof.originalMessageId, recipient: proof.envelopeRecipient,
  },
};
const accepted: AuditRow = {
  ...started, eventKey: 'mail.send.succeeded',
  metadata: { attemptId: proof.attemptId, applied: false, acceptance: { source: 'smtp', responseCode: 250 } },
};

function audit(...rows: AuditRow[]) {
  const findMany = jest.fn(() => Promise.resolve(rows));
  const db = { auditEvent: { findMany } } as unknown as Parameters<typeof planDsnFollowUpFromRecordedAttempt>[0];
  return { db, findMany };
}

describe('DSN outbound-attempt audit verification', () => {
  it('queries only the trusted subject and accepts real SMTP proof recorded after a lost lease', async () => {
    const { db, findMany } = audit(started, accepted);
    await expect(planDsnFollowUpFromRecordedAttempt(db, candidate, proof)).resolves.toMatchObject({
      outcome: 'PLAN_HUMAN_FOLLOW_UP', subject: proof.subject, attemptId: proof.attemptId,
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        subjectType: 'CommunicationOutbox', subjectId: 'outbox-1', actorType: 'SYSTEM',
        eventKey: { in: ['mail.send.attempt_started', 'mail.send.succeeded'] },
      },
      select: { actorType: true, subjectType: true, subjectId: true, eventKey: true, metadata: true },
      take: 33,
    });
  });

  it('keeps operator replies separate from the notification outbox', async () => {
    const operatorProof = { ...proof, subject: { ...proof.subject, type: 'OperatorReplyOutbox' as const } };
    const { db } = audit(
      { ...started, subjectType: operatorProof.subject.type },
      { ...accepted, subjectType: operatorProof.subject.type, eventKey: 'communication.reply.delivered' },
    );
    const plan = await planDsnFollowUpFromRecordedAttempt(db, candidate, operatorProof);
    const notification = await planDsnFollowUpFromRecordedAttempt(audit(started, accepted).db, candidate, proof);
    expect(plan.outcome).toBe('PLAN_HUMAN_FOLLOW_UP');
    expect(notification.outcome).toBe('PLAN_HUMAN_FOLLOW_UP');
    if (plan.outcome === 'PLAN_HUMAN_FOLLOW_UP' && notification.outcome === 'PLAN_HUMAN_FOLLOW_UP') {
      expect(plan.deduplicationKey).not.toBe(notification.deduplicationKey);
    }
  });

  it('does no audit lookup when proof is absent, aliases an object, or supplies an internal message ID', async () => {
    const { db, findMany } = audit(started, accepted);
    for (const unverified of [null, { ...proof, sourceObjectId: 'different' }, { ...proof, originalMessageId: 'local-id' }]) {
      await expect(planDsnFollowUpFromRecordedAttempt(db, candidate, unverified)).resolves.toMatchObject({
        outcome: 'REVIEW_ONLY',
      });
    }
    expect(findMany).not.toHaveBeenCalled();
  });

  it('keeps missing, duplicate, differently cased, mock, and over-limit audit evidence in review', async () => {
    for (const rows of [
      [started],
      [started, started, accepted],
      [started, accepted, accepted],
      [started, { ...accepted, subjectId: proof.subject.id.toUpperCase() }],
      [started, { ...accepted, metadata: { attemptId: proof.attemptId, acceptance: { source: 'mock' } } }],
      [started, accepted, ...Array.from({ length: 31 }, () => started)],
    ]) {
      await expect(planDsnFollowUpFromRecordedAttempt(audit(...rows).db, candidate, proof)).resolves.toEqual({
        outcome: 'REVIEW_ONLY', reason: 'ATTEMPT_NOT_CORROBORATED',
      });
    }
  });

  it('keeps the candidate in review when the audit lookup fails', async () => {
    const { db, findMany } = audit();
    findMany.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(planDsnFollowUpFromRecordedAttempt(db, candidate, proof)).resolves.toEqual({
      outcome: 'REVIEW_ONLY', reason: 'AUDIT_UNAVAILABLE',
    });
  });
});
