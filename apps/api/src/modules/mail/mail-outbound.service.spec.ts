import { jest } from '@jest/globals';
import { MailOutboundService } from './mail-outbound.service';

const NOW = new Date('2026-09-01T12:00:00.000Z');
const RECLAIMED_TOKEN = new Date('2026-09-01T12:05:00.000Z');

const mailConfigurationA = {
  id: 'config-A',
  fromAddress: 'renewals@example.test',
  fromName: 'Renewals',
  enabled: true,
  environment: 'SANDBOX',
  billingEntityId: null,
};

const mailConfigurationB = {
  id: 'config-B',
  fromAddress: 'renewals-b@example.test',
  fromName: 'Renewals B',
  enabled: true,
  environment: 'SANDBOX',
  billingEntityId: 'be-override',
};

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'outbox-1',
    customerId: 'customer-1',
    subscriptionId: 'sub-1',
    renewalCaseId: 'case-1',
    reminderRuleId: 'rule-1',
    notificationRuleId: null as string | null,
    audience: 'CUSTOMER',
    recipient: 'current@example.test',
    subject: 'Renewal reminder',
    body: 'Body text',
    daysBeforeDue: 7,
    status: 'QUEUED',
    attempts: 0,
    lastAttemptAt: null as Date | null,
    lastError: null as string | null,
    emailMessageId: null as string | null,
    messageIdHeader: null as string | null,
    customer: { id: 'customer-1', status: 'ACTIVE', billingEntityId: 'be-1' },
    subscription: { id: 'sub-1', status: 'ACTIVE' },
    renewalCase: { id: 'case-1', status: 'REMINDER_CYCLE', holds: [] as unknown[] },
    notificationRule: null as { id: string; suppressOnWorkflowHold: boolean } | null,
    ...overrides,
  };
}

type Row = ReturnType<typeof baseRow>;
type ConfigResolution =
  | { usable: true; config: typeof mailConfigurationA }
  | { usable: false; reason: string };

// This project's ESLint config flags `expect.objectContaining({ key: expect.objectContaining(...) })`
// (a matcher nested as a property value inside another matcher's object literal) as an unsafe `any`
// assignment, unlike a single top-level matcher argument. Pulling the mock's actual call arguments
// out and asserting on them directly with toMatchObject/toEqual sidesteps that without weakening
// the assertion.
//
// Searches from the END of the call list: claim()'s own claim/reclaim updateMany() ALSO writes a
// `status` key (PROCESSING), so a forward search for e.g. key='status' would always find that
// first, chronologically-earliest call instead of the actual outcome-setting mutation (cancel/
// defer/success/failure) that comes later — every real guarded mutation happens after claim().
function findCallWithDataKey<T extends { data?: Record<string, unknown> }>(
  mock: { mock: { calls: [T][] } },
  key: string,
): T | undefined {
  const calls = mock.mock.calls;
  for (let i = calls.length - 1; i >= 0; i -= 1) {
    if (calls[i]![0].data && key in calls[i]![0].data!) return calls[i]![0];
  }
  return undefined;
}

interface HarnessOptions {
  row?: Row;
  claimSucceeds?: boolean;
  existingThread?: { id: string; mailConfigurationId: string } | null;
  configResolution?: ConfigResolution;
  pinnedConfigResolution?: ConfigResolution;
  recipient?: { email: string; source: string } | null;
  /** Simulates a second worker's stale-PROCESSING reclaim (writing a NEW lastAttemptAt/status)
   * landing partway through THIS worker's processOne() call. The reclaim is applied immediately
   * before the (0-indexed) `reclaimAfterGuardedCalls`-th ownership-guarded updateMany() call is
   * evaluated — so `0` invalidates this worker's token before its very first guarded write (e.g.
   * the recipient rebind, or the attempt-increment if no rebind happens), and `1` lets exactly one
   * guarded write land normally first (e.g. the attempt increment) before invalidating the token
   * for the next one (e.g. the success/failure record). Claim()'s own claim/reclaim updateMany
   * call is never counted — only the ownership-guarded mutations that follow it are. */
  reclaimAfterGuardedCalls?: number;
}

function buildHarness(options: HarnessOptions = {}) {
  const row = options.row ?? baseRow();

  // Mutable "fake persisted state" for this one row. claim() writes {status: PROCESSING,
  // lastAttemptAt: now} through the same mock as everything else, so the token claim() reads back
  // afterwards is genuinely round-tripped through this fake store, exactly mirroring how the real
  // implementation reads back MariaDB's own persisted value rather than trusting `now` blindly.
  let persisted: Row = { ...row };
  let rowSequenceOverride: Row[] | null = null;
  let rowSequenceIndex = 0;
  let guardedCallCount = 0;

  const emailMessageCreate = jest.fn((args: { data: Record<string, unknown> }) => {
    void args;
    return Promise.resolve({ id: 'email-1' });
  });
  const emailMessageUpdate = jest.fn((args: { where: { id: string }; data: Record<string, unknown> }) => {
    void args;
    return Promise.resolve({});
  });
  const integrationHealthEventCreate = jest.fn(() => Promise.resolve({}));
  const mailConfigurationUpdate = jest.fn(() => Promise.resolve({}));

  // Serves every Prisma communicationOutbox.updateMany() call in the service: claim()'s own
  // claim/reclaim CAS (recognized by its `OR` where-clause) is unconditional except for
  // `claimSucceeds`; every OTHER call is an ownership-guarded PROCESSING-state mutation
  // (`status: PROCESSING, lastAttemptAt: <token>`, sometimes also `attempts: 0`), checked against
  // `persisted`'s actual current state — which `reclaimAfterGuardedCalls` can perturb mid-flight to
  // simulate a second worker's reclaim landing between two of this worker's own guarded writes.
  const communicationOutboxUpdateMany = jest.fn(
    (args: { where: Record<string, unknown>; data?: Record<string, unknown> }) => {
      const where = args.where;
      if ('OR' in where) {
        if (options.claimSucceeds === false) return Promise.resolve({ count: 0 });
        persisted = { ...persisted, ...(args.data ?? {}) };
        return Promise.resolve({ count: 1 });
      }

      if (options.reclaimAfterGuardedCalls === guardedCallCount) {
        persisted = { ...persisted, lastAttemptAt: RECLAIMED_TOKEN, status: 'PROCESSING' };
      }
      guardedCallCount += 1;

      const whereLastAttemptAt = where.lastAttemptAt as Date | null | undefined;
      const leaseMatches =
        whereLastAttemptAt instanceof Date && persisted.lastAttemptAt instanceof Date
          ? whereLastAttemptAt.getTime() === persisted.lastAttemptAt.getTime()
          : whereLastAttemptAt === persisted.lastAttemptAt;
      const statusMatches = !('status' in where) || where.status === persisted.status;
      const attemptsMatches = !('attempts' in where) || where.attempts === persisted.attempts;
      if (!leaseMatches || !statusMatches || !attemptsMatches) {
        return Promise.resolve({ count: 0 });
      }

      const data: Record<string, unknown> = { ...(args.data ?? {}) };
      const attemptsOp = data.attempts;
      if (attemptsOp && typeof attemptsOp === 'object' && 'increment' in attemptsOp) {
        data.attempts = persisted.attempts + (attemptsOp as { increment: number }).increment;
      }
      persisted = { ...persisted, ...data };
      return Promise.resolve({ count: 1 });
    },
  );

  // findUniqueOrThrow serves three structurally different Prisma calls: loadContext()'s full-row
  // read (no `select`), claim()'s lease-token re-read (`select: { lastAttemptAt: true }`), and
  // recordFailure()'s narrow `select: { attempts: true }` read.
  const communicationOutboxFindUniqueOrThrow = jest.fn(
    (args: { select?: { attempts?: boolean; lastAttemptAt?: boolean } } = {}) => {
      if (args.select?.attempts) return Promise.resolve({ attempts: persisted.attempts });
      if (args.select?.lastAttemptAt) return Promise.resolve({ lastAttemptAt: persisted.lastAttemptAt });
      if (rowSequenceOverride) {
        const value = rowSequenceOverride[Math.min(rowSequenceIndex, rowSequenceOverride.length - 1)]!;
        rowSequenceIndex += 1;
        return Promise.resolve(value);
      }
      return Promise.resolve(persisted);
    },
  );
  const communicationOutboxFindMany = jest.fn((args: unknown) => {
    void args;
    return Promise.resolve<Array<{ id: string }>>([]);
  });

  const emailMessageFindUniqueOrThrow = jest.fn((args: unknown) => {
    void args;
    return Promise.resolve({ id: row.emailMessageId, externalMessageId: row.messageIdHeader });
  });

  const communicationThreadFindUnique = jest.fn((args: unknown) => {
    void args;
    return Promise.resolve(options.existingThread ?? null);
  });
  const mailConfigurationFindUnique = jest.fn((args: unknown) => {
    void args;
    return Promise.resolve(options.existingThread ? mailConfigurationA : null);
  });

  const txLike = {
    communicationOutbox: { updateMany: communicationOutboxUpdateMany },
    emailMessage: { create: emailMessageCreate, update: emailMessageUpdate },
    integrationHealthEvent: { create: integrationHealthEventCreate },
    mailConfiguration: { update: mailConfigurationUpdate },
  };

  const prisma = {
    communicationOutbox: {
      updateMany: communicationOutboxUpdateMany,
      findUniqueOrThrow: communicationOutboxFindUniqueOrThrow,
      findMany: communicationOutboxFindMany,
    },
    emailMessage: {
      findUniqueOrThrow: emailMessageFindUniqueOrThrow,
      create: emailMessageCreate,
      update: emailMessageUpdate,
    },
    communicationThread: { findUnique: communicationThreadFindUnique },
    mailConfiguration: {
      findUnique: mailConfigurationFindUnique,
      findUniqueOrThrow: jest.fn((args: unknown) => {
        void args;
        return Promise.resolve({ lastHealthStatus: 'UNKNOWN' });
      }),
    },
    $transaction: jest.fn((callback: (client: typeof txLike) => unknown) => callback(txLike)),
  };

  const audit = {
    record: jest.fn((event: Record<string, unknown>, tx?: unknown) => {
      void event;
      void tx;
      return Promise.resolve({ id: 'audit-1' });
    }),
  };
  const clock = { now: jest.fn(() => NOW) };
  const mailConfigResolver = {
    resolveForOutbound: jest.fn((billingEntityId: string) => {
      void billingEntityId;
      return Promise.resolve(options.configResolution ?? { usable: true, config: mailConfigurationA });
    }),
    resolvePinned: jest.fn((pinned: unknown) => {
      void pinned;
      return Promise.resolve(options.pinnedConfigResolution ?? { usable: true, config: mailConfigurationA });
    }),
  };
  const threadResolution = {
    resolveOrCreate: jest.fn((tx: unknown, params: unknown) => {
      void tx;
      void params;
      return Promise.resolve({ id: 'thread-1' });
    }),
  };
  const health = {
    record: jest.fn((mailConfigurationId: string, status: string, message: string) => {
      void mailConfigurationId;
      void status;
      void message;
      return Promise.resolve();
    }),
  };
  const emailResolution = {
    resolvePrimaryRecipient: jest.fn((customerId: string) => {
      void customerId;
      return Promise.resolve(
        options.recipient === undefined
          ? { email: 'current@example.test', source: 'NORMALIZED_PRIMARY' }
          : options.recipient,
      );
    }),
  };
  const transport = {
    send: jest.fn((message: unknown, config: unknown) => {
      void message;
      void config;
      return Promise.resolve();
    }),
  };

  const service = new MailOutboundService(
    prisma as never,
    audit as never,
    clock,
    mailConfigResolver as never,
    threadResolution as never,
    health as never,
    emailResolution as never,
    transport,
  );

  return {
    service,
    row,
    prisma,
    audit,
    clock,
    mailConfigResolver,
    threadResolution,
    health,
    emailResolution,
    transport,
    setRowSequence: (rows: Row[]) => {
      rowSequenceOverride = rows;
      rowSequenceIndex = 0;
    },
    // Reflects the fake store's actual current state — as opposed to inspecting raw mock call
    // arguments, which record every ATTEMPTED write (including ones a guard rejected) regardless
    // of whether it actually took effect. Use this, not a mock-call inspection, to assert what a
    // stale/ownership-losing worker's rejected write did NOT actually change.
    getPersistedRow: () => persisted,
  };
}

describe('MailOutboundService.processOne — gating', () => {
  it('returns not_claimed when the CAS claim loses the race', async () => {
    const { service, prisma } = buildHarness({ claimSucceeds: false });

    const outcome = await service.processOne('outbox-1');

    expect(outcome).toBe('not_claimed');
    expect(prisma.communicationOutbox.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});

describe('MailOutboundService.processOne — business eligibility', () => {
  it('cancels (never sends) when the customer has become INACTIVE', async () => {
    const row = baseRow({ customer: { id: 'customer-1', status: 'INACTIVE', billingEntityId: 'be-1' } });
    const { service, prisma, audit, transport } = buildHarness({ row });

    const outcome = await service.processOne('outbox-1');

    expect(outcome).toBe('cancelled');
    expect(transport.send).not.toHaveBeenCalled();
    expect(findCallWithDataKey(prisma.communicationOutbox.updateMany, 'status')?.data).toMatchObject({
      status: 'CANCELLED',
      lastError: 'customer_inactive',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventKey: 'mail.outbox.cancelled' }),
      expect.anything(),
    );
  });

  it('cancels when the subscription is no longer ACTIVE', async () => {
    const row = baseRow({ subscription: { id: 'sub-1', status: 'SUSPENDED' } });
    const { service, transport } = buildHarness({ row });

    const outcome = await service.processOne('outbox-1');

    expect(outcome).toBe('cancelled');
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('cancels when the RenewalCase is no longer reminder-eligible (e.g. ACCEPTED)', async () => {
    const row = baseRow({ renewalCase: { id: 'case-1', status: 'ACCEPTED', holds: [] } });
    const { service, transport, prisma } = buildHarness({ row });

    const outcome = await service.processOne('outbox-1');

    expect(outcome).toBe('cancelled');
    expect(transport.send).not.toHaveBeenCalled();
    expect(findCallWithDataKey(prisma.communicationOutbox.updateMany, 'status')?.data?.lastError).toEqual(
      expect.stringContaining('ACCEPTED'),
    );
  });

  it('defers (back to QUEUED, no attempt consumed) when an active hold suppresses customer reminders', async () => {
    const row = baseRow({
      renewalCase: {
        id: 'case-1',
        status: 'REMINDER_CYCLE',
        holds: [
          { id: 'hold-1', active: true, expiresAt: null, stopsCustomerReminders: true, stopsInternalNotifications: false },
        ],
      },
    });
    const { service, transport, prisma } = buildHarness({ row });

    const outcome = await service.processOne('outbox-1');

    expect(outcome).toBe('deferred');
    expect(transport.send).not.toHaveBeenCalled();
    expect(findCallWithDataKey(prisma.communicationOutbox.updateMany, 'status')?.data).toEqual({
      status: 'QUEUED',
      lastError: 'customer_reminder_hold',
    });
  });

  it('re-reads current state for the final pre-send check and cancels if the case became ineligible after materialization', async () => {
    const { service, transport, setRowSequence } = buildHarness();
    setRowSequence([baseRow(), baseRow({ renewalCase: { id: 'case-1', status: 'ACCEPTED', holds: [] } })]);

    const outcome = await service.processOne('outbox-1');

    expect(outcome).toBe('cancelled');
    expect(transport.send).not.toHaveBeenCalled();
  });
});

describe('MailOutboundService.processOne — no-recipient semantics (attempts === 0 vs > 0)', () => {
  it('defers (does NOT cancel) when there is no current recipient and no attempt has been made yet', async () => {
    const { service, transport, prisma, health } = buildHarness({ recipient: null });

    const outcome = await service.processOne('outbox-1');

    expect(outcome).toBe('deferred');
    expect(transport.send).not.toHaveBeenCalled();
    expect(findCallWithDataKey(prisma.communicationOutbox.updateMany, 'status')?.data).toEqual({
      status: 'QUEUED',
      lastError: 'no_current_recipient',
    });
    expect(health.record).not.toHaveBeenCalled();
  });

  it('does not increment attempts when deferred for a missing recipient', async () => {
    const { service, prisma } = buildHarness({ recipient: null });

    await service.processOne('outbox-1');

    const attemptsCall = findCallWithDataKey(prisma.communicationOutbox.updateMany, 'attempts');
    expect(attemptsCall).toBeUndefined();
  });

  it('cancels (does not retry forever) when there is still no recipient after an attempt has already been made', async () => {
    const row = baseRow({ attempts: 1, emailMessageId: 'email-existing', messageIdHeader: '<existing@example.test>' });
    const { service, transport, prisma, audit } = buildHarness({ row, recipient: null });

    const outcome = await service.processOne('outbox-1');

    expect(outcome).toBe('cancelled');
    expect(transport.send).not.toHaveBeenCalled();
    expect(findCallWithDataKey(prisma.communicationOutbox.updateMany, 'status')?.data).toEqual({
      status: 'CANCELLED',
      lastError: 'recipient_unavailable_after_attempt',
    });
    const cancelAuditCall = audit.record.mock.calls.find((call) => call[0].eventKey === 'mail.outbox.cancelled');
    expect(cancelAuditCall?.[0].metadata).toMatchObject({ reason: 'recipient_unavailable_after_attempt' });
  });

  it('sends exactly once after staff add a valid primary email for a previously-deferred row', async () => {
    const { service, transport } = buildHarness({ recipient: null });
    const firstOutcome = await service.processOne('outbox-1');
    expect(firstOutcome).toBe('deferred');
    expect(transport.send).not.toHaveBeenCalled();

    // Staff have now added a valid primary email — a later worker cycle reprocesses the row.
    const { service: retryService, transport: retryTransport } = buildHarness({
      row: baseRow(),
      recipient: { email: 'fixed@example.test', source: 'NORMALIZED_PRIMARY' },
    });
    const secondOutcome = await retryService.processOne('outbox-1');

    expect(secondOutcome).toBe('sent');
    expect(retryTransport.send).toHaveBeenCalledTimes(1);
    expect(retryTransport.send).toHaveBeenCalledWith(
      expect.objectContaining({ toAddress: 'fixed@example.test' }),
      mailConfigurationA,
    );
  });
});

describe('MailOutboundService.processOne — recipient identity before the first SMTP attempt', () => {
  it('rebinds a stale recipient discovered at initial eligibility, updates the EmailMessage, and sends to the new address', async () => {
    const row = baseRow({ recipient: 'stale@example.test' });
    const { service, prisma, audit, transport } = buildHarness({
      row,
      recipient: { email: 'current@example.test', source: 'NORMALIZED_PRIMARY' },
    });

    const outcome = await service.processOne('outbox-1');

    expect(outcome).toBe('sent');
    expect(findCallWithDataKey(prisma.communicationOutbox.updateMany, 'recipient')?.data).toEqual({
      recipient: 'current@example.test',
    });
    expect(prisma.emailMessage.update).not.toHaveBeenCalled();
    const createArgs = prisma.emailMessage.create.mock.calls[0]![0];
    expect(createArgs.data).toMatchObject({ toAddressesJson: ['current@example.test'] });
    const rebindAuditCall = audit.record.mock.calls.find((call) => call[0].eventKey === 'mail.recipient.rebound');
    expect(rebindAuditCall?.[0].metadata).toMatchObject({
      oldRecipient: 'stale@example.test',
      newRecipient: 'current@example.test',
    });
    expect(transport.send).toHaveBeenCalledWith(
      expect.objectContaining({ toAddress: 'current@example.test' }),
      mailConfigurationA,
    );
  });

  it('when the recipient changes AFTER materialization but BEFORE the first send, keeps Outbox.recipient, EmailMessage.toAddressesJson, and the SMTP recipient all consistent at the new address', async () => {
    const { service, prisma, audit, transport, emailResolution } = buildHarness();
    emailResolution.resolvePrimaryRecipient
      .mockResolvedValueOnce({ email: 'current@example.test', source: 'NORMALIZED_PRIMARY' })
      .mockResolvedValueOnce({ email: 'changed-after-materialize@example.test', source: 'NORMALIZED_PRIMARY' });

    const outcome = await service.processOne('outbox-1');

    expect(outcome).toBe('sent');
    expect(prisma.emailMessage.update).toHaveBeenCalledWith({
      where: { id: 'email-1' },
      data: { toAddressesJson: ['changed-after-materialize@example.test'] },
    });
    const recipientCall = findCallWithDataKey(prisma.communicationOutbox.updateMany, 'recipient');
    expect(recipientCall?.data).toEqual({ recipient: 'changed-after-materialize@example.test' });
    const rebindAuditCall = audit.record.mock.calls.find((call) => call[0].eventKey === 'mail.recipient.rebound');
    expect(rebindAuditCall?.[0].metadata).toMatchObject({
      oldRecipient: 'current@example.test',
      newRecipient: 'changed-after-materialize@example.test',
      emailMessageUpdated: true,
    });
    expect(transport.send).toHaveBeenCalledWith(
      expect.objectContaining({ toAddress: 'changed-after-materialize@example.test' }),
      mailConfigurationA,
    );
    expect(transport.send).not.toHaveBeenCalledWith(
      expect.objectContaining({ toAddress: 'current@example.test' }),
      expect.anything(),
    );
  });
});

describe('MailOutboundService.processOne — recipient identity is pinned once attempted', () => {
  it('cancels rather than retrying to a different recipient once an attempt has already been made', async () => {
    const row = baseRow({
      attempts: 1,
      recipient: 'old@example.test',
      emailMessageId: 'email-existing',
      messageIdHeader: '<existing@example.test>',
    });
    const { service, prisma, audit, transport, emailResolution } = buildHarness({
      row,
      recipient: { email: 'new@example.test', source: 'NORMALIZED_PRIMARY' },
    });

    const outcome = await service.processOne('outbox-1');

    expect(outcome).toBe('cancelled');
    expect(transport.send).not.toHaveBeenCalled();
    expect(prisma.emailMessage.update).not.toHaveBeenCalled();
    expect(prisma.emailMessage.create).not.toHaveBeenCalled();
    expect(findCallWithDataKey(prisma.communicationOutbox.updateMany, 'status')?.data).toEqual({
      status: 'CANCELLED',
      lastError: 'recipient_changed_after_attempt',
    });
    const cancelAuditCall = audit.record.mock.calls.find((call) => call[0].eventKey === 'mail.outbox.cancelled');
    expect(cancelAuditCall?.[0].metadata).toMatchObject({
      reason: 'recipient_changed_after_attempt',
      oldRecipient: 'old@example.test',
      newRecipient: 'new@example.test',
    });
    expect(emailResolution.resolvePrimaryRecipient).toHaveBeenCalledTimes(1);
  });
});

describe('MailOutboundService.processOne — lease ownership CAS (defense in depth)', () => {
  it('A — rebind is rejected and both records remain untouched when another worker reclaimed the row first', async () => {
    const row = baseRow({
      recipient: 'stale@example.test',
      emailMessageId: 'email-existing',
      messageIdHeader: '<existing@example.test>',
    });
    const { service, prisma, transport, audit } = buildHarness({
      row,
      recipient: { email: 'current@example.test', source: 'NORMALIZED_PRIMARY' },
      reclaimAfterGuardedCalls: 0,
    });
    prisma.emailMessage.findUniqueOrThrow.mockImplementation(() =>
      Promise.resolve({ id: 'email-existing', externalMessageId: '<existing@example.test>' }),
    );

    const outcome = await service.processOne('outbox-1');

    expect(outcome).toBe('conflict');
    expect(transport.send).not.toHaveBeenCalled();
    expect(prisma.emailMessage.update).not.toHaveBeenCalled();
    expect(prisma.emailMessage.create).not.toHaveBeenCalled();
    // The guarded write WAS attempted (that is the whole point of a real conditional write) but
    // must never have taken effect — no plain unconditional write path exists for it to "succeed
    // via" instead.
    const attemptedCall = findCallWithDataKey(prisma.communicationOutbox.updateMany, 'recipient');
    expect(attemptedCall).toBeDefined();
    expect(attemptedCall?.where).toMatchObject({ id: 'outbox-1', status: 'PROCESSING', attempts: 0 });
    expect(audit.record.mock.calls.find((call) => call[0].eventKey === 'mail.recipient.rebound')).toBeUndefined();
  });

  it('B — attempt increment is rejected (and SMTP is never called) when ownership was lost before it', async () => {
    const row = baseRow({ emailMessageId: 'email-existing', messageIdHeader: '<existing@example.test>' });
    const { service, prisma, transport } = buildHarness({ row, reclaimAfterGuardedCalls: 0 });
    prisma.emailMessage.findUniqueOrThrow.mockImplementation(() =>
      Promise.resolve({ id: 'email-existing', externalMessageId: '<existing@example.test>' }),
    );

    const outcome = await service.processOne('outbox-1');

    expect(outcome).toBe('conflict');
    expect(transport.send).not.toHaveBeenCalled();
    const attemptsCall = findCallWithDataKey(prisma.communicationOutbox.updateMany, 'attempts');
    expect(attemptsCall).toBeDefined(); // attempted, but rejected — count stayed at 0.
  });

  it('C — a stale worker cannot mark DELIVERED once ownership was lost after SMTP already succeeded', async () => {
    const row = baseRow({ emailMessageId: 'email-existing', messageIdHeader: '<existing@example.test>' });
    const { service, prisma, transport, audit, health, getPersistedRow } = buildHarness({
      row,
      reclaimAfterGuardedCalls: 1,
    });
    prisma.emailMessage.findUniqueOrThrow.mockImplementation(() =>
      Promise.resolve({ id: 'email-existing', externalMessageId: '<existing@example.test>' }),
    );

    const outcome = await service.processOne('outbox-1');

    expect(outcome).toBe('ownership_lost_after_send');
    expect(transport.send).toHaveBeenCalledTimes(1); // SMTP genuinely was called.
    // The real store's status was never actually changed to DELIVERED by this worker — it still
    // reflects the (simulated) newer owner's own PROCESSING claim, from RECLAIMED_TOKEN.
    expect(getPersistedRow().status).not.toBe('DELIVERED');
    expect(getPersistedRow().status).toBe('PROCESSING');
    expect(health.record).not.toHaveBeenCalled(); // no health claim made on behalf of the new owner.
    expect(
      audit.record.mock.calls.find((call) => call[0].eventKey === 'mail.send.ownership_lost_after_transmission'),
    ).toBeDefined();
  });

  it('D — a stale worker cannot mark FAILED/QUEUED once ownership was lost after SMTP already failed', async () => {
    const row = baseRow({ emailMessageId: 'email-existing', messageIdHeader: '<existing@example.test>' });
    const { service, prisma, transport, audit, health, getPersistedRow } = buildHarness({
      row,
      reclaimAfterGuardedCalls: 1,
    });
    prisma.emailMessage.findUniqueOrThrow.mockImplementation(() =>
      Promise.resolve({ id: 'email-existing', externalMessageId: '<existing@example.test>' }),
    );
    transport.send.mockImplementation(() => Promise.reject(new Error('Connection refused')));

    const outcome = await service.processOne('outbox-1');

    expect(outcome).toBe('ownership_lost_after_send');
    expect(transport.send).toHaveBeenCalledTimes(1);
    expect(getPersistedRow().status).not.toBe('FAILED');
    expect(getPersistedRow().status).not.toBe('QUEUED');
    expect(getPersistedRow().status).toBe('PROCESSING');
    expect(health.record).not.toHaveBeenCalled();
    expect(
      audit.record.mock.calls.find((call) => call[0].eventKey === 'mail.send.ownership_lost_after_transmission'),
    ).toBeDefined();
  });

  it('E — an uncontended worker: claim token round-trips, attempt increments, SMTP succeeds, DELIVERED', async () => {
    const { service, prisma, transport, health } = buildHarness();

    const outcome = await service.processOne('outbox-1');

    expect(outcome).toBe('sent');
    expect(transport.send).toHaveBeenCalledTimes(1);
    expect(findCallWithDataKey(prisma.communicationOutbox.updateMany, 'attempts')?.where).toEqual({
      id: 'outbox-1',
      status: 'PROCESSING',
      lastAttemptAt: NOW,
    });
    expect(findCallWithDataKey(prisma.communicationOutbox.updateMany, 'status')?.data).toEqual({
      status: 'DELIVERED',
      lastError: null,
    });
    expect(health.record).toHaveBeenCalledWith('config-A', 'HEALTHY', expect.any(String));
  });
});

describe('MailOutboundService.processOne — EmailMessage/Message-ID materialization', () => {
  it('materializes exactly one EmailMessage, sets emailMessageId/messageIdHeader, and includes X-Renewal-Case-Id', async () => {
    const { service, prisma, threadResolution, transport } = buildHarness();

    const outcome = await service.processOne('outbox-1');

    expect(outcome).toBe('sent');
    expect(threadResolution.resolveOrCreate).toHaveBeenCalledTimes(1);
    expect(prisma.emailMessage.create).toHaveBeenCalledTimes(1);
    const createArgs = prisma.emailMessage.create.mock.calls[0]![0];
    expect(createArgs.data).toMatchObject({ direction: 'OUTBOUND', channel: 'EMAIL', bodyText: 'Body text' });
    const materializeCall = findCallWithDataKey(prisma.communicationOutbox.updateMany, 'emailMessageId');
    expect(materializeCall?.data?.emailMessageId).toBe('email-1');
    expect(materializeCall?.data?.messageIdHeader).toEqual(expect.stringMatching(/^<.+@example\.test>$/));
    expect(transport.send).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { 'X-Renewal-Case-Id': 'case-1' } }),
      mailConfigurationA,
    );
  });

  it('adds no X-Renewal-Case-Id header logic beyond the row renewalCaseId (always present on CommunicationOutbox)', async () => {
    const { service, transport } = buildHarness();
    await service.processOne('outbox-1');
    const headers = transport.send.mock.calls[0]![0] as { headers?: Record<string, string> };
    expect(Object.keys(headers.headers ?? {})).toEqual(['X-Renewal-Case-Id']);
  });

  it('passes the caller-supplied stable Message-ID through unchanged, never a nodemailer-generated one', async () => {
    const { service, transport, prisma } = buildHarness();
    await service.processOne('outbox-1');
    const persistedMessageId = findCallWithDataKey(prisma.communicationOutbox.updateMany, 'emailMessageId')?.data
      ?.messageIdHeader;
    const sentMessage = transport.send.mock.calls[0]![0] as { messageId: string };
    expect(sentMessage.messageId).toBe(persistedMessageId);
  });

  it('reuses the existing EmailMessage and Message-ID on retry, without creating a second message', async () => {
    const row = baseRow({ emailMessageId: 'email-existing', messageIdHeader: '<existing@example.test>' });
    const { service, prisma, threadResolution, transport } = buildHarness({ row });
    prisma.emailMessage.findUniqueOrThrow.mockImplementation(() =>
      Promise.resolve({ id: 'email-existing', externalMessageId: '<existing@example.test>' }),
    );

    const outcome = await service.processOne('outbox-1');

    expect(outcome).toBe('sent');
    expect(threadResolution.resolveOrCreate).not.toHaveBeenCalled();
    expect(prisma.emailMessage.create).not.toHaveBeenCalled();
    expect(transport.send).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: '<existing@example.test>' }),
      mailConfigurationA,
    );
  });

  it('throws a data-integrity error when messageIdHeader disagrees with the EmailMessage on retry', async () => {
    const row = baseRow({ emailMessageId: 'email-existing', messageIdHeader: '<a@example.test>' });
    const { service, prisma } = buildHarness({ row });
    prisma.emailMessage.findUniqueOrThrow.mockImplementation(() =>
      Promise.resolve({ id: 'email-existing', externalMessageId: '<b@example.test>' }),
    );

    await expect(service.processOne('outbox-1')).rejects.toThrow(/data-integrity/);
  });
});

describe('MailOutboundService.processOne — MailConfiguration/thread pinning', () => {
  it('resolves fresh via BillingEntity/GLOBAL when no thread exists yet for this RenewalCase', async () => {
    const { service, mailConfigResolver, transport } = buildHarness({ existingThread: null });

    const outcome = await service.processOne('outbox-1');

    expect(outcome).toBe('sent');
    expect(mailConfigResolver.resolveForOutbound).toHaveBeenCalledWith('be-1');
    expect(mailConfigResolver.resolvePinned).not.toHaveBeenCalled();
    expect(transport.send).toHaveBeenCalledWith(expect.anything(), mailConfigurationA);
  });

  it('stays pinned to the thread-original configuration on retry even after a new BillingEntity override appears', async () => {
    const row = baseRow({ emailMessageId: 'email-existing', messageIdHeader: '<existing@example.test>' });
    const { service, prisma, mailConfigResolver, transport } = buildHarness({
      row,
      existingThread: { id: 'thread-1', mailConfigurationId: 'config-A' },
      pinnedConfigResolution: { usable: true, config: mailConfigurationA },
    });
    prisma.emailMessage.findUniqueOrThrow.mockImplementation(() =>
      Promise.resolve({ id: 'email-existing', externalMessageId: '<existing@example.test>' }),
    );

    const outcome = await service.processOne('outbox-1');

    expect(outcome).toBe('sent');
    expect(mailConfigResolver.resolveForOutbound).not.toHaveBeenCalled();
    expect(mailConfigResolver.resolvePinned).toHaveBeenCalled();
    expect(transport.send).toHaveBeenCalledWith(
      expect.objectContaining({ fromAddress: mailConfigurationA.fromAddress }),
      mailConfigurationA,
    );
    expect(transport.send).not.toHaveBeenCalledWith(expect.anything(), mailConfigurationB);
  });

  it('defers (does not fall back to a different configuration) when the pinned configuration has since been disabled', async () => {
    const row = baseRow({ emailMessageId: 'email-existing', messageIdHeader: '<existing@example.test>' });
    const { service, mailConfigResolver, transport } = buildHarness({
      row,
      existingThread: { id: 'thread-1', mailConfigurationId: 'config-A' },
      pinnedConfigResolution: { usable: false, reason: 'PINNED_CONFIGURATION_DISABLED' },
    });

    const outcome = await service.processOne('outbox-1');

    expect(outcome).toBe('deferred');
    expect(transport.send).not.toHaveBeenCalled();
    expect(mailConfigResolver.resolveForOutbound).not.toHaveBeenCalled();
  });

  it('pins a later, different reminder in the same RenewalCase to the already-existing thread configuration', async () => {
    const row = baseRow({ id: 'outbox-2', emailMessageId: null, messageIdHeader: null });
    const { service, mailConfigResolver, transport } = buildHarness({
      row,
      existingThread: { id: 'thread-1', mailConfigurationId: 'config-A' },
      pinnedConfigResolution: { usable: true, config: mailConfigurationA },
    });

    const outcome = await service.processOne('outbox-2');

    expect(outcome).toBe('sent');
    expect(mailConfigResolver.resolveForOutbound).not.toHaveBeenCalled();
    expect(transport.send).toHaveBeenCalledWith(expect.anything(), mailConfigurationA);
  });
});

describe('MailOutboundService.processOne — success/failure recording', () => {
  it('records success as DELIVERED, audits it, and reports HEALTHY', async () => {
    const { service, prisma, audit, health } = buildHarness();

    const outcome = await service.processOne('outbox-1');

    expect(outcome).toBe('sent');
    expect(findCallWithDataKey(prisma.communicationOutbox.updateMany, 'status')?.data).toEqual({
      status: 'DELIVERED',
      lastError: null,
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventKey: 'mail.send.succeeded' }),
      expect.anything(),
    );
    expect(health.record).toHaveBeenCalledWith('config-A', 'HEALTHY', expect.any(String));
  });

  it('requeues (not FAILED) an infrastructure failure while under the retry limit, and reports DEGRADED', async () => {
    const row = baseRow({ attempts: 1, emailMessageId: 'email-existing', messageIdHeader: '<existing@example.test>' });
    const { service, prisma, health, audit, transport } = buildHarness({ row });
    prisma.emailMessage.findUniqueOrThrow.mockImplementation(() =>
      Promise.resolve({ id: 'email-existing', externalMessageId: '<existing@example.test>' }),
    );
    transport.send.mockImplementation(() =>
      Promise.reject(Object.assign(new Error('Connection timed out'), { code: 'ETIMEDOUT' })),
    );

    const outcome = await service.processOne('outbox-1');

    expect(outcome).toBe('failed');
    expect(findCallWithDataKey(prisma.communicationOutbox.updateMany, 'status')?.data).toMatchObject({
      status: 'QUEUED',
    });
    expect(audit.record).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventKey: 'mail.send.failed' }),
      expect.anything(),
    );
    expect(health.record).toHaveBeenCalledWith('config-A', 'DEGRADED', expect.stringContaining('Connection timed out'));
  });

  it('marks FAILED (terminal) once attempts reach the bound for an infrastructure failure, and reports UNAVAILABLE', async () => {
    const row = baseRow({ attempts: 4, emailMessageId: 'email-existing', messageIdHeader: '<existing@example.test>' });
    const { service, prisma, health, audit, transport } = buildHarness({ row });
    prisma.emailMessage.findUniqueOrThrow.mockImplementation(() =>
      Promise.resolve({ id: 'email-existing', externalMessageId: '<existing@example.test>' }),
    );
    transport.send.mockImplementation(() =>
      Promise.reject(Object.assign(new Error('Connection refused'), { code: 'ECONNECTION' })),
    );

    const outcome = await service.processOne('outbox-1');

    expect(outcome).toBe('failed');
    expect(findCallWithDataKey(prisma.communicationOutbox.updateMany, 'status')?.data).toMatchObject({
      status: 'FAILED',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventKey: 'mail.send.failed' }),
      expect.anything(),
    );
    expect(health.record).toHaveBeenCalledWith('config-A', 'UNAVAILABLE', expect.any(String));
  });

  it('fails a permanent 5xx recipient rejection terminally on the FIRST attempt, without exhausting the retry budget', async () => {
    const { service, prisma, health, audit, transport } = buildHarness();
    transport.send.mockImplementation(() =>
      Promise.reject(
        Object.assign(new Error('550 5.1.1 no such user'), {
          code: 'EENVELOPE',
          command: 'RCPT TO',
          responseCode: 550,
        }),
      ),
    );

    const outcome = await service.processOne('outbox-1');

    expect(outcome).toBe('failed');
    expect(findCallWithDataKey(prisma.communicationOutbox.updateMany, 'status')?.data).toMatchObject({
      status: 'FAILED',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventKey: 'mail.send.failed' }),
      expect.anything(),
    );
    expect(health.record).not.toHaveBeenCalled();
  });

  it('sanitizes a long base64-looking fragment out of a persisted SMTP error', async () => {
    const { service, prisma, transport } = buildHarness();
    const secretLooking = 'A'.repeat(60);
    transport.send.mockImplementation(() =>
      Promise.reject(Object.assign(new Error(`auth failed ${secretLooking}`), { code: 'EAUTH' })),
    );

    await service.processOne('outbox-1');

    const failureCall = findCallWithDataKey(prisma.communicationOutbox.updateMany, 'lastError');
    const lastError = failureCall?.data?.lastError;
    expect(typeof lastError).toBe('string');
    expect(lastError).not.toContain(secretLooking);
    expect(lastError).toContain('[REDACTED]');
  });
});

describe('MailOutboundService.processOne — INTERNAL audience', () => {
  it('never resolves a recipient or applies customer/subscription/case checks for INTERNAL rows', async () => {
    const row = baseRow({
      audience: 'INTERNAL',
      recipient: 'staff@example.test',
      notificationRuleId: 'notif-1',
      notificationRule: { id: 'notif-1', suppressOnWorkflowHold: true },
      customer: { id: 'customer-1', status: 'INACTIVE', billingEntityId: 'be-1' },
    });
    const { service, emailResolution, transport } = buildHarness({ row });

    const outcome = await service.processOne('outbox-1');

    expect(outcome).toBe('sent');
    expect(emailResolution.resolvePrimaryRecipient).not.toHaveBeenCalled();
    expect(transport.send).toHaveBeenCalledWith(
      expect.objectContaining({ toAddress: 'staff@example.test' }),
      mailConfigurationA,
    );
  });

  it('defers an INTERNAL row when an active hold suppresses internal notifications and the rule requests suppression', async () => {
    const row = baseRow({
      audience: 'INTERNAL',
      notificationRuleId: 'notif-1',
      notificationRule: { id: 'notif-1', suppressOnWorkflowHold: true },
      renewalCase: {
        id: 'case-1',
        status: 'REMINDER_CYCLE',
        holds: [
          { id: 'hold-1', active: true, expiresAt: null, stopsCustomerReminders: false, stopsInternalNotifications: true },
        ],
      },
    });
    const { service, transport } = buildHarness({ row });

    const outcome = await service.processOne('outbox-1');

    expect(outcome).toBe('deferred');
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('does not defer an INTERNAL row when the rule opts out of hold suppression', async () => {
    const row = baseRow({
      audience: 'INTERNAL',
      notificationRuleId: 'notif-1',
      notificationRule: { id: 'notif-1', suppressOnWorkflowHold: false },
      renewalCase: {
        id: 'case-1',
        status: 'REMINDER_CYCLE',
        holds: [
          { id: 'hold-1', active: true, expiresAt: null, stopsCustomerReminders: false, stopsInternalNotifications: true },
        ],
      },
    });
    const { service, transport } = buildHarness({ row });

    const outcome = await service.processOne('outbox-1');

    expect(outcome).toBe('sent');
    expect(transport.send).toHaveBeenCalled();
  });
});

describe('MailOutboundService.processBatch', () => {
  it('selects only scheduled-due QUEUED/stale-PROCESSING rows and aggregates outcomes — no global createdAt/cutover pre-filter (Phase 3.1 §D correction)', async () => {
    const { service, prisma } = buildHarness();
    prisma.communicationOutbox.findMany.mockResolvedValue([{ id: 'outbox-1' }]);

    const summary = await service.processBatch();

    const findManyArgs = prisma.communicationOutbox.findMany.mock.calls[0]![0] as {
      where: { createdAt?: unknown; OR: unknown[] };
      take: number;
    };
    expect(findManyArgs.where.createdAt).toBeUndefined();
    expect(Array.isArray(findManyArgs.where.OR)).toBe(true);
    expect(findManyArgs.take).toBe(50);
    expect(summary.candidates).toBe(1);
    expect(summary.sent).toBe(1);
  });

  it('aggregates a lease-ownership conflict into summary.conflicts', async () => {
    const row = baseRow({
      recipient: 'stale@example.test',
      emailMessageId: 'email-existing',
      messageIdHeader: '<existing@example.test>',
    });
    const { service, prisma } = buildHarness({
      row,
      recipient: { email: 'current@example.test', source: 'NORMALIZED_PRIMARY' },
      reclaimAfterGuardedCalls: 0,
    });
    prisma.emailMessage.findUniqueOrThrow.mockImplementation(() =>
      Promise.resolve({ id: 'email-existing', externalMessageId: '<existing@example.test>' }),
    );
    prisma.communicationOutbox.findMany.mockResolvedValue([{ id: 'outbox-1' }]);

    const summary = await service.processBatch();

    expect(summary.conflicts).toBe(1);
    expect(summary.sent).toBe(0);
  });

  it('aggregates an ownership-loss-after-send into summary.ownershipLostAfterSend', async () => {
    const row = baseRow({ emailMessageId: 'email-existing', messageIdHeader: '<existing@example.test>' });
    const { service, prisma } = buildHarness({ row, reclaimAfterGuardedCalls: 1 });
    prisma.emailMessage.findUniqueOrThrow.mockImplementation(() =>
      Promise.resolve({ id: 'email-existing', externalMessageId: '<existing@example.test>' }),
    );
    prisma.communicationOutbox.findMany.mockResolvedValue([{ id: 'outbox-1' }]);

    const summary = await service.processBatch();

    expect(summary.ownershipLostAfterSend).toBe(1);
    expect(summary.sent).toBe(0);
  });
});
