import { jest } from '@jest/globals';
import { Prisma } from '../../generated/prisma/client';
import { HealthStatus, IntegrationEnvironment } from '../../generated/prisma/enums';
import { IMAP_AUDIT_EVENT, IMAP_HEALTH_MESSAGE } from './mail-imap-events.constants';
import { MailInboundIngestService } from './mail-inbound-ingest.service';
import type { FetchSinceResult, MailboxReader, MailboxReaderFactory, MailboxSyncState } from './mailbox-reader';

interface FakeConfigRow {
  id: string;
  environment: IntegrationEnvironment;
  enabled: boolean;
  imapFolder: string;
  lastSyncUidValidity: bigint | null;
  lastSyncUid: bigint | null;
}

function fakeConfigService(values: Record<string, string>) {
  return { get: (key: string) => values[key] };
}

/** Returns both the MailboxReader-typed object (to hand to the service) and the raw jest.fn
 * handles (to assert against directly) — asserting via `reader.getMailboxState` would trigger
 * @typescript-eslint/unbound-method, since MailboxReader declares its members with method
 * shorthand syntax. */
function fakeReader(overrides: {
  getMailboxState?: jest.Mock<() => Promise<MailboxSyncState>>;
  fetchMessagesSince?: jest.Mock<() => Promise<FetchSinceResult>>;
  close?: jest.Mock<() => Promise<void>>;
} = {}) {
  const getMailboxState = overrides.getMailboxState ?? jest.fn(() => Promise.resolve({ uidValidity: 1n, uidNext: 1n }));
  const fetchMessagesSince = overrides.fetchMessagesSince ?? jest.fn(() => Promise.resolve({ outcome: 'ok' as const, messages: [] }));
  const close = overrides.close ?? jest.fn(() => Promise.resolve());
  const reader: MailboxReader = { getMailboxState, fetchMessagesSince, close };
  return { reader, getMailboxState, fetchMessagesSince, close };
}

/**
 * A realistic, STATEFUL fake for prisma.mailConfiguration — updateMany actually enforces its WHERE
 * clause (id + any other supplied fields) against current row state, exactly like MariaDB would,
 * so the cursor-CAS logic under test is genuinely exercised rather than trivially rubber-stamped.
 */
function fakePrisma(configs: FakeConfigRow[]) {
  const rows = new Map(configs.map((c) => [c.id, { ...c }]));
  const findMany = jest.fn(() => Promise.resolve([...rows.values()].filter((r) => r.enabled)));
  const updateMany = jest.fn((args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    const row = rows.get(args.where.id as string);
    if (!row) return Promise.resolve({ count: 0 });
    for (const [key, value] of Object.entries(args.where)) {
      if (key === 'id') continue;
      if ((row as Record<string, unknown>)[key] !== value) return Promise.resolve({ count: 0 });
    }
    Object.assign(row, args.data);
    return Promise.resolve({ count: 1 });
  });
  const findUniqueOrThrow = jest.fn((args: { where: { id: string } }) => {
    const row = rows.get(args.where.id);
    if (!row) throw new Error('not found');
    return Promise.resolve({ ...row });
  });
  const emailMessageCreate = jest.fn(() => Promise.resolve({ id: 'email-message-1' }));
  const tx = { emailMessage: { create: emailMessageCreate } };
  const $transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(tx));
  const prisma = { mailConfiguration: { findMany, updateMany, findUniqueOrThrow }, $transaction };
  return { prisma, rows, findMany, updateMany, findUniqueOrThrow, emailMessageCreate };
}

function harness(options: {
  configs: FakeConfigRow[];
  readers: Record<string, MailboxReader>;
  configValues: Record<string, string>;
  correlate?: jest.Mock<() => Promise<{ threadId: string; customerId: string | null; renewalCaseId: string | null; classificationStatus: string }>>;
}) {
  const { prisma, updateMany, findUniqueOrThrow, findMany } = fakePrisma(options.configs);
  const healthRecord = jest.fn((id: string, status: HealthStatus, message: string) => {
    void id;
    void status;
    void message;
    return Promise.resolve();
  });
  const auditRecord = jest.fn((event: { eventKey: string }) => {
    void event;
    return Promise.resolve();
  });
  const audit = { record: auditRecord };
  const health = { record: healthRecord };
  const correlate =
    options.correlate ??
    jest.fn(() =>
      Promise.resolve({ threadId: 'thread-1', customerId: null, renewalCaseId: null, classificationStatus: 'PENDING' }),
    );
  const correlation = { correlate };
  const clock = { now: () => new Date('2026-01-01T00:00:00.000Z') };
  const config = fakeConfigService(options.configValues);
  const readerFactory: MailboxReaderFactory = {
    createReader: (mailConfiguration) => {
      const reader = options.readers[mailConfiguration.id];
      if (!reader) throw new Error(`no fake reader configured for ${mailConfiguration.id}`);
      return reader;
    },
  };

  const service = new MailInboundIngestService(
    prisma as never,
    config as never,
    clock,
    audit as never,
    health as never,
    correlation as never,
    readerFactory,
  );

  return { service, findMany, healthRecord, auditRecord, updateMany, findUniqueOrThrow };
}

const uninitialized: FakeConfigRow = {
  id: 'config-1',
  environment: IntegrationEnvironment.SANDBOX,
  enabled: true,
  imapFolder: 'INBOX',
  lastSyncUidValidity: null,
  lastSyncUid: null,
};

describe('MailInboundIngestService', () => {
  it('§35 — never queries or connects to any mailbox when IMAP_SYNC_ENABLED=false', async () => {
    const { service, findMany } = harness({
      configs: [uninitialized],
      readers: {},
      configValues: { IMAP_SYNC_ENABLED: 'false', NODE_ENV: 'test' },
    });

    const summary = await service.syncAll();

    expect(summary).toEqual({
      configsProcessed: 0,
      configsSkipped: 0,
      messagesIngested: 0,
      duplicatesSkipped: 0,
      humanReviewCount: 0,
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('processes only configs matching the strict environment pairing (production node -> PRODUCTION config only)', async () => {
    const sandboxConfig = { ...uninitialized, id: 'sandbox-config', environment: IntegrationEnvironment.SANDBOX };
    const productionConfig = { ...uninitialized, id: 'prod-config', environment: IntegrationEnvironment.PRODUCTION };
    const { reader, getMailboxState } = fakeReader();
    const { service } = harness({
      configs: [sandboxConfig, productionConfig],
      readers: { 'prod-config': reader },
      configValues: { IMAP_SYNC_ENABLED: 'true', NODE_ENV: 'production', IMAP_MODE: 'real' },
    });

    const summary = await service.syncAll();

    expect(summary.configsProcessed).toBe(1);
    expect(getMailboxState).toHaveBeenCalledTimes(1);
  });

  describe('cursor state classification (§1)', () => {
    it('INCONSISTENT (uidValidity set, uid NULL) fails closed before ever opening a mailbox connection', async () => {
      const inconsistent = { ...uninitialized, lastSyncUidValidity: 5n, lastSyncUid: null };
      const { service, healthRecord, auditRecord } = harness({
        configs: [inconsistent],
        readers: {}, // no reader configured — a connection attempt would throw "no fake reader".
        configValues: { IMAP_SYNC_ENABLED: 'true', NODE_ENV: 'test' },
      });

      const summary = await service.syncAll();

      expect(summary.configsProcessed).toBe(1); // handled, not "skipped due to error".
      expect(healthRecord).toHaveBeenCalledWith(
        'config-1',
        HealthStatus.UNAVAILABLE,
        expect.stringContaining(IMAP_HEALTH_MESSAGE.CURSOR_INCONSISTENT_REQUIRES_REVIEW),
      );
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ eventKey: IMAP_AUDIT_EVENT.CURSOR_INCONSISTENT }),
      );
    });

    it('INCONSISTENT (uid set, uidValidity NULL) also fails closed', async () => {
      const inconsistent = { ...uninitialized, lastSyncUidValidity: null, lastSyncUid: 5n };
      const { service, healthRecord } = harness({
        configs: [inconsistent],
        readers: {},
        configValues: { IMAP_SYNC_ENABLED: 'true', NODE_ENV: 'test' },
      });

      await service.syncAll();

      expect(healthRecord).toHaveBeenCalledWith(
        'config-1',
        HealthStatus.UNAVAILABLE,
        expect.stringContaining(IMAP_HEALTH_MESSAGE.CURSOR_INCONSISTENT_REQUIRES_REVIEW),
      );
    });
  });

  describe('bootstrap CAS (§2)', () => {
    it('§9 — a winning CAS establishes a bootstrap baseline (uidNext-1) without fetching any messages', async () => {
      const { reader, fetchMessagesSince } = fakeReader({
        getMailboxState: jest.fn(() => Promise.resolve({ uidValidity: 7n, uidNext: 42n })),
      });
      const { service, updateMany, auditRecord } = harness({
        configs: [uninitialized],
        readers: { 'config-1': reader },
        configValues: { IMAP_SYNC_ENABLED: 'true', NODE_ENV: 'test' },
      });

      await service.syncAll();

      expect(fetchMessagesSince).not.toHaveBeenCalled();
      const casCall = updateMany.mock.calls[0]![0];
      expect(casCall.where).toEqual({ id: 'config-1', lastSyncUidValidity: null, lastSyncUid: null });
      expect(casCall.data).toMatchObject({ lastSyncUidValidity: 7n, lastSyncUid: 41n });
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ eventKey: IMAP_AUDIT_EVENT.SYNC_BASELINE_ESTABLISHED }),
      );
    });

    it('§9 — bootstrap baseline for an empty mailbox (uidNext=1) sets lastSyncUid to 0, never negative', async () => {
      const { reader } = fakeReader({
        getMailboxState: jest.fn(() => Promise.resolve({ uidValidity: 1n, uidNext: 1n })),
      });
      const { service, updateMany } = harness({
        configs: [uninitialized],
        readers: { 'config-1': reader },
        configValues: { IMAP_SYNC_ENABLED: 'true', NODE_ENV: 'test' },
      });

      await service.syncAll();

      expect(updateMany.mock.calls[0]![0].data).toMatchObject({ lastSyncUid: 0n });
    });

    it('a LOSING bootstrap CAS never overwrites the winner, and is not audited as a baseline-established event', async () => {
      const { reader } = fakeReader({
        getMailboxState: jest.fn(() => Promise.resolve({ uidValidity: 7n, uidNext: 42n })),
      });
      const { service, updateMany, findUniqueOrThrow, auditRecord } = harness({
        configs: [uninitialized],
        readers: { 'config-1': reader },
        configValues: { IMAP_SYNC_ENABLED: 'true', NODE_ENV: 'test' },
      });
      // Force the CAS to lose (simulating another worker having won it first), then simulate that
      // worker's already-ESTABLISHED row on re-read.
      updateMany.mockImplementationOnce(() => Promise.resolve({ count: 0 }));
      findUniqueOrThrow.mockImplementationOnce(() =>
        Promise.resolve({ ...uninitialized, lastSyncUidValidity: 99n, lastSyncUid: 5n }),
      );

      await service.syncAll();

      const baselineEvents = auditRecord.mock.calls.filter(
        (call) => call[0].eventKey === IMAP_AUDIT_EVENT.SYNC_BASELINE_ESTABLISHED,
      );
      expect(baselineEvents).toHaveLength(0);
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          eventKey: IMAP_AUDIT_EVENT.CURSOR_CONFLICT,
        }),
      );
    });

    it('a losing bootstrap CAS that re-reads an INCONSISTENT row fails closed rather than guessing', async () => {
      const { reader } = fakeReader({
        getMailboxState: jest.fn(() => Promise.resolve({ uidValidity: 7n, uidNext: 42n })),
      });
      const { service, updateMany, findUniqueOrThrow, healthRecord } = harness({
        configs: [uninitialized],
        readers: { 'config-1': reader },
        configValues: { IMAP_SYNC_ENABLED: 'true', NODE_ENV: 'test' },
      });
      updateMany.mockImplementationOnce(() => Promise.resolve({ count: 0 }));
      findUniqueOrThrow.mockImplementationOnce(() =>
        Promise.resolve({ ...uninitialized, lastSyncUidValidity: 99n, lastSyncUid: null }),
      );

      await service.syncAll();

      expect(healthRecord).toHaveBeenCalledWith(
        'config-1',
        HealthStatus.UNAVAILABLE,
        expect.stringContaining(IMAP_HEALTH_MESSAGE.CURSOR_INCONSISTENT_REQUIRES_REVIEW),
      );
    });
  });

  describe('normal cursor advancement CAS (§3)', () => {
    const established: FakeConfigRow = { ...uninitialized, lastSyncUidValidity: 1n, lastSyncUid: 0n };

    it('§11/§2(correction) — the ESTABLISHED path never calls getMailboxState separately; fetchMessagesSince itself owns the UIDVALIDITY check', async () => {
      const { reader, getMailboxState } = fakeReader({
        fetchMessagesSince: jest.fn(() => Promise.resolve({ outcome: 'ok' as const, messages: [] })),
      });
      const { service } = harness({
        configs: [established],
        readers: { 'config-1': reader },
        configValues: { IMAP_SYNC_ENABLED: 'true', NODE_ENV: 'test' },
      });

      await service.syncAll();

      // Closes the check-then-fetch TOCTOU window: there is no separate pre-check call at all —
      // the identity check happens inside fetchMessagesSince's own single operation.
      expect(getMailboxState).not.toHaveBeenCalled();
    });

    it('§11/§2(correction) — a fetch-time UIDVALIDITY mismatch (V1 checked, reader now sees V2) stops sync, zero inserts, cursor unchanged', async () => {
      // Simulates the reader having independently detected, inside its own selection, that the
      // mailbox's current UIDVALIDITY (V2=6n) no longer matches what the ingest service expected
      // (V1=5n, the stored cursor's UIDVALIDITY) — exactly the TOCTOU scenario §2 closes.
      const fetchMessagesSince = jest.fn(() => Promise.resolve({ outcome: 'uidvalidity_changed' as const, currentUidValidity: 6n }));
      const { reader } = fakeReader({ fetchMessagesSince });
      const { service, healthRecord, auditRecord, updateMany } = harness({
        configs: [{ ...established, lastSyncUidValidity: 5n, lastSyncUid: 10n }],
        readers: { 'config-1': reader },
        configValues: { IMAP_SYNC_ENABLED: 'true', NODE_ENV: 'test' },
      });

      const summary = await service.syncAll();

      expect(summary.messagesIngested).toBe(0); // zero EmailMessages inserted.
      expect(updateMany).not.toHaveBeenCalled(); // cursor unchanged — no automatic reset.
      expect(healthRecord).toHaveBeenCalledWith(
        'config-1',
        HealthStatus.UNAVAILABLE,
        expect.stringContaining(IMAP_HEALTH_MESSAGE.UIDVALIDITY_CHANGED_REQUIRES_CURSOR_RESET),
      );
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ eventKey: IMAP_AUDIT_EVENT.UIDVALIDITY_CHANGED }),
      );
    });

    it('advances the cursor to each successfully-handled UID via CAS, in order, and reports the total ingested', async () => {
      const { reader } = fakeReader({
        fetchMessagesSince: jest.fn(() =>
          Promise.resolve({
            outcome: 'ok' as const,
            messages: [
              { uid: 1n, internalDate: new Date(), subject: 's1', fromAddress: 'a@example.com', toAddresses: [], messageIdHeader: undefined, inReplyToHeader: undefined, referencesHeader: undefined, renewalCaseIdHeader: undefined, text: 'b1', html: undefined, parseFailed: false },
              { uid: 2n, internalDate: new Date(), subject: 's2', fromAddress: 'a@example.com', toAddresses: [], messageIdHeader: undefined, inReplyToHeader: undefined, referencesHeader: undefined, renewalCaseIdHeader: undefined, text: 'b2', html: undefined, parseFailed: false },
            ],
          }),
        ),
      });
      const { service, updateMany } = harness({
        configs: [established],
        readers: { 'config-1': reader },
        configValues: { IMAP_SYNC_ENABLED: 'true', NODE_ENV: 'test' },
      });

      const summary = await service.syncAll();

      expect(summary.messagesIngested).toBe(2);
      const uidsWritten = updateMany.mock.calls.map((call) => (call[0].data as { lastSyncUid?: bigint }).lastSyncUid);
      expect(uidsWritten).toEqual([1n, 2n]);
      // Each CAS call's WHERE must reference the PREVIOUS cursor value, proving it is a genuine
      // compare-and-swap chain rather than a blind write.
      expect(updateMany.mock.calls[0]![0].where).toMatchObject({ lastSyncUid: 0n });
      expect(updateMany.mock.calls[1]![0].where).toMatchObject({ lastSyncUid: 1n });
    });

    it('duplicate/already-ingested messages advance the cursor via CAS exactly like a successful insert', async () => {
      const { reader } = fakeReader({
        fetchMessagesSince: jest.fn(() =>
          Promise.resolve({
            outcome: 'ok' as const,
            messages: [
              { uid: 1n, internalDate: new Date(), subject: 's1', fromAddress: 'a@example.com', toAddresses: [], messageIdHeader: undefined, inReplyToHeader: undefined, referencesHeader: undefined, renewalCaseIdHeader: undefined, text: 'b1', html: undefined, parseFailed: false },
            ],
          }),
        ),
      });
      const { prisma } = fakePrisma([established]);
      // Force a P2002 duplicate on the very first insert attempt.
      const dupError = new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: 'x' });
      (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest.fn(() => Promise.reject(dupError));
      const healthRecord = jest.fn(() => Promise.resolve());
      const auditRecord = jest.fn(() => Promise.resolve());
      const correlate = jest.fn(() =>
        Promise.resolve({ threadId: 't', customerId: null, renewalCaseId: null, classificationStatus: 'PENDING' }),
      );
      const service = new MailInboundIngestService(
        prisma as never,
        fakeConfigService({ IMAP_SYNC_ENABLED: 'true', NODE_ENV: 'test' }) as never,
        { now: () => new Date('2026-01-01T00:00:00.000Z') },
        { record: auditRecord } as never,
        { record: healthRecord } as never,
        { correlate } as never,
        { createReader: () => reader },
      );

      const summary = await service.syncAll();

      expect(summary.duplicatesSkipped).toBe(1);
      expect(summary.messagesIngested).toBe(0);
      const config = await prisma.mailConfiguration.findUniqueOrThrow({ where: { id: 'config-1' } });
      expect(config.lastSyncUid).toBe(1n); // cursor still advances past a duplicate.
    });

    it('a failed UID (correlation throws) stops the batch and never attempts a cursor CAS for it', async () => {
      const { reader } = fakeReader({
        fetchMessagesSince: jest.fn(() =>
          Promise.resolve({
            outcome: 'ok' as const,
            messages: [
              { uid: 1n, internalDate: new Date(), subject: 's1', fromAddress: 'a@example.com', toAddresses: [], messageIdHeader: undefined, inReplyToHeader: undefined, referencesHeader: undefined, renewalCaseIdHeader: undefined, text: 'b1', html: undefined, parseFailed: false },
              { uid: 2n, internalDate: new Date(), subject: 's2', fromAddress: 'a@example.com', toAddresses: [], messageIdHeader: undefined, inReplyToHeader: undefined, referencesHeader: undefined, renewalCaseIdHeader: undefined, text: 'b2', html: undefined, parseFailed: false },
            ],
          }),
        ),
      });
      const correlate = jest.fn(() => Promise.reject(new Error('correlation exploded')));
      const { service, updateMany, healthRecord, auditRecord } = harness({
        configs: [established],
        readers: { 'config-1': reader },
        configValues: { IMAP_SYNC_ENABLED: 'true', NODE_ENV: 'test' },
        correlate,
      });

      const summary = await service.syncAll();

      expect(summary.messagesIngested).toBe(0);
      expect(updateMany).not.toHaveBeenCalled(); // no CAS attempted for the failed (or later) UID.
      expect(correlate).toHaveBeenCalledTimes(1); // stopped after the first failure.
      expect(healthRecord).toHaveBeenCalledWith('config-1', HealthStatus.DEGRADED, expect.any(String));
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ eventKey: IMAP_AUDIT_EVENT.MESSAGE_INGEST_FAILED }),
      );
    });

    it('CAS loss: another worker already progressed past the attempted UID — stops cleanly, never regresses', async () => {
      const { reader } = fakeReader({
        fetchMessagesSince: jest.fn(() =>
          Promise.resolve({
            outcome: 'ok' as const,
            messages: [
              { uid: 1n, internalDate: new Date(), subject: 's1', fromAddress: 'a@example.com', toAddresses: [], messageIdHeader: undefined, inReplyToHeader: undefined, referencesHeader: undefined, renewalCaseIdHeader: undefined, text: 'b1', html: undefined, parseFailed: false },
            ],
          }),
        ),
      });
      const { service, updateMany, findUniqueOrThrow, auditRecord, healthRecord } = harness({
        configs: [established],
        readers: { 'config-1': reader },
        configValues: { IMAP_SYNC_ENABLED: 'true', NODE_ENV: 'test' },
      });
      updateMany.mockImplementationOnce(() => Promise.resolve({ count: 0 }));
      findUniqueOrThrow.mockImplementationOnce(() =>
        Promise.resolve({ ...established, lastSyncUid: 5n }), // already past uid=1
      );

      await service.syncAll();

      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          eventKey: IMAP_AUDIT_EVENT.CURSOR_CONFLICT,
        }),
      );
      // Benign race — must not be reported as a health DEGRADED failure.
      expect(healthRecord).not.toHaveBeenCalledWith('config-1', HealthStatus.DEGRADED, expect.anything());
    });

    it('CAS loss: UIDVALIDITY changed mid-run is treated via the fail-closed UIDVALIDITY path', async () => {
      const { reader } = fakeReader({
        fetchMessagesSince: jest.fn(() =>
          Promise.resolve({
            outcome: 'ok' as const,
            messages: [
              { uid: 1n, internalDate: new Date(), subject: 's1', fromAddress: 'a@example.com', toAddresses: [], messageIdHeader: undefined, inReplyToHeader: undefined, referencesHeader: undefined, renewalCaseIdHeader: undefined, text: 'b1', html: undefined, parseFailed: false },
            ],
          }),
        ),
      });
      const { service, updateMany, findUniqueOrThrow, healthRecord } = harness({
        configs: [established],
        readers: { 'config-1': reader },
        configValues: { IMAP_SYNC_ENABLED: 'true', NODE_ENV: 'test' },
      });
      updateMany.mockImplementationOnce(() => Promise.resolve({ count: 0 }));
      findUniqueOrThrow.mockImplementationOnce(() => Promise.resolve({ ...established, lastSyncUidValidity: 999n }));

      await service.syncAll();

      expect(healthRecord).toHaveBeenCalledWith(
        'config-1',
        HealthStatus.UNAVAILABLE,
        expect.stringContaining(IMAP_HEALTH_MESSAGE.UIDVALIDITY_CHANGED_REQUIRES_CURSOR_RESET),
      );
    });

    it('CAS loss: unexpected conflict (cursor behind but our expected value stale) stops safely and reports DEGRADED', async () => {
      const { reader } = fakeReader({
        fetchMessagesSince: jest.fn(() =>
          Promise.resolve({
            outcome: 'ok' as const,
            messages: [
              { uid: 5n, internalDate: new Date(), subject: 's1', fromAddress: 'a@example.com', toAddresses: [], messageIdHeader: undefined, inReplyToHeader: undefined, referencesHeader: undefined, renewalCaseIdHeader: undefined, text: 'b1', html: undefined, parseFailed: false },
            ],
          }),
        ),
      });
      const { service, updateMany, findUniqueOrThrow, auditRecord, healthRecord } = harness({
        configs: [established],
        readers: { 'config-1': reader },
        configValues: { IMAP_SYNC_ENABLED: 'true', NODE_ENV: 'test' },
      });
      updateMany.mockImplementationOnce(() => Promise.resolve({ count: 0 }));
      // Still same uidValidity, cursor is behind uid=5, but doesn't match what we expected either.
      findUniqueOrThrow.mockImplementationOnce(() => Promise.resolve({ ...established, lastSyncUid: 2n }));

      await service.syncAll();

      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ eventKey: IMAP_AUDIT_EVENT.CURSOR_CONFLICT }),
      );
      expect(healthRecord).toHaveBeenCalledWith('config-1', HealthStatus.DEGRADED, expect.any(String));
    });
  });

  it('§30 — one mailbox failing to connect does not stop another from being processed', async () => {
    const failingConfig = { ...uninitialized, id: 'failing-config' };
    const okConfig = { ...uninitialized, id: 'ok-config' };
    const { reader: failingReader } = fakeReader({
      getMailboxState: jest.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
    });
    const { reader: okReader } = fakeReader({
      getMailboxState: jest.fn(() => Promise.resolve({ uidValidity: 1n, uidNext: 1n })),
    });
    const { service, healthRecord } = harness({
      configs: [failingConfig, okConfig],
      readers: { 'failing-config': failingReader, 'ok-config': okReader },
      configValues: { IMAP_SYNC_ENABLED: 'true', NODE_ENV: 'test' },
    });

    const summary = await service.syncAll();

    expect(summary.configsSkipped).toBe(1);
    expect(summary.configsProcessed).toBe(1);
    expect(healthRecord).toHaveBeenCalledWith('failing-config', HealthStatus.UNAVAILABLE, expect.any(String));
  });

  it('closes the reader even when getMailboxState throws', async () => {
    const { reader, close } = fakeReader({
      getMailboxState: jest.fn(() => Promise.reject(new Error('boom'))),
    });
    const { service } = harness({
      configs: [uninitialized],
      readers: { 'config-1': reader },
      configValues: { IMAP_SYNC_ENABLED: 'true', NODE_ENV: 'test' },
    });

    await service.syncAll();

    expect(close).toHaveBeenCalledTimes(1);
  });
});
