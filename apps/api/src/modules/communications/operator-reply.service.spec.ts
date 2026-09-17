import { jest } from '@jest/globals';
import { Prisma } from '../../generated/prisma/client';
import { OperatorReplyService } from './operator-reply.service';

const BASE_THREAD: {
  id: string;
  subject: string;
  renewalCaseId: string | null;
  customerId: string | null;
  mailConfiguration: { id: string; fromAddress: string; fromName: string; enabled: boolean; environment: string };
} = {
  id: 'thread-1',
  subject: 'Renewal notice',
  renewalCaseId: 'case-1',
  customerId: 'customer-1',
  mailConfiguration: { id: 'mc-1', fromAddress: 'no-reply@example.test', fromName: 'Support', enabled: true, environment: 'SANDBOX' },
};

interface ExistingRow {
  actorId: string;
  idempotencyKey: string;
  id: string;
  emailMessageId: string;
  threadId: string;
  status: string;
  bodyText: string;
  subject: string;
}

function harness(overrides: {
  thread?: Partial<typeof BASE_THREAD> | null;
  /** Newest-first threading candidates, as the real bounded findMany() query would return them. */
  threadingCandidates?: Array<{ externalMessageId: string | null; references: string | null }>;
  resolvedRecipient?: { email: string; source: string } | null;
  mailConfigUsable?: boolean;
  /** Rows already persisted for a (actorId, idempotencyKey) pair — the composite-unique lookup key. */
  existingRows?: ExistingRow[];
  /** 'P2002': every create() attempt throws the clean unique-constraint error.
   * 'P2034': every create() attempt throws the alternate write-conflict/deadlock error (bounded
   *   retry exhausts and rethrows).
   * 'P2034-once': only the FIRST create() attempt throws P2034; the retried attempt succeeds. */
  simulateRace?: 'P2002' | 'P2034' | 'P2034-once';
} = {}) {
  const thread = overrides.thread === null ? null : { ...BASE_THREAD, ...overrides.thread };
  const threadingCandidates = overrides.threadingCandidates ?? [];
  const existingRows = overrides.existingRows ?? [];

  let idCounter = 0;
  let createAttempts = 0;
  const auditRecord = jest.fn((event: { eventKey: string }, _tx?: unknown) => {
    void event;
    void _tx;
    return Promise.resolve();
  });
  const emailMessageCreate = jest.fn((args: { data: Record<string, unknown> }) => {
    idCounter += 1;
    return Promise.resolve({ id: `msg-${idCounter}`, ...args.data });
  });
  const outboxCreate = jest.fn((args: { data: Record<string, unknown> }) => {
    createAttempts += 1;
    if (overrides.simulateRace === 'P2002' || overrides.simulateRace === 'P2034') {
      throw new Prisma.PrismaClientKnownRequestError('Simulated write conflict', {
        code: overrides.simulateRace,
        clientVersion: 'test',
      });
    }
    if (overrides.simulateRace === 'P2034-once' && createAttempts === 1) {
      throw new Prisma.PrismaClientKnownRequestError('Simulated write conflict', { code: 'P2034', clientVersion: 'test' });
    }
    idCounter += 1;
    return Promise.resolve({ id: `outbox-${idCounter}`, status: 'QUEUED', ...args.data });
  });
  const communicationThreadUpdate = jest.fn(() => Promise.resolve({}));
  const tx = {
    emailMessage: { create: emailMessageCreate },
    operatorReplyOutbox: { create: outboxCreate },
    communicationThread: { update: communicationThreadUpdate },
  };

  const communicationThreadFindUnique = jest.fn(() => Promise.resolve(thread as never));
  const emailMessageFindMany = jest.fn(() => Promise.resolve(threadingCandidates as never));
  // Real-shape composite-unique lookup: (actorId, idempotencyKey), never the bare key alone —
  // mirrors the actual Prisma `where: { actorId_idempotencyKey: { actorId, idempotencyKey } }`
  // call, so a test can prove two different actorIds using the same client key never collide.
  const operatorReplyOutboxFindUnique = jest.fn(
    (args: { where: { actorId_idempotencyKey: { actorId: string; idempotencyKey: string } } }) => {
      const { actorId, idempotencyKey } = args.where.actorId_idempotencyKey;
      const row = existingRows.find((entry) => entry.actorId === actorId && entry.idempotencyKey === idempotencyKey);
      return Promise.resolve(
        row
          ? {
              id: row.id,
              emailMessageId: row.emailMessageId,
              threadId: row.threadId,
              status: row.status,
              emailMessage: { bodyText: row.bodyText, subject: row.subject },
            }
          : null,
      );
    },
  );

  const prisma = {
    communicationThread: { findUnique: communicationThreadFindUnique, update: communicationThreadUpdate },
    emailMessage: { findMany: emailMessageFindMany, create: emailMessageCreate },
    operatorReplyOutbox: { findUnique: operatorReplyOutboxFindUnique, create: outboxCreate },
    $transaction: jest.fn((cb: (tx: unknown) => unknown) => Promise.resolve(cb(tx))),
  };

  const audit = { record: auditRecord };
  const clock = { now: () => new Date('2026-01-01T00:00:00.000Z') };
  const mailConfigResolver = {
    resolvePinned: jest.fn(() =>
      overrides.mailConfigUsable === false
        ? { usable: false, reason: 'PINNED_CONFIGURATION_DISABLED' }
        : { usable: true, config: thread?.mailConfiguration },
    ),
  };
  const emailResolution = {
    resolvePrimaryRecipient: jest.fn(() =>
      Promise.resolve(overrides.resolvedRecipient === undefined ? { email: 'customer@example.test', source: 'NORMALIZED_PRIMARY' } : overrides.resolvedRecipient),
    ),
  };

  const service = new OperatorReplyService(prisma as never, audit as never, clock, mailConfigResolver as never, emailResolution as never);
  return { service, emailMessageCreate, outboxCreate, auditRecord, communicationThreadUpdate, operatorReplyOutboxFindUnique };
}

describe('OperatorReplyService (§8-§11/§15/§16)', () => {
  it('A — valid thread + authoritative email + usable pinned mailbox creates one OUTBOUND EmailMessage and one queued OperatorReplyOutbox', async () => {
    const { service, emailMessageCreate, outboxCreate, auditRecord } = harness();

    const result = await service.queueReply({
      threadId: 'thread-1',
      actorId: 'user-1',
      idempotencyKey: 'idem-1',
      bodyText: 'Thanks for confirming.',
    });

    expect(result.status).toBe('QUEUED');
    expect(emailMessageCreate).toHaveBeenCalledTimes(1);
    expect(outboxCreate).toHaveBeenCalledTimes(1);
    const emailData = emailMessageCreate.mock.calls[0]![0].data;
    expect(emailData.direction).toBe('OUTBOUND');
    expect(emailData.toAddressesJson).toEqual(['customer@example.test']);
    expect(emailData.renewalCaseId).toBe('case-1');
    const auditCall = auditRecord.mock.calls[0]![0];
    expect(auditCall.eventKey).toBe('communication.reply.queued');
  });

  it('B — a double-submit with the SAME actor + idempotencyKey + SAME body short-circuits without creating anything new', async () => {
    const existingRows: ExistingRow[] = [
      { actorId: 'user-1', idempotencyKey: 'idem-1', id: 'outbox-1', emailMessageId: 'msg-1', threadId: 'thread-1', status: 'QUEUED', bodyText: 'x', subject: 'Re: Renewal notice' },
    ];
    const { service, emailMessageCreate, outboxCreate } = harness({ existingRows });

    const result = await service.queueReply({ threadId: 'thread-1', actorId: 'user-1', idempotencyKey: 'idem-1', bodyText: 'x' });

    expect(result).toEqual({ outboxId: 'outbox-1', emailMessageId: 'msg-1', threadId: 'thread-1', status: 'QUEUED' });
    expect(emailMessageCreate).not.toHaveBeenCalled();
    expect(outboxCreate).not.toHaveBeenCalled();
  });

  it('§3D — same actor + same idempotencyKey but a DIFFERENT body -> 409 Conflict, never silently resolved', async () => {
    const existingRows: ExistingRow[] = [
      { actorId: 'user-1', idempotencyKey: 'idem-1', id: 'outbox-1', emailMessageId: 'msg-1', threadId: 'thread-1', status: 'QUEUED', bodyText: 'original body', subject: 'Re: Renewal notice' },
    ];
    const { service, emailMessageCreate, outboxCreate } = harness({ existingRows });

    await expect(
      service.queueReply({ threadId: 'thread-1', actorId: 'user-1', idempotencyKey: 'idem-1', bodyText: 'a completely different message' }),
    ).rejects.toThrow(/different/i);
    expect(emailMessageCreate).not.toHaveBeenCalled();
    expect(outboxCreate).not.toHaveBeenCalled();
  });

  it('§3D — same actor + same idempotencyKey but a DIFFERENT thread -> 409 Conflict', async () => {
    const existingRows: ExistingRow[] = [
      { actorId: 'user-1', idempotencyKey: 'idem-1', id: 'outbox-1', emailMessageId: 'msg-1', threadId: 'thread-OTHER', status: 'QUEUED', bodyText: 'x', subject: 'Re: Renewal notice' },
    ];
    const { service } = harness({ existingRows });

    await expect(
      service.queueReply({ threadId: 'thread-1', actorId: 'user-1', idempotencyKey: 'idem-1', bodyText: 'x' }),
    ).rejects.toThrow(/different/i);
  });

  it('§1A — same actor + same key + same thread + same body + same EXPLICIT effective subject -> existing result', async () => {
    const existingRows: ExistingRow[] = [
      { actorId: 'user-1', idempotencyKey: 'idem-subj', id: 'outbox-1', emailMessageId: 'msg-1', threadId: 'thread-1', status: 'QUEUED', bodyText: 'x', subject: 'Custom subject' },
    ];
    const { service, emailMessageCreate, outboxCreate } = harness({ existingRows });

    const result = await service.queueReply({ threadId: 'thread-1', actorId: 'user-1', idempotencyKey: 'idem-subj', subject: 'Custom subject', bodyText: 'x' });

    expect(result).toEqual({ outboxId: 'outbox-1', emailMessageId: 'msg-1', threadId: 'thread-1', status: 'QUEUED' });
    expect(emailMessageCreate).not.toHaveBeenCalled();
    expect(outboxCreate).not.toHaveBeenCalled();
  });

  it('§1B — same actor + same key + same thread/body but a DIFFERENT effective subject -> 409 Conflict', async () => {
    const existingRows: ExistingRow[] = [
      { actorId: 'user-1', idempotencyKey: 'idem-subj2', id: 'outbox-1', emailMessageId: 'msg-1', threadId: 'thread-1', status: 'QUEUED', bodyText: 'x', subject: 'Original subject' },
    ];
    const { service, emailMessageCreate, outboxCreate } = harness({ existingRows });

    await expect(
      service.queueReply({ threadId: 'thread-1', actorId: 'user-1', idempotencyKey: 'idem-subj2', subject: 'A totally different subject', bodyText: 'x' }),
    ).rejects.toThrow(/different/i);
    expect(emailMessageCreate).not.toHaveBeenCalled();
    expect(outboxCreate).not.toHaveBeenCalled();
  });

  it('§1C — same actor + same key + omitted subject on both calls, whose derived subject is identical -> existing result', async () => {
    // BASE_THREAD.subject = 'Renewal notice' -> both calls independently derive the SAME
    // "Re: Renewal notice" effective subject, since neither supplies an explicit override.
    const existingRows: ExistingRow[] = [
      { actorId: 'user-1', idempotencyKey: 'idem-subj3', id: 'outbox-1', emailMessageId: 'msg-1', threadId: 'thread-1', status: 'QUEUED', bodyText: 'x', subject: 'Re: Renewal notice' },
    ];
    const { service, emailMessageCreate, outboxCreate } = harness({ existingRows });

    const result = await service.queueReply({ threadId: 'thread-1', actorId: 'user-1', idempotencyKey: 'idem-subj3', bodyText: 'x' });

    expect(result.outboxId).toBe('outbox-1');
    expect(emailMessageCreate).not.toHaveBeenCalled();
    expect(outboxCreate).not.toHaveBeenCalled();
  });

  it('§1D — two EXPLICIT subjects that would normalize to the same canonical form are still treated as materially different (never re-normalized for comparison) -> 409', async () => {
    // Defined, deliberate rule: an operator-supplied subject is compared exactly as given, never
    // itself re-passed through normalizeReplySubject for comparison purposes — only the
    // auto-derived (omitted-subject) path is guaranteed deterministic enough to ever coincide.
    const existingRows: ExistingRow[] = [
      { actorId: 'user-1', idempotencyKey: 'idem-subj4', id: 'outbox-1', emailMessageId: 'msg-1', threadId: 'thread-1', status: 'QUEUED', bodyText: 'x', subject: 'Renewal notice' },
    ];
    const { service, emailMessageCreate, outboxCreate } = harness({ existingRows });

    // 'Re: Renewal notice' would normalize to the exact same canonical subject as 'Renewal notice'
    // if it were ever re-normalized — but it is not, so this is correctly treated as a conflict.
    await expect(
      service.queueReply({ threadId: 'thread-1', actorId: 'user-1', idempotencyKey: 'idem-subj4', subject: 'Re: Renewal notice', bodyText: 'x' }),
    ).rejects.toThrow(/different/i);
    expect(emailMessageCreate).not.toHaveBeenCalled();
    expect(outboxCreate).not.toHaveBeenCalled();
  });

  it('§3E — a DIFFERENT actor coincidentally using the same client idempotencyKey never retrieves or conflicts with the first actor\'s reply', async () => {
    const existingRows: ExistingRow[] = [
      { actorId: 'user-1', idempotencyKey: 'shared-key', id: 'outbox-1', emailMessageId: 'msg-1', threadId: 'thread-1', status: 'QUEUED', bodyText: 'actor 1 body', subject: 'Re: Renewal notice' },
    ];
    const { service, emailMessageCreate, outboxCreate } = harness({ existingRows });

    // A second actor submits the SAME raw idempotencyKey, on the SAME thread, with a DIFFERENT
    // body — this must proceed as an entirely independent, brand-new reply, never see 409, and
    // never return actor 1's result.
    const result = await service.queueReply({ threadId: 'thread-1', actorId: 'user-2', idempotencyKey: 'shared-key', bodyText: 'actor 2 body' });

    expect(result.outboxId).not.toBe('outbox-1');
    expect(emailMessageCreate).toHaveBeenCalledTimes(1);
    expect(outboxCreate).toHaveBeenCalledTimes(1);
    const emailData = emailMessageCreate.mock.calls[0]![0].data;
    expect(emailData.bodyText).toBe('actor 2 body');
  });

  it('C — a concurrent double-submit racing past the fast idempotency check is still caught by the DB composite-unique constraint (P2002), never creating a second logical reply', async () => {
    const { service, outboxCreate, operatorReplyOutboxFindUnique } = harness({ simulateRace: 'P2002' });
    // After the race, the "winner" row is what a fresh lookup would now find.
    operatorReplyOutboxFindUnique.mockImplementationOnce(() => Promise.resolve(null as never));
    operatorReplyOutboxFindUnique.mockImplementationOnce(() =>
      Promise.resolve({ id: 'outbox-winner', emailMessageId: 'msg-winner', threadId: 'thread-1', status: 'QUEUED', emailMessage: { bodyText: 'x', subject: 'Re: Renewal notice' } } as never),
    );

    const result = await service.queueReply({ threadId: 'thread-1', actorId: 'user-1', idempotencyKey: 'idem-race', bodyText: 'x' });

    expect(outboxCreate).toHaveBeenCalledTimes(1); // attempted once, lost the race.
    expect(result.outboxId).toBe('outbox-winner'); // returns the winner's result, never a second row.
  });

  it('C2 — a live-verified alternate concurrency shape (P2034 write-conflict/deadlock) is retried once and finds the winner', async () => {
    const { service, outboxCreate, operatorReplyOutboxFindUnique } = harness({ simulateRace: 'P2034' });
    operatorReplyOutboxFindUnique.mockImplementationOnce(() => Promise.resolve(null as never)); // attempt 1: no winner yet.
    operatorReplyOutboxFindUnique.mockImplementationOnce(() =>
      Promise.resolve({ id: 'outbox-winner', emailMessageId: 'msg-winner', threadId: 'thread-1', status: 'QUEUED', emailMessage: { bodyText: 'x', subject: 'Re: Renewal notice' } } as never),
    ); // the single retry: winner now committed and visible.

    const result = await service.queueReply({ threadId: 'thread-1', actorId: 'user-1', idempotencyKey: 'idem-p2034', bodyText: 'x' });

    expect(outboxCreate).toHaveBeenCalledTimes(1); // only the first attempt tried to create; the retry short-circuited.
    expect(result.outboxId).toBe('outbox-winner');
  });

  it('a P2034 conflict unrelated to this idempotency key still succeeds cleanly on the single retry', async () => {
    const { service, outboxCreate } = harness({ simulateRace: 'P2034-once' });

    const result = await service.queueReply({ threadId: 'thread-1', actorId: 'user-1', idempotencyKey: 'idem-p2034-retry', bodyText: 'x' });

    expect(outboxCreate).toHaveBeenCalledTimes(2); // failed once (P2034), succeeded on the bounded retry.
    expect(result.status).toBe('QUEUED');
  });

  it('a P2034 conflict is bounded to exactly one retry — it does not loop forever', async () => {
    const { service } = harness({ simulateRace: 'P2034' });

    await expect(
      service.queueReply({ threadId: 'thread-1', actorId: 'user-1', idempotencyKey: 'idem-p2034-bounded', bodyText: 'x' }),
    ).rejects.toThrow();
  });

  it('D — no authoritative recipient produces no send/outbox side effect', async () => {
    const { service, emailMessageCreate, outboxCreate } = harness({ resolvedRecipient: null });

    await expect(
      service.queueReply({ threadId: 'thread-1', actorId: 'user-1', idempotencyKey: 'idem-2', bodyText: 'x' }),
    ).rejects.toThrow();
    expect(emailMessageCreate).not.toHaveBeenCalled();
    expect(outboxCreate).not.toHaveBeenCalled();
  });

  it('E — a pinned mailbox that is unusable (disabled) never falls back to another mailbox and produces no send', async () => {
    const { service, emailMessageCreate, outboxCreate } = harness({ mailConfigUsable: false });

    await expect(
      service.queueReply({ threadId: 'thread-1', actorId: 'user-1', idempotencyKey: 'idem-3', bodyText: 'x' }),
    ).rejects.toThrow(/unavailable/i);
    expect(emailMessageCreate).not.toHaveBeenCalled();
    expect(outboxCreate).not.toHaveBeenCalled();
  });

  it('unknown thread -> 404, no side effects', async () => {
    const { service, emailMessageCreate } = harness({ thread: null });
    await expect(
      service.queueReply({ threadId: 'thread-missing', actorId: 'user-1', idempotencyKey: 'idem-4', bodyText: 'x' }),
    ).rejects.toThrow();
    expect(emailMessageCreate).not.toHaveBeenCalled();
  });

  it('a thread with no attributed customer fails safely rather than sending to an arbitrary address', async () => {
    const { service, emailMessageCreate } = harness({ thread: { customerId: null } });
    await expect(
      service.queueReply({ threadId: 'thread-1', actorId: 'user-1', idempotencyKey: 'idem-5', bodyText: 'x' }),
    ).rejects.toThrow();
    expect(emailMessageCreate).not.toHaveBeenCalled();
  });

  it('J — In-Reply-To/References are correctly derived from the latest thread message', async () => {
    const { service, emailMessageCreate } = harness({
      threadingCandidates: [{ externalMessageId: '<prior@example.test>', references: '<older@example.test>' }],
    });
    await service.queueReply({ threadId: 'thread-1', actorId: 'user-1', idempotencyKey: 'idem-6', bodyText: 'x' });
    const emailData = emailMessageCreate.mock.calls[0]![0].data;
    expect(emailData.inReplyTo).toBe('<prior@example.test>');
    expect(emailData.references).toBe('<older@example.test> <prior@example.test>');
  });

  it('§10 — the latest message has no usable externalMessageId; the search falls back to the next-older VALID candidate', async () => {
    const { service, emailMessageCreate } = harness({
      threadingCandidates: [
        { externalMessageId: null, references: null }, // latest — no identity at all.
        { externalMessageId: '<older-valid@example.test>', references: null }, // next-older — valid.
      ],
    });
    await service.queueReply({ threadId: 'thread-1', actorId: 'user-1', idempotencyKey: 'idem-9', bodyText: 'x' });
    const emailData = emailMessageCreate.mock.calls[0]![0].data;
    expect(emailData.inReplyTo).toBe('<older-valid@example.test>');
  });

  it('§10 — no candidate in the bounded window has a valid externalMessageId: In-Reply-To is safely omitted, never fabricated', async () => {
    const { service, emailMessageCreate } = harness({
      threadingCandidates: [
        { externalMessageId: null, references: null },
        { externalMessageId: null, references: null },
      ],
    });
    await service.queueReply({ threadId: 'thread-1', actorId: 'user-1', idempotencyKey: 'idem-10', bodyText: 'x' });
    const emailData = emailMessageCreate.mock.calls[0]![0].data;
    expect(emailData.inReplyTo).toBeNull();
    expect(emailData.references).toBeUndefined();
  });

  it('K — the X-Renewal-Case-Id-relevant renewalCaseId is only ever populated from the thread, never invented', async () => {
    const { service, emailMessageCreate } = harness({ thread: { renewalCaseId: null } });
    await service.queueReply({ threadId: 'thread-1', actorId: 'user-1', idempotencyKey: 'idem-7', bodyText: 'x' });
    const emailData = emailMessageCreate.mock.calls[0]![0].data;
    expect(emailData.renewalCaseId).toBeNull();
  });

  it('an operator-supplied subject is normalized/bounded; an omitted subject derives "Re: <thread subject>"', async () => {
    const { service, emailMessageCreate } = harness();
    await service.queueReply({ threadId: 'thread-1', actorId: 'user-1', idempotencyKey: 'idem-8', bodyText: 'x' });
    const emailData = emailMessageCreate.mock.calls[0]![0].data;
    expect(emailData.subject).toBe('Re: Renewal notice');
  });
});
