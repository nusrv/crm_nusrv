import { jest } from '@jest/globals';
import { outboundMailboxEvidence, recordedMailboxAttempts } from './outbound-mailbox-evidence';

const attempt = { actorType: 'SYSTEM', eventKey: 'mail.send.attempt_started', metadata: { attemptId: 'a', mailConfigurationId: 'mail', messageId: '<A@example.test>', recipient: 'buyer@example.test' } };
const now = new Date('2026-11-26T00:00:00Z');
describe('outbound mailbox evidence read model', () => {
  it('rejects duplicate, truncated, user-written and invalid attempt identity', () => {
    expect(recordedMailboxAttempts([attempt, attempt], false)).toEqual([]);
    expect(recordedMailboxAttempts([attempt], true)).toEqual([]);
    expect(recordedMailboxAttempts([{ ...attempt, actorType: 'USER' }], false)).toEqual([]);
    expect(recordedMailboxAttempts([{ ...attempt, metadata: { ...attempt.metadata, messageId: 'not an ID' } }], false)).toEqual([]);
  });
  it('rejects a duplicate system attempt identity even when one start is malformed', () => {
    const malformed = { ...attempt, metadata: { ...attempt.metadata, messageId: 'not an ID' } };
    expect(recordedMailboxAttempts([attempt, malformed], false)).toEqual([]);
    expect(recordedMailboxAttempts([malformed, attempt], false)).toEqual([]);
    const unrelated = { ...malformed, metadata: { ...malformed.metadata, attemptId: 'b' } };
    expect(recordedMailboxAttempts([attempt, unrelated], false)).toEqual([attempt.metadata]);
  });
  it('observes an exact scoped Sent header without promoting it to delivery', async () => {
    const row = { messageIdHeader: '<A@example.test>', createdAt: now, internalDate: now, folderCheckpoint: { mailConfigurationId: 'mail', folderName: 'Sent' } };
    const db = { mailSentObservation: { findMany: jest.fn(() => Promise.resolve([row, { ...row, messageIdHeader: '<a@example.test>' }, { ...row, folderCheckpoint: { mailConfigurationId: 'other', folderName: 'Sent' } }])) }, mailDsnFollowUp: { findMany: jest.fn(() => Promise.resolve([])) } };
    const result = await outboundMailboxEvidence(db as never, 'CommunicationOutbox', 'outbox', [attempt], false);
    expect(result.sent).toHaveLength(1);
    expect(result.recipientDelivery).toBe('UNVERIFIED');
  });
  it('shows only corroborated stored hard-failure follow-ups, not inferred bounces', async () => {
    const task = { id: 'task', subjectType: 'OperatorReplyOutbox', subjectId: 'outbox', mailConfigurationId: 'mail', attemptId: 'a', recipient: 'buyer@example.test', originalMessageId: '<A@example.test>', status: 'OPEN', createdAt: now, observations: [{ enhancedStatus: '5.1.1', createdAt: now }] };
    const db = { mailSentObservation: { findMany: jest.fn(() => Promise.resolve([])) }, mailDsnFollowUp: { findMany: jest.fn(() => Promise.resolve([task, { ...task, id: 'wrong', recipient: 'other@example.test' }, { ...task, id: 'soft', observations: [{ enhancedStatus: '4.1.1', createdAt: now }] }])) } };
    const success = { actorType: 'SYSTEM', eventKey: 'communication.reply.delivered', metadata: { attemptId: 'a', acceptance: { source: 'smtp', responseCode: 250 } } };
    expect((await outboundMailboxEvidence(db as never, 'OperatorReplyOutbox', 'outbox', [attempt], false)).followUps).toEqual([]);
    const result = await outboundMailboxEvidence(db as never, 'OperatorReplyOutbox', 'outbox', [attempt, success], false);
    expect(result.followUps.map(item => item.id)).toEqual(['task']);
    expect(result.recipientDelivery).toBe('UNVERIFIED');
  });
});
