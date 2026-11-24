import type { Prisma } from '../../generated/prisma/client';
import { planDsnFollowUp, type VerifiedDsnProvenance } from './dsn-follow-up-plan';
import { hasAsciiControl } from './mail-evidence-text';

const ATTEMPT_STARTED = 'mail.send.attempt_started';
const MAX_SUBJECT_EVENTS = 32;

type FollowUpPlan = ReturnType<typeof planDsnFollowUp>;
type RecordedFollowUpPlan = FollowUpPlan | {
  outcome: 'REVIEW_ONLY';
  reason: 'ATTEMPT_NOT_CORROBORATED' | 'AUDIT_UNAVAILABLE';
};

function objectValue(value: Prisma.JsonValue | undefined): Prisma.JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function isIdentity(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength &&
    value === value.trim() && !hasAsciiControl(value);
}

/**
 * Corroborates independent server-side provider proof against SMTP audit evidence.
 * No provider, HTTP handler or queue invokes this reader. It changes no database state.
 */
export async function planDsnFollowUpFromRecordedAttempt(
  db: Pick<Prisma.TransactionClient, 'auditEvent'>,
  candidate: Parameters<typeof planDsnFollowUp>[0],
  proof: VerifiedDsnProvenance | null,
): Promise<RecordedFollowUpPlan> {
  if (!proof) return { outcome: 'REVIEW_ONLY', reason: 'UNVERIFIED_SOURCE' };
  const unconfirmed = { outcome: 'REVIEW_ONLY', reason: 'ATTEMPT_NOT_CORROBORATED' } as const;
  const { subject } = proof;
  if ((subject.type !== 'CommunicationOutbox' && subject.type !== 'OperatorReplyOutbox') ||
      !isIdentity(subject.id, 36) || !isIdentity(proof.attemptId, 36) ||
      !isIdentity(proof.mailConfigurationId, 36) || !isIdentity(proof.envelopeRecipient, 320) ||
      !isIdentity(proof.originalMessageId, 500) || !/^<[^<>\s]+@[^<>\s]+>$/.test(proof.originalMessageId) ||
      candidate.mailConfigurationId !== proof.mailConfigurationId || candidate.sourceObjectId !== proof.sourceObjectId) {
    return unconfirmed;
  }

  const acceptedEvent = subject.type === 'CommunicationOutbox'
    ? 'mail.send.succeeded' : 'communication.reply.delivered';
  try {
    const events = await db.auditEvent.findMany({
      where: {
        subjectType: subject.type, subjectId: subject.id, actorType: 'SYSTEM',
        eventKey: { in: [ATTEMPT_STARTED, acceptedEvent] },
      },
      select: { actorType: true, subjectType: true, subjectId: true, eventKey: true, metadata: true },
      take: MAX_SUBJECT_EVENTS + 1,
    });
    if (events.length > MAX_SUBJECT_EVENTS) return unconfirmed;

    const starts: Prisma.JsonObject[] = [];
    const acceptances: Prisma.JsonObject[] = [];
    for (const event of events) {
      const metadata = objectValue(event.metadata);
      if (event.actorType !== 'SYSTEM' || event.subjectType !== subject.type || event.subjectId !== subject.id ||
          (event.eventKey !== ATTEMPT_STARTED && event.eventKey !== acceptedEvent) ||
          !metadata || !isIdentity(metadata.attemptId, 36)) return unconfirmed;
      if (metadata.attemptId !== proof.attemptId) continue;
      (event.eventKey === ATTEMPT_STARTED ? starts : acceptances).push(metadata);
    }

    const start = starts[0];
    const acceptance = objectValue(acceptances[0]?.acceptance);
    const responseCode = acceptance?.responseCode;
    if (starts.length !== 1 || !start || acceptances.length !== 1 ||
        start.mailConfigurationId !== proof.mailConfigurationId ||
        start.messageId !== proof.originalMessageId || start.recipient !== proof.envelopeRecipient ||
        acceptance?.source !== 'smtp' || typeof responseCode !== 'number' ||
        !Number.isInteger(responseCode) || responseCode < 200 || responseCode >= 300) return unconfirmed;

    return planDsnFollowUp(candidate, {
      subject, mailConfigurationId: start.mailConfigurationId, messageId: start.messageId,
      intendedRecipient: start.recipient, attemptId: proof.attemptId,
    }, proof);
  } catch {
    return { outcome: 'REVIEW_ONLY', reason: 'AUDIT_UNAVAILABLE' };
  }
}
