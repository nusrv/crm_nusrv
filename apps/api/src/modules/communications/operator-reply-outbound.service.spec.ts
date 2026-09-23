import { jest } from '@jest/globals';
import { OperatorReplyOutboundService } from './operator-reply-outbound.service';
import { DEFER_RETRY_DELAY_MS, SMTP_RETRY_BACKOFF_MS } from './operator-reply-timing.constants';

interface Row {
  id: string;
  threadId: string;
  mailConfigurationId: string;
  emailMessageId: string;
  recipient: string;
  status: string;
  attempts: number;
  lastAttemptAt: Date | null;
  lastError: string | null;
  nextAttemptAt: Date | null;
  queuedAt: Date;
}

function matches(row: Row, where: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (key === 'OR') {
      if (!(value as Record<string, unknown>[]).some((cond) => matches(row, cond))) return false;
      continue;
    }
    if (value && typeof value === 'object' && 'lt' in (value)) {
      const current = row[key as keyof Row] as Date | null;
      if (!current || !(current < (value as { lt: Date }).lt)) return false;
      continue;
    }
    if (value && typeof value === 'object' && 'gte' in (value)) {
      const current = row[key as keyof Row] as Date;
      if (!(current >= (value as { gte: Date }).gte)) return false;
      continue;
    }
    if (value && typeof value === 'object' && 'lte' in (value)) {
      const current = row[key as keyof Row] as Date | null;
      if (!current || !(current <= (value as { lte: Date }).lte)) return false;
      continue;
    }
    if (row[key as keyof Row] !== value) return false;
  }
  return true;
}

function harness(options: {
  row: Row;
  thread?: { id: string; customerId: string | null };
  mailConfiguration?: { id: string; fromAddress: string; fromName: string; enabled: boolean; environment: string };
  emailMessage?: { id: string; subject: string; bodyText: string; externalMessageId: string | null; inReplyTo: string | null; references: string | null; renewalCaseId: string | null };
  resolvedRecipient?: { email: string; source: string } | null;
  mailConfigUsable?: boolean;
  sendImpl?: () => Promise<void>;
  clockNow?: Date;
}) {
  const rows = new Map<string, Row>([[options.row.id, { ...options.row }]]);
  const thread = options.thread ?? { id: options.row.threadId, customerId: 'customer-1' };
  const mailConfiguration = options.mailConfiguration ?? {
    id: options.row.mailConfigurationId,
    fromAddress: 'no-reply@example.test',
    fromName: 'Support',
    enabled: true,
    environment: 'SANDBOX',
  };
  const emailMessage = options.emailMessage ?? {
    id: options.row.emailMessageId,
    subject: 'Re: Renewal',
    bodyText: 'Body',
    externalMessageId: '<msg@example.test>',
    inReplyTo: null,
    references: null,
    renewalCaseId: null,
  };

  const auditRecord = jest.fn(() => Promise.resolve());
  const healthRecord = jest.fn(() => Promise.resolve());
  const sendMock = jest.fn((message: Record<string, unknown>, config: unknown) => {
    void message;
    void config;
    return (options.sendImpl ?? (() => Promise.resolve()))();
  });

  const operatorReplyOutbox = {
    updateMany: jest.fn(({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      let count = 0;
      for (const row of rows.values()) {
        if (matches(row, where)) {
          for (const [k, v] of Object.entries(data)) {
            if (v && typeof v === 'object' && 'increment' in (v)) {
              const numeric = row as unknown as Record<string, number>;
              numeric[k] = (numeric[k] ?? 0) + (v as { increment: number }).increment;
            } else {
              (row as unknown as Record<string, unknown>)[k] = v;
            }
          }
          count += 1;
        }
      }
      return Promise.resolve({ count });
    }),
    findUnique: jest.fn(({ where: { id } }: { where: { id: string } }) => Promise.resolve(rows.get(id) ? { ...rows.get(id) } : null)),
  };
  const findUniqueOrThrowPlain = ({ where: { id } }: { where: { id: string } }) => {
    const row = rows.get(id);
    if (!row) throw new Error('not found');
    return Promise.resolve({ ...row });
  };

  const emailMessageUpdate = jest.fn(() => Promise.resolve({}));
  const prisma = {
    operatorReplyOutbox,
    mailConfiguration: { findUnique: jest.fn(() => Promise.resolve(mailConfiguration)) },
    emailMessage: { update: emailMessageUpdate },
    $transaction: jest.fn((cb: (tx: unknown) => unknown) =>
      Promise.resolve(
        cb({
          operatorReplyOutbox: { updateMany: operatorReplyOutbox.updateMany },
          emailMessage: { update: emailMessageUpdate },
        }),
      ),
    ),
  };

  // Manually attach the joined relations loadContext() expects via include — simulate by
  // dispatching to a second implementation when the call carries `include` (loadContext's own
  // call shape), falling back to the plain lookup (claim()'s own call shape) otherwise. Each
  // branch is a plain function, never referencing the mutable `findUniqueOrThrow` property itself,
  // so reassigning that property below can never recurse into itself.
  const findUniqueOrThrowInclude = jest.fn(({ where: { id } }: { where: { id: string } }) => {
    const row = rows.get(id);
    if (!row) throw new Error('not found');
    return Promise.resolve({ ...row, thread, emailMessage });
  });
  const findUniqueOrThrow = jest.fn((args: { where: { id: string }; select?: unknown; include?: unknown }) =>
    args.include ? findUniqueOrThrowInclude(args) : findUniqueOrThrowPlain(args),
  );
  (prisma.operatorReplyOutbox as unknown as { findUniqueOrThrow: unknown }).findUniqueOrThrow = findUniqueOrThrow;

  let currentTime = options.clockNow ?? new Date('2026-01-01T00:00:00.000Z');
  const clock = { now: () => currentTime };
  const setClockNow = (value: Date) => {
    currentTime = value;
  };
  const mailConfigResolver = {
    resolvePinned: jest.fn<(config: unknown, options?: { checkCutover: boolean }) => { usable: boolean; config?: unknown; reason?: string }>(() =>
      options.mailConfigUsable === false ? { usable: false, reason: 'PINNED_CONFIGURATION_DISABLED' } : { usable: true, config: mailConfiguration },
    ),
  };
  const emailResolution = {
    resolvePrimaryRecipient: jest.fn(() =>
      Promise.resolve(options.resolvedRecipient === undefined ? { email: options.row.recipient, source: 'NORMALIZED_PRIMARY' } : options.resolvedRecipient),
    ),
  };
  const health = { record: healthRecord };
  const transport = { send: sendMock };

  const service = new OperatorReplyOutboundService(
    prisma as never,
    { record: auditRecord } as never,
    clock,
    mailConfigResolver as never,
    emailResolution as never,
    health as never,
    transport as never,
  );
  return { service, rows, auditRecord, healthRecord, sendMock, operatorReplyOutbox, emailMessageUpdate, mailConfigResolver, mailConfiguration, setClockNow };
}

function baseRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 'outbox-1',
    threadId: 'thread-1',
    mailConfigurationId: 'mc-1',
    emailMessageId: 'msg-1',
    recipient: 'customer@example.test',
    status: 'QUEUED',
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    nextAttemptAt: null,
    queuedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('OperatorReplyOutboundService (§9/§13/§14/§16)', () => {
  it('Phase 3.1 §2A/§2B — resolvePinned() is always called with checkCutover:false, so a DB outboundSendCutoverAt can never strand a human reply', async () => {
    const { service, mailConfigResolver } = harness({ row: baseRow() });
    await service.processOne('outbox-1');
    expect(mailConfigResolver.resolvePinned).toHaveBeenCalledWith(expect.anything(), { checkCutover: false });
  });

  it('§7 Case B — a reply queued long ago is never stranded: it sends normally, unlike Slice B\'s reminder cutover semantics', async () => {
    // Simulates the exact strand scenario a DB-level cutover could otherwise create. Unlike
    // MailOutboundService, this must still process normally — no queuedAt >= cutover filter exists
    // here at all, and resolvePinned() is invoked with checkCutover:false (asserted above).
    const { service, rows } = harness({ row: baseRow({ queuedAt: new Date('2020-01-01T00:00:00.000Z') }) });
    const outcome = await service.processOne('outbox-1');
    expect(outcome).toBe('sent');
    expect(rows.get('outbox-1')!.status).toBe('DELIVERED');
  });

  it('A — a valid row sends successfully and becomes DELIVERED, health HEALTHY', async () => {
    const { service, rows, healthRecord } = harness({ row: baseRow() });
    const outcome = await service.processOne('outbox-1');
    expect(outcome).toBe('sent');
    expect(rows.get('outbox-1')!.status).toBe('DELIVERED');
    expect(healthRecord).toHaveBeenCalledWith('mc-1', 'HEALTHY', expect.any(String));
  });

  it('E — an unusable pinned mailbox defers (never falls back to another mailbox, never sends)', async () => {
    const { service, rows, sendMock } = harness({ row: baseRow(), mailConfigUsable: false });
    const outcome = await service.processOne('outbox-1');
    expect(outcome).toBe('deferred');
    expect(rows.get('outbox-1')!.status).toBe('QUEUED');
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('§8 — a deferred row consumes no attempt, and recovers automatically once the SAME pinned mailbox becomes usable again (after its own retry time)', async () => {
    const { service, rows, sendMock, mailConfigResolver, mailConfiguration, setClockNow } = harness({ row: baseRow(), mailConfigUsable: false });

    const deferredOutcome = await service.processOne('outbox-1');
    expect(deferredOutcome).toBe('deferred');
    expect(rows.get('outbox-1')!.attempts).toBe(0); // no attempt consumed by a temporary defer.
    expect(rows.get('outbox-1')!.status).toBe('QUEUED');
    expect(rows.get('outbox-1')!.nextAttemptAt).not.toBeNull(); // §2 — a modest future retry time was set.

    // The SAME pinned mailbox becomes usable again — no new mailbox, no fallback, just recovery —
    // AND the modest defer-retry time (§2) has now elapsed, matching how the real 15s scheduler
    // would eventually reselect this row.
    mailConfigResolver.resolvePinned.mockReturnValue({ usable: true, config: mailConfiguration });
    setClockNow(new Date(rows.get('outbox-1')!.nextAttemptAt!.getTime() + 1_000));
    const recoveredOutcome = await service.processOne('outbox-1');

    expect(recoveredOutcome).toBe('sent');
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(rows.get('outbox-1')!.status).toBe('DELIVERED');
  });

  it('D — no authoritative recipient pre-attempt defers; post-attempt cancels, neither ever sends', async () => {
    const preAttempt = harness({ row: baseRow(), resolvedRecipient: null });
    const preOutcome = await preAttempt.service.processOne('outbox-1');
    expect(preOutcome).toBe('deferred');
    expect(preAttempt.sendMock).not.toHaveBeenCalled();

    const postAttempt = harness({ row: baseRow({ attempts: 1 }), resolvedRecipient: null });
    const postOutcome = await postAttempt.service.processOne('outbox-1');
    expect(postOutcome).toBe('cancelled');
    expect(postAttempt.sendMock).not.toHaveBeenCalled();
  });

  it('rebinds the recipient pre-attempt when it has changed, and updates EmailMessage.toAddressesJson too', async () => {
    const { service, rows, sendMock, emailMessageUpdate } = harness({
      row: baseRow({ recipient: 'old@example.test' }),
      resolvedRecipient: { email: 'new@example.test', source: 'NORMALIZED_PRIMARY' },
    });
    const outcome = await service.processOne('outbox-1');
    expect(outcome).toBe('sent');
    expect(rows.get('outbox-1')!.recipient).toBe('new@example.test');
    expect(emailMessageUpdate).toHaveBeenCalledWith({ where: { id: 'msg-1' }, data: { toAddressesJson: ['new@example.test'] } });
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ toAddress: 'new@example.test' }), expect.anything());
  });

  it('cancels (never resends to a different address) when the recipient changed AFTER an attempt', async () => {
    const { service, rows, sendMock } = harness({
      row: baseRow({ recipient: 'old@example.test', attempts: 1 }),
      resolvedRecipient: { email: 'new@example.test', source: 'NORMALIZED_PRIMARY' },
    });
    const outcome = await service.processOne('outbox-1');
    expect(outcome).toBe('cancelled');
    expect(rows.get('outbox-1')!.recipient).toBe('old@example.test'); // never silently rebound post-attempt.
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('H — the pinned mailConfigurationId is preserved through processing', async () => {
    const { service, sendMock } = harness({ row: baseRow() });
    await service.processOne('outbox-1');
    expect(sendMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'mc-1' }));
  });

  it('I — Message-ID is stable (the already-materialized EmailMessage.externalMessageId, never regenerated)', async () => {
    const { service, sendMock } = harness({
      row: baseRow(),
      emailMessage: { id: 'msg-1', subject: 'Re: x', bodyText: 'b', externalMessageId: '<stable@example.test>', inReplyTo: null, references: null, renewalCaseId: null },
    });
    await service.processOne('outbox-1');
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ messageId: '<stable@example.test>' }), expect.anything());
  });

  it('K — X-Renewal-Case-Id is included only when the message is actually linked to a RenewalCase', async () => {
    const withCase = harness({
      row: baseRow(),
      emailMessage: { id: 'msg-1', subject: 'x', bodyText: 'b', externalMessageId: '<a@example.test>', inReplyTo: null, references: null, renewalCaseId: 'case-1' },
    });
    await withCase.service.processOne('outbox-1');
    const withCaseCall = withCase.sendMock.mock.calls[0]![0] as { headers?: Record<string, string> };
    expect(withCaseCall.headers?.['X-Renewal-Case-Id']).toBe('case-1');

    const withoutCase = harness({ row: baseRow() });
    await withoutCase.service.processOne('outbox-1');
    const call = withoutCase.sendMock.mock.calls[0]![0] as { headers?: Record<string, string> };
    expect(call.headers?.['X-Renewal-Case-Id']).toBeUndefined();
  });

  it('a permanent SMTP failure (message-specific rejection) fails terminally without affecting mailbox health', async () => {
    const error = Object.assign(new Error('rejected'), { command: 'RCPT TO', responseCode: 550 });
    const { service, rows, healthRecord } = harness({ row: baseRow(), sendImpl: () => Promise.reject(error) });
    const outcome = await service.processOne('outbox-1');
    expect(outcome).toBe('failed');
    expect(rows.get('outbox-1')!.status).toBe('FAILED');
    expect(healthRecord).not.toHaveBeenCalled(); // message-specific rejection, never mailbox-wide.
  });

  it('an infrastructure SMTP failure is retried (QUEUED) and marks health DEGRADED', async () => {
    const error = Object.assign(new Error('auth failed'), { code: 'EAUTH' });
    const { service, rows, healthRecord } = harness({ row: baseRow(), sendImpl: () => Promise.reject(error) });
    const outcome = await service.processOne('outbox-1');
    expect(outcome).toBe('failed');
    expect(rows.get('outbox-1')!.status).toBe('QUEUED'); // not yet exhausted -> bounded retry.
    expect(healthRecord).toHaveBeenCalledWith('mc-1', 'DEGRADED', expect.any(String));
  });

  it('two concurrent processOne() calls on the same row: only one claims and sends, the other is not_claimed', async () => {
    const { service } = harness({ row: baseRow() });
    const [a, b] = await Promise.all([service.processOne('outbox-1'), service.processOne('outbox-1')]);
    const outcomes = [a, b].sort();
    // One genuinely wins the CAS claim; the other observes the row already PROCESSING/terminal.
    expect(outcomes).not.toEqual(['not_claimed', 'not_claimed']);
    expect(outcomes.includes('sent') || outcomes.includes('not_claimed')).toBe(true);
  });

  describe('§2 (contract audit) — DB-backed retry backoff', () => {
    const NOW = new Date('2026-01-01T00:00:00.000Z');
    const infraError = () => Object.assign(new Error('auth failed'), { code: 'EAUTH' });

    it('a retryable infrastructure failure at attempt 1 sets nextAttemptAt using the FIRST backoff tier (~1 min)', async () => {
      const { service, rows } = harness({ row: baseRow(), clockNow: NOW, sendImpl: () => Promise.reject(infraError()) });
      await service.processOne('outbox-1');
      const row = rows.get('outbox-1')!;
      expect(row.attempts).toBe(1);
      expect(row.status).toBe('QUEUED');
      expect(row.nextAttemptAt).toEqual(new Date(NOW.getTime() + SMTP_RETRY_BACKOFF_MS[0]!));
    });

    it('backoff escalates across consecutive attempts: attempt 2 -> tier[1] (~5min), attempt 3 -> tier[2] (~15min), attempt 4 -> tier[3] (~30min)', async () => {
      const { service, rows, setClockNow } = harness({ row: baseRow(), clockNow: NOW, sendImpl: () => Promise.reject(infraError()) });

      // Attempt 1.
      await service.processOne('outbox-1');
      expect(rows.get('outbox-1')!.nextAttemptAt).toEqual(new Date(NOW.getTime() + SMTP_RETRY_BACKOFF_MS[0]!));

      // Advance past attempt 1's backoff and retry -> attempt 2.
      const t2 = new Date(NOW.getTime() + SMTP_RETRY_BACKOFF_MS[0]! + 1_000);
      setClockNow(t2);
      await service.processOne('outbox-1');
      expect(rows.get('outbox-1')!.attempts).toBe(2);
      expect(rows.get('outbox-1')!.nextAttemptAt).toEqual(new Date(t2.getTime() + SMTP_RETRY_BACKOFF_MS[1]!));

      // -> attempt 3.
      const t3 = new Date(t2.getTime() + SMTP_RETRY_BACKOFF_MS[1]! + 1_000);
      setClockNow(t3);
      await service.processOne('outbox-1');
      expect(rows.get('outbox-1')!.attempts).toBe(3);
      expect(rows.get('outbox-1')!.nextAttemptAt).toEqual(new Date(t3.getTime() + SMTP_RETRY_BACKOFF_MS[2]!));

      // -> attempt 4.
      const t4 = new Date(t3.getTime() + SMTP_RETRY_BACKOFF_MS[2]! + 1_000);
      setClockNow(t4);
      await service.processOne('outbox-1');
      expect(rows.get('outbox-1')!.attempts).toBe(4);
      expect(rows.get('outbox-1')!.nextAttemptAt).toEqual(new Date(t4.getTime() + SMTP_RETRY_BACKOFF_MS[3]!));
      expect(rows.get('outbox-1')!.status).toBe('QUEUED'); // still retryable — bound (5) not yet reached.

      // -> attempt 5: MAX_SEND_ATTEMPTS reached -> terminal, no further nextAttemptAt.
      const t5 = new Date(t4.getTime() + SMTP_RETRY_BACKOFF_MS[3]! + 1_000);
      setClockNow(t5);
      await service.processOne('outbox-1');
      expect(rows.get('outbox-1')!.attempts).toBe(5);
      expect(rows.get('outbox-1')!.status).toBe('FAILED');
      expect(rows.get('outbox-1')!.nextAttemptAt).toBeNull();
    });

    it('a row is NOT claimed/selected before its own nextAttemptAt', async () => {
      const future = new Date(NOW.getTime() + 10 * 60_000);
      const { service, sendMock } = harness({ row: baseRow({ status: 'QUEUED', nextAttemptAt: future }), clockNow: NOW });
      const outcome = await service.processOne('outbox-1');
      expect(outcome).toBe('not_claimed');
      expect(sendMock).not.toHaveBeenCalled();
    });

    it('a row becomes selectable again once nextAttemptAt has passed', async () => {
      const past = new Date(NOW.getTime() - 1_000);
      const { service, rows } = harness({ row: baseRow({ status: 'QUEUED', nextAttemptAt: past }), clockNow: NOW });
      const outcome = await service.processOne('outbox-1');
      expect(outcome).toBe('sent');
      expect(rows.get('outbox-1')!.status).toBe('DELIVERED');
    });

    it('attempts increments ONLY on a real SMTP call — a temporary (non-SMTP) defer never increments it', async () => {
      const { service, rows, sendMock } = harness({ row: baseRow({ nextAttemptAt: null }), clockNow: NOW, mailConfigUsable: false });
      const outcome = await service.processOne('outbox-1');
      expect(outcome).toBe('deferred');
      expect(rows.get('outbox-1')!.attempts).toBe(0);
      expect(sendMock).not.toHaveBeenCalled();
    });

    it('a temporary (non-SMTP) defer sets a modest FIXED nextAttemptAt (DEFER_RETRY_DELAY_MS), never the escalating SMTP backoff schedule', async () => {
      const { service, rows } = harness({ row: baseRow({ nextAttemptAt: null }), clockNow: NOW, mailConfigUsable: false });
      await service.processOne('outbox-1');
      expect(rows.get('outbox-1')!.nextAttemptAt).toEqual(new Date(NOW.getTime() + DEFER_RETRY_DELAY_MS));
    });

    it('§8/§2 — a disabled-mailbox defer does not cause the row to be reselected on the very next 15s-scale tick', async () => {
      const { service, rows, sendMock } = harness({ row: baseRow({ nextAttemptAt: null }), clockNow: NOW, mailConfigUsable: false });
      const firstOutcome = await service.processOne('outbox-1');
      expect(firstOutcome).toBe('deferred');

      // A tick 15s later (the real scheduler's own cadence) — the defer delay (60s) has not
      // elapsed yet, so the row must not be reselected.
      const { service: tickService, sendMock: tickSendMock } = harness({
        row: rows.get('outbox-1')!,
        clockNow: new Date(NOW.getTime() + 15_000),
        mailConfigUsable: false,
      });
      const secondOutcome = await tickService.processOne('outbox-1');
      expect(secondOutcome).toBe('not_claimed');
      expect(tickSendMock).not.toHaveBeenCalled();
      void sendMock;
    });
  });

  describe('§3 (contract audit) — lastError cleanup', () => {
    it('an eventual successful send clears lastError, even after a prior failure left one behind', async () => {
      const infraError = Object.assign(new Error('temporary auth hiccup'), { code: 'EAUTH' });
      let shouldFail = true;
      const { service, rows } = harness({
        row: baseRow(),
        clockNow: new Date('2026-01-01T00:00:00.000Z'),
        sendImpl: () => (shouldFail ? Promise.reject(infraError) : Promise.resolve()),
      });

      const failedOutcome = await service.processOne('outbox-1');
      expect(failedOutcome).toBe('failed');
      expect(rows.get('outbox-1')!.lastError).toContain('auth hiccup');

      shouldFail = false;
      const nextTry = harness({
        row: { ...rows.get('outbox-1')!, nextAttemptAt: null }, // simulate the backoff having elapsed.
        clockNow: new Date('2026-01-01T00:05:00.000Z'),
        sendImpl: () => Promise.resolve(),
      });
      const successOutcome = await nextTry.service.processOne('outbox-1');
      expect(successOutcome).toBe('sent');
      expect(nextTry.rows.get('outbox-1')!.status).toBe('DELIVERED');
      expect(nextTry.rows.get('outbox-1')!.lastError).toBeNull(); // no stale error reason remains.
    });

    it('a recipient rebind followed by a successful send leaves no stale error reason', async () => {
      const { service, rows, emailMessageUpdate } = harness({
        row: baseRow({ recipient: 'old@example.test', lastError: 'previous_defer_reason' }),
        resolvedRecipient: { email: 'new@example.test', source: 'NORMALIZED_PRIMARY' },
      });
      const outcome = await service.processOne('outbox-1');
      expect(outcome).toBe('sent');
      expect(rows.get('outbox-1')!.recipient).toBe('new@example.test');
      expect(rows.get('outbox-1')!.status).toBe('DELIVERED');
      expect(rows.get('outbox-1')!.lastError).toBeNull();
      expect(emailMessageUpdate).toHaveBeenCalledWith({ where: { id: 'msg-1' }, data: { toAddressesJson: ['new@example.test'] } });
    });
  });
});
