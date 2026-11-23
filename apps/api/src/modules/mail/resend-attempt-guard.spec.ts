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
  }) as WorkerAttempt;
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
