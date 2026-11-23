import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';

export const resendAuthorizationSchema = z.object({
  idempotencyKey: z.uuid(),
  acknowledgeDuplicateRisk: z.literal(true),
}).strict();

export async function hasRecordedSmtpAcceptance(
  db: Pick<Prisma.TransactionClient, 'auditEvent'>,
  subjectType: 'CommunicationOutbox' | 'OperatorReplyOutbox',
  subjectId: string,
) {
  const outcomes = await db.auditEvent.findMany({
    where: { subjectType, subjectId, eventKey: subjectType === 'CommunicationOutbox'
      ? 'mail.send.succeeded' : 'communication.reply.delivered' },
    select: { metadata: true },
  });
  return outcomes.some(({ metadata }) => {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
    const { acceptance } = metadata;
    return acceptance && typeof acceptance === 'object' && !Array.isArray(acceptance) &&
      acceptance.source === 'smtp';
  });
}
