import { hasAsciiControl } from './mail-ascii-control';
/** Read-only summary of the existing, server-written SMTP audit records.
 * SMTP acceptance is not recipient delivery, and does not authorize a resend.
 * A truncated or contradictory history is never upgraded to confirmed evidence. */
type SubjectType = 'CommunicationOutbox' | 'OperatorReplyOutbox';
interface Event { actorType: string; eventKey: string; metadata: unknown }
type Summary = { state: 'SMTP_ACCEPTED' | 'MOCK_ONLY' | 'UNVERIFIED' | 'REVIEW_REQUIRED'; responseCode: number | null };

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const identity = (value: unknown): value is string => typeof value === 'string' && value.length > 0 &&
  value.length <= 500 && value === value.trim() && !hasAsciiControl(value);

export function summarizeSmtpEvidence(subject: SubjectType, events: readonly Event[], truncated = false): Summary {
  const result = (state: Summary['state'], responseCode: number | null = null): Summary => ({ state, responseCode });
  if (truncated) return result('REVIEW_REQUIRED');
  const successKey = subject === 'CommunicationOutbox' ? 'mail.send.succeeded' : 'communication.reply.delivered';
  const starts = new Map<string, number>();
  const accepted = new Map<string, number | 'mock'>();
  for (const event of events) {
    if (event.eventKey !== 'mail.send.attempt_started' && event.eventKey !== successKey) continue;
    if (event.actorType !== 'SYSTEM') return result('REVIEW_REQUIRED');
    const meta = object(event.metadata);
    if (!meta || !identity(meta.attemptId)) return result('UNVERIFIED');
    const id = meta.attemptId;
    if (event.eventKey === 'mail.send.attempt_started') {
      if (!identity(meta.mailConfigurationId) || !identity(meta.messageId) || !identity(meta.recipient)) return result('REVIEW_REQUIRED');
      starts.set(id, (starts.get(id) ?? 0) + 1);
      if (starts.get(id) !== 1) return result('REVIEW_REQUIRED');
    } else {
      if (accepted.has(id)) return result('REVIEW_REQUIRED');
      const acceptance = object(meta.acceptance);
      if (acceptance?.source === 'mock') accepted.set(id, 'mock');
      else if (acceptance?.source === 'smtp' && typeof acceptance.responseCode === 'number' &&
          Number.isInteger(acceptance.responseCode) && acceptance.responseCode >= 200 && acceptance.responseCode < 300) {
        accepted.set(id, acceptance.responseCode);
      } else return result('UNVERIFIED');
    }
  }
  for (const id of accepted.keys()) if (starts.get(id) !== 1) return result('REVIEW_REQUIRED');
  if (accepted.size > 1) return result('REVIEW_REQUIRED');
  const acceptance = accepted.values().next().value;
  return typeof acceptance === 'number' ? result('SMTP_ACCEPTED', acceptance) :
    acceptance === 'mock' ? result('MOCK_ONLY') : result('UNVERIFIED');
}
