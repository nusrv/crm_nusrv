import { jest } from '@jest/globals';
import { CommunicationThreadsService } from './communication-threads.service';

function baseThreadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'thread-1',
    subject: 'Renewal notice',
    status: 'OPEN',
    renewalCaseId: null,
    lastMessageAt: new Date('2026-01-02T00:00:00.000Z'),
    customer: { id: 'customer-1', customerCode: 'C-1', nameEn: 'Acme', nameAr: null, primaryEmail: 'a@example.test' },
    mailConfiguration: { id: 'mc-1', label: 'Primary' },
    messages: [{ direction: 'INBOUND', bodyText: 'yes please renew', occurredAt: new Date('2026-01-02T00:00:00.000Z') }],
    _count: { messages: 0 },
    ...overrides,
  };
}

describe('CommunicationThreadsService.list (§4)', () => {
  it('paginates, sorts lastMessageAt DESC with a stable id tie-break, and shapes the response', async () => {
    const findMany = jest.fn(() => Promise.resolve([baseThreadRow()]));
    const count = jest.fn(() => Promise.resolve(1));
    const prisma = { communicationThread: { findMany, count } };
    const service = new CommunicationThreadsService(prisma as never, { record: jest.fn() } as never, { getEffectiveClassification: jest.fn() } as never);

    const result = await service.list({ page: 2, pageSize: 10 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }], skip: 10, take: 10 }),
    );
    expect(result.meta).toEqual({ total: 1, page: 2, pageSize: 10, pageCount: 1 });
    expect(result.data[0]!.latestMessage).toEqual({
      direction: 'INBOUND',
      preview: 'yes please renew',
      occurredAt: new Date('2026-01-02T00:00:00.000Z'),
    });
  });

  it('§4 — HUMAN_REVIEW/attention filter matches thread.status=HUMAN_REVIEW OR any pending inbound review', async () => {
    const findMany = jest.fn((args: { where: { AND: Array<Record<string, unknown>> } }) => {
      void args;
      return Promise.resolve([]);
    });
    const count = jest.fn(() => Promise.resolve(0));
    const prisma = { communicationThread: { findMany, count } };
    const service = new CommunicationThreadsService(prisma as never, { record: jest.fn() } as never, { getEffectiveClassification: jest.fn() } as never);

    await service.list({ page: 1, pageSize: 20, attention: true });

    const call = findMany.mock.calls[0]![0];
    const attentionClause = call.where.AND.find((clause) => 'OR' in clause) as { OR: Array<Record<string, unknown>> } | undefined;
    expect(attentionClause).toBeDefined();
    expect(attentionClause!.OR).toContainEqual({ status: 'HUMAN_REVIEW' });
    const messagesClause = attentionClause!.OR.find((entry) => 'messages' in entry);
    expect(messagesClause).toBeDefined();
  });

  it('flags requiresAttention when the thread has pending HUMAN_REVIEW inbound messages', async () => {
    const findMany = jest.fn(() => Promise.resolve([baseThreadRow({ _count: { messages: 1 } })]));
    const count = jest.fn(() => Promise.resolve(1));
    const prisma = { communicationThread: { findMany, count } };
    const service = new CommunicationThreadsService(prisma as never, { record: jest.fn() } as never, { getEffectiveClassification: jest.fn() } as never);

    const result = await service.list({ page: 1, pageSize: 20 });
    expect(result.data[0]!.requiresAttention).toBe(true);
    expect(result.data[0]!.pendingHumanReviewCount).toBe(1);
  });
});

describe('CommunicationThreadsService.detail (§5/§6/§18)', () => {
  it('unknown thread -> 404', async () => {
    const findUnique = jest.fn(() => Promise.resolve(null));
    const prisma = { communicationThread: { findUnique } };
    const service = new CommunicationThreadsService(prisma as never, { record: jest.fn() } as never, { getEffectiveClassification: jest.fn() } as never);

    await expect(service.detail('missing')).rejects.toThrow();
  });

  it('returns messages in chronological order with only safe fields — never bodyHtml, never raw MIME/prompt/credentials', async () => {
    const thread = {
      id: 'thread-1',
      subject: 'Renewal',
      status: 'OPEN',
      lastMessageAt: new Date(),
      customer: { id: 'c1' },
      mailConfiguration: { id: 'mc1' },
      renewalCase: null,
      messages: [
        {
          id: 'msg-1',
          direction: 'INBOUND',
          subject: 'Renewal',
          fromAddress: 'customer@example.test',
          toAddressesJson: ['support@example.test'],
          bodyText: 'yes please renew',
          occurredAt: new Date('2026-01-01T00:00:00Z'),
          classificationStatus: 'CLASSIFIED',
          outboxEntry: null,
          operatorReplyOutboxEntry: null,
        },
        {
          id: 'msg-2',
          direction: 'OUTBOUND',
          subject: 'Re: Renewal',
          fromAddress: 'support@example.test',
          toAddressesJson: ['customer@example.test'],
          bodyText: 'Thanks!',
          occurredAt: new Date('2026-01-02T00:00:00Z'),
          classificationStatus: null,
          outboxEntry: null,
          operatorReplyOutboxEntry: { status: 'DELIVERED', lastError: null },
        },
      ],
    };
    const findUnique = jest.fn(() => Promise.resolve(thread));
    const effectiveCreatedAt = new Date('2026-01-03T00:00:00.000Z');
    const getEffectiveClassification = jest.fn(() =>
      Promise.resolve({
        source: 'AI',
        effectiveIntent: 'ACCEPT_RENEWAL',
        effectiveResult: { confidence: 0.96 },
        aiClassificationId: 'clf-1',
        createdAt: effectiveCreatedAt,
      }),
    );
    const prisma = { communicationThread: { findUnique } };
    const service = new CommunicationThreadsService(prisma as never, { record: jest.fn() } as never, { getEffectiveClassification } as never);

    const result = await service.detail('thread-1');

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]!.id).toBe('msg-1');
    expect(result.messages[1]!.id).toBe('msg-2');
    // Only classified (non-null classificationStatus) messages get an effective-classification call.
    expect(getEffectiveClassification).toHaveBeenCalledTimes(1);
    expect(getEffectiveClassification).toHaveBeenCalledWith('msg-1');
    expect(result.messages[0]!.effectiveClassification).toEqual({
      source: 'AI',
      effectiveIntent: 'ACCEPT_RENEWAL',
      effectiveResult: { confidence: 0.96 },
      aiClassificationId: 'clf-1',
      createdAt: effectiveCreatedAt,
    });
    expect(result.messages[1]!.effectiveClassification).toBeNull();
    expect(result.messages[1]!.deliveryStatus).toBe('DELIVERED');
    // The returned message objects never carry bodyHtml/raw MIME/credential-shaped keys.
    for (const message of result.messages) {
      expect(Object.keys(message)).not.toContain('bodyHtml');
      expect(Object.keys(message)).not.toContain('rawMime');
    }
  });

  it('a missing/failed effective-classification lookup never crashes the whole detail response', async () => {
    const thread = {
      id: 'thread-1',
      subject: 'Renewal',
      status: 'OPEN',
      lastMessageAt: new Date(),
      customer: { id: 'c1' },
      mailConfiguration: { id: 'mc1' },
      renewalCase: null,
      messages: [
        {
          id: 'msg-1',
          direction: 'INBOUND',
          subject: 'Renewal',
          fromAddress: 'customer@example.test',
          toAddressesJson: ['support@example.test'],
          bodyText: 'hi',
          occurredAt: new Date(),
          classificationStatus: 'PENDING',
          outboxEntry: null,
          operatorReplyOutboxEntry: null,
        },
      ],
    };
    const findUnique = jest.fn(() => Promise.resolve(thread));
    const getEffectiveClassification = jest.fn(() => Promise.reject(new Error('not found yet')));
    const prisma = { communicationThread: { findUnique } };
    const service = new CommunicationThreadsService(prisma as never, { record: jest.fn() } as never, { getEffectiveClassification } as never);

    const result = await service.detail('thread-1');
    expect(result.messages[0]!.effectiveClassification).toBeNull();
  });
});

describe('CommunicationThreadsService.resolve (§17/§20)', () => {
  it('resolves an OPEN thread and audits communication.thread.resolved', async () => {
    const findUnique = jest.fn(() => Promise.resolve({ status: 'OPEN' }));
    const update = jest.fn(() => Promise.resolve({}));
    const auditRecord = jest.fn((event: { eventKey: string; actorId?: string }) => {
      void event;
      return Promise.resolve();
    });
    const tx = { communicationThread: { update }, };
    const prisma = {
      communicationThread: { findUnique },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => Promise.resolve(cb(tx))),
    };
    const service = new CommunicationThreadsService(prisma as never, { record: auditRecord } as never, { getEffectiveClassification: jest.fn() } as never);

    const result = await service.resolve('thread-1', 'user-1');

    expect(result).toEqual({ id: 'thread-1', status: 'RESOLVED' });
    expect(update).toHaveBeenCalledWith({ where: { id: 'thread-1' }, data: { status: 'RESOLVED' } });
    const auditCall = auditRecord.mock.calls[0]![0] as { eventKey: string; actorId: string };
    expect(auditCall.eventKey).toBe('communication.thread.resolved');
    expect(auditCall.actorId).toBe('user-1');
  });

  it('resolving an already-RESOLVED thread is an idempotent no-op — no duplicate audit, never mutates RenewalCase', async () => {
    const findUnique = jest.fn(() => Promise.resolve({ status: 'RESOLVED' }));
    const auditRecord = jest.fn(() => Promise.resolve());
    const transaction = jest.fn();
    const prisma = { communicationThread: { findUnique }, $transaction: transaction };
    const service = new CommunicationThreadsService(prisma as never, { record: auditRecord } as never, { getEffectiveClassification: jest.fn() } as never);

    const result = await service.resolve('thread-1', 'user-1');

    expect(result).toEqual({ id: 'thread-1', status: 'RESOLVED' });
    expect(transaction).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it('unknown thread -> 404', async () => {
    const findUnique = jest.fn(() => Promise.resolve(null));
    const prisma = { communicationThread: { findUnique } };
    const service = new CommunicationThreadsService(prisma as never, { record: jest.fn() } as never, { getEffectiveClassification: jest.fn() } as never);

    await expect(service.resolve('missing', 'user-1')).rejects.toThrow();
  });
});
