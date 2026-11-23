import { jest } from '@jest/globals';
import { MailOutboundService } from './mail-outbound.service';
import { OperatorReplyOutboundService } from '../communications/operator-reply-outbound.service';

const LEASE = new Date('2026-11-23T12:00:00.000Z');
const EVIDENCE = {
  messageId: '<outbound@example.test>',
  mailConfigurationId: 'mail-1',
  recipient: 'billing@example.test',
  authorizedBy: 'admin-1',
};

type WorkerAttempt = {
  markAttempt(
    id: string,
    lease: Date,
    evidence: typeof EVIDENCE,
    row: { resendOfId: string | null },
  ): Promise<string | null>;
};

function harness(prototype: object, table: 'communicationOutbox' | 'operatorReplyOutbox', acceptance: boolean) {
  const calls: string[] = [];
  const findMany = jest.fn(async () => {
    calls.push('check-original-evidence');
    return acceptance ? [{ metadata: { acceptance: { source: 'smtp' } } }] : [];
  });
  const updateMany = jest.fn(async (input: { data: { status?: string } }) => {
    calls.push(input.data.status === 'CANCELLED' ? 'cancel-superseded' : 'reserve-attempt');
    return { count: 1 };
  });
  const queryRaw = jest.fn(async () => {
    calls.push('lock-original');
    return [{ id: 'original-1' }];
  });
  const record = jest.fn(async (event: { eventKey: string }) => {
    calls.push(event.eventKey.endsWith('.cancelled') ? 'audit-cancellation' : 'audit-attempt');
    return { id: 'audit-1' };
  });
  const tx = {
    $queryRaw: queryRaw,
    auditEvent: { findMany },
    communicationOutbox: { updateMany },
    operatorReplyOutbox: { updateMany },
  };
  const prisma = {
    $transaction: async <T>(callback: (transaction: typeof tx) => Promise<T>): Promise<T> => callback(tx),
  };
  const service = Object.assign(Object.create(prototype) as object, {
    prisma, audit: { record },
  }) as unknown as WorkerAttempt;
  return { service, calls, findMany, updateMany, queryRaw, record, table };
}

describe.each([
  ['renewal customer outbox', MailOutboundService.prototype, 'communicationOutbox'],
  ['operator reply outbox', OperatorReplyOutboundService.prototype, 'operatorReplyOutbox'],
] as const)('P1 late-acceptance resend barrier — %s', (_label, prototype, table) => {
  it('does not mark a new SMTP attempt if the original was accepted before the attempt boundary', async () => {
    const h = harness(prototype, table, true);
    const result = await h.service.markAttempt('resend-1', LEASE, EVIDENCE, { resendOfId: 'original-1' });
    expect(result).toBeNull();
    expect(h.calls).toEqual(['lock-original', 'check-original-evidence', 'cancel-superseded', 'audit-cancellation']);
    expect(h.updateMany).toHaveBeenCalledTimes(1);
    expect(h.record).toHaveBeenCalledTimes(1);
    expect(h.updateMany.mock.calls[0]![0].data.status).toBe('CANCELLED');
  });

  it('locks the original before starting an explicitly authorized resend with no acceptance evidence', async () => {
    const h = harness(prototype, table, false);
    const result = await h.service.markAttempt('resend-1', LEASE, EVIDENCE, { resendOfId: 'original-1' });
    expect(result).toMatch(/^[a-f0-9-]{36}$/i);
    expect(h.calls).toEqual(['lock-original', 'check-original-evidence', 'reserve-attempt', 'audit-attempt']);
    expect(h.updateMany).toHaveBeenCalledTimes(1);
    expect(h.record).toHaveBeenCalledTimes(1);
  });

  it('does not unnecessarily lock or inspect another outbox for an ordinary first send', async () => {
    const h = harness(prototype, table, true);
    const result = await h.service.markAttempt('ordinary-1', LEASE, EVIDENCE, { resendOfId: null });
    expect(result).toMatch(/^[a-f0-9-]{36}$/i);
    expect(h.calls).toEqual(['reserve-attempt', 'audit-attempt']);
    expect(h.queryRaw).not.toHaveBeenCalled();
    expect(h.findMany).not.toHaveBeenCalled();
  });
});

/**
 * This tests the opposite side of the resend barrier. Even when the original
 * lease has been quarantined, its SMTP acceptance audit must commit under the
 * same original-row lock that markAttempt() uses for a proposed resend.
 * Synthetic transaction mock: isolated MariaDB must still prove lock ordering.
 */
describe.each([
  ['renewal customer outbox', MailOutboundService.prototype, 'communicationOutbox'],
  ['operator reply outbox', OperatorReplyOutboundService.prototype, 'operatorReplyOutbox'],
] as const)('P1 late original SMTP acceptance serialization — %s', (_label, prototype, table) => {
  it('locks the original row before recording acceptance even after ownership was lost', async () => {
    const events: string[] = [];
    const updateMany = jest.fn(async () => {
      events.push('update-original');
      return { count: 0 };
    });
    const record = jest.fn(async (event: { eventKey: string }) => {
      events.push(event.eventKey === 'mail.send.ownership_lost_after_transmission' ||
        event.eventKey === 'communication.reply.ownership_lost_after_transmission'
        ? 'audit-late-ownership' : 'audit-original-acceptance');
      return { id: 'audit-1' };
    });
    const tx = {
      $queryRaw: jest.fn(async () => {
        events.push('lock-original');
        return [{ id: 'original-1' }];
      }),
      communicationOutbox: { updateMany },
      operatorReplyOutbox: { updateMany },
    };
    const service = Object.assign(Object.create(prototype) as object, {
      prisma: { $transaction: async <T>(callback: (client: typeof tx) => Promise<T>): Promise<T> => callback(tx) },
      audit: { record },
      health: { record: jest.fn(async () => undefined) },
    }) as unknown as {
      recordSuccess(...args: unknown[]): Promise<boolean>;
    };
    const accepted = { source: 'smtp', responseCode: 250 };
    const args: unknown[] = ['original-1', 'mail-1', LEASE, 'attempt-1', accepted];
    if (table === 'communicationOutbox') {
      args.push({ purpose: 'REMINDER', caseRevision: null, renewalCaseId: 'case-1' });
    }
    const result = await service.recordSuccess(...args);
    expect(result).toBe(false);
    expect(events[0]).toBe('lock-original');
    expect(events[1]).toBe('update-original');
    expect(events[2]).toBe('audit-original-acceptance');
    const acceptedAudit = record.mock.calls.find(([event]) => event.eventKey ===
      (table === 'communicationOutbox' ? 'mail.send.succeeded' : 'communication.reply.delivered'));
    expect(acceptedAudit?.[0]).toMatchObject({
      metadata: { acceptance: { source: 'smtp', responseCode: 250 }, applied: false },
    });
  });
});
