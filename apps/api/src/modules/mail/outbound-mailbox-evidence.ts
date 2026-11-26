import type { PrismaService } from '../../database/prisma.service';
import { parseMessageIdTokens } from './mail-message-correlation.util';

type Subject = 'CommunicationOutbox' | 'OperatorReplyOutbox';
type Event = { actorType: string; eventKey: string; metadata: unknown };
type Attempt = { attemptId: string; mailConfigurationId: string; messageId: string; recipient: string };
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** The durable SMTP audit is the sole source of an outbound attempt identity. */
export function recordedMailboxAttempts(events: readonly Event[], truncated: boolean): Attempt[] {
  if (truncated) return [];
  const byId = new Map<string, Attempt>();
  const duplicates = new Set<string>();
  const seen = new Set<string>();
  for (const event of events) {
    if (event.actorType !== 'SYSTEM' || event.eventKey !== 'mail.send.attempt_started') continue;
    const meta = object(event.metadata);
    if (!meta || typeof meta.attemptId !== 'string' || !meta.attemptId) continue;
    // Count every system start bearing this attempt ID, even if its other fields
    // are malformed. A conflicting durable start must not establish identity.
    if (seen.has(meta.attemptId)) duplicates.add(meta.attemptId);
    seen.add(meta.attemptId);
    if (typeof meta.mailConfigurationId !== 'string' ||
        typeof meta.messageId !== 'string' || typeof meta.recipient !== 'string' ||
        !meta.mailConfigurationId || !meta.recipient) continue;
    const tokens = parseMessageIdTokens(meta.messageId);
    if (tokens.length !== 1 || tokens[0] !== meta.messageId) continue;
    byId.set(meta.attemptId, { attemptId: meta.attemptId, mailConfigurationId: meta.mailConfigurationId, messageId: meta.messageId, recipient: meta.recipient });
  }
  return [...byId.values()].filter(row => !duplicates.has(row.attemptId));
}

/** Read-only projection. A matching Sent header is a mailbox observation, NOT
 * proof of sending, SMTP acceptance, envelope recipient or customer delivery.
 * Independently authenticated DSN follow-ups are shown separately; raw review
 * records are never matched to an outbound subject by guessed headers.
 */
export async function outboundMailboxEvidence(
  db: Pick<PrismaService, 'mailSentObservation' | 'mailDsnFollowUp'>,
  subjectType: Subject,
  subjectId: string,
  events: readonly Event[],
  truncated: boolean,
) {
  const attempts = recordedMailboxAttempts(events, truncated);
  const sent: Array<{ folder: string; observedAt: Date; internalDate: Date | null }> = [];
  let limited = truncated;
  const pairs = new Map(attempts.map(a => [JSON.stringify([a.mailConfigurationId, a.messageId]), a]));
  for (const a of pairs.values()) {
    const rows = await db.mailSentObservation.findMany({
      where: { parseFailed: false, messageIdHeader: a.messageId, folderCheckpoint: { mailConfigurationId: a.mailConfigurationId, sourceKind: 'SENT' } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 21,
      select: { messageIdHeader: true, createdAt: true, internalDate: true, folderCheckpoint: { select: { mailConfigurationId: true, folderName: true } } },
    });
    if (rows.length > 20) limited = true;
    for (const row of rows.slice(0, 20)) {
      // MariaDB collation is not an exact identity boundary.
      if (row.messageIdHeader === a.messageId && row.folderCheckpoint.mailConfigurationId === a.mailConfigurationId)
        sent.push({ folder: row.folderCheckpoint.folderName, observedAt: row.createdAt, internalDate: row.internalDate });
    }
  }
  const tasks = await db.mailDsnFollowUp.findMany({
    where: { subjectType, subjectId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 51,
    select: { id: true, subjectType: true, subjectId: true, mailConfigurationId: true, attemptId: true, recipient: true, originalMessageId: true, status: true, createdAt: true,
      observations: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 6, select: { enhancedStatus: true, createdAt: true } } },
  });
  if (tasks.length > 50) limited = true;
  const successKey = subjectType === 'CommunicationOutbox' ? 'mail.send.succeeded' : 'communication.reply.delivered';
  const hasExactAcceptance = (attemptId: string) => {
    const matching = events.filter(event => event.eventKey === successKey && object(event.metadata)?.attemptId === attemptId);
    const acceptance = object(object(matching[0]?.metadata)?.acceptance);
    return matching.length === 1 && matching[0]?.actorType === 'SYSTEM' && acceptance?.source === 'smtp' && typeof acceptance.responseCode === 'number' && Number.isInteger(acceptance.responseCode) && acceptance.responseCode >= 200 && acceptance.responseCode < 300;
  };
  const followUps = tasks.slice(0, 50).filter(task => task.subjectType === subjectType && task.subjectId === subjectId && hasExactAcceptance(task.attemptId) &&
    attempts.some(a => a.attemptId === task.attemptId && a.mailConfigurationId === task.mailConfigurationId &&
      a.messageId === task.originalMessageId && a.recipient === task.recipient) &&
    task.observations.some(o => /^5\.[0-9]{1,3}\.[0-9]{1,3}$/.test(o.enhancedStatus)))
    .map(task => ({ id: task.id, status: task.status, recipient: task.recipient, createdAt: task.createdAt,
      enhancedStatuses: [...new Set(task.observations.map(o => o.enhancedStatus))] }));
  if (tasks.some(task => task.observations.length > 5)) limited = true;
  return { sent, followUps, limited, recipientDelivery: 'UNVERIFIED' as const };
}
