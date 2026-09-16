import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import mariadb, { type Connection } from 'mariadb';
import { toMariaDbDriverUrl } from '../src/database/mariadb-url';
import { AuditService } from '../src/audit/audit.service';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  BillingFrequency,
  ClassificationStatus,
  CustomerStatus,
  IntegrationEnvironment,
  PaymentScope,
  RenewalCaseStatus,
  SubscriptionStatus,
  ThreadStatus,
} from '../src/generated/prisma/enums';
import { MailImapHealthService } from '../src/modules/mail/mail-imap-health.service';
import { MailInboundCorrelationService } from '../src/modules/mail/mail-inbound-correlation.service';
import { MailInboundIngestService } from '../src/modules/mail/mail-inbound-ingest.service';
import { MailInboundSenderResolutionService } from '../src/modules/mail/mail-inbound-sender-resolution.service';
import { MailThreadResolutionService } from '../src/modules/mail/mail-thread-resolution.service';
import { MockMailboxReaderFactory } from '../src/modules/mail/mock-mailbox-reader-factory';
import type { FetchedMailboxMessage } from '../src/modules/mail/mailbox-reader';
import { readAllMigrationsSql } from './read-all-migrations';

// Live-DB verification (Slice C §36) of invariants a hand-rolled Prisma fake cannot actually
// prove: real unique-index enforcement of imapIdentityKey under concurrency, real unique-index
// enforcement of the one-canonical-thread-per-RenewalCase constraint under concurrency, and
// genuine relational/BigInt persistence. Business-rule branching (thread matching priority,
// sender attribution, classification) is exercised here too (§32/§33 test matrices) because it is
// most realistically driven end-to-end through MailInboundIngestService.syncAll() against a real
// schema, rather than re-mocked a second time.
const databaseUrl = process.env.MARIADB_TEST_DATABASE_URL;
const liveDescribe = databaseUrl ? describe : describe.skip;
const migrations = readAllMigrationsSql();

function options(url: string): mariadb.ConnectionConfig {
  const parsed = new URL(url);
  const database = decodeURIComponent(parsed.pathname.slice(1));
  if (parsed.protocol !== 'mysql:' || !database.endsWith('_test')) {
    throw new Error('MARIADB_TEST_DATABASE_URL must target a disposable *_test MariaDB database.');
  }
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
    multipleStatements: true,
  };
}

async function reset(connection: Connection) {
  await connection.query('SET FOREIGN_KEY_CHECKS = 0');
  const tables: Array<{ TABLE_NAME: string }> = await connection.query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()',
  );
  for (const { TABLE_NAME } of tables) {
    if (!/^[a-z0-9_]+$/i.test(TABLE_NAME)) throw new Error('Unsafe test table name.');
    await connection.query(`DROP TABLE \`${TABLE_NAME}\``);
  }
  await connection.query('SET FOREIGN_KEY_CHECKS = 1');
}

function fakeConfigService(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = { IMAP_SYNC_ENABLED: 'true', NODE_ENV: 'test', IMAP_MODE: 'mock', ...overrides };
  return { get: (key: string) => values[key] };
}

function message(uid: bigint, overrides: Partial<FetchedMailboxMessage> = {}): FetchedMailboxMessage {
  return {
    uid,
    internalDate: new Date('2026-01-01T00:00:00.000Z'),
    subject: `Subject ${uid}`,
    fromAddress: 'unknown@example.test',
    toAddresses: ['support@nusrv.test'],
    messageIdHeader: `<${randomUUID()}@example.test>`,
    inReplyToHeader: undefined,
    referencesHeader: undefined,
    renewalCaseIdHeader: undefined,
    text: `Body ${uid}`,
    html: undefined,
    parseFailed: false,
    ...overrides,
  };
}

liveDescribe('Phase 3 Slice C MariaDB inbound-mail integration', () => {
  let connection: Connection;
  let prisma: PrismaClient;
  let billingEntityId: string;
  let serviceTypeId: string;
  let mailConfigurationId: string;
  let otherMailConfigurationId: string;

  beforeAll(async () => {
    const url = databaseUrl as string;
    connection = await mariadb.createConnection(options(url));
    await reset(connection);
    await connection.query(migrations);
    prisma = new PrismaClient({ adapter: new PrismaMariaDb(toMariaDbDriverUrl(url)) });

    const billingEntity = await prisma.billingEntity.create({
      data: {
        code: `S3C-${randomUUID()}`,
        customerCodePrefix: `S${randomUUID().slice(0, 3).toUpperCase()}`,
        name: 'Slice C Entity',
        legalName: 'Slice C Entity',
        paymentScope: PaymentScope.LOCAL,
      },
    });
    billingEntityId = billingEntity.id;

    const serviceType = await prisma.serviceType.create({
      data: { code: `S3C-ST-${randomUUID()}`, name: 'Slice C Hosting' },
    });
    serviceTypeId = serviceType.id;
  }, 30_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    if (connection) {
      await reset(connection);
      await connection.end();
    }
  }, 30_000);

  beforeEach(async () => {
    const primary = await prisma.mailConfiguration.create({
      data: {
        scopeKey: `BILLING_ENTITY:${randomUUID()}`,
        label: 'Primary mailbox',
        smtpHost: 'smtp.example.test',
        smtpPort: 587,
        smtpUsername: 'no-reply@example.test',
        imapHost: 'imap.example.test',
        imapPort: 993,
        imapUsername: 'no-reply@example.test',
        imapFolder: 'INBOX',
        fromAddress: 'no-reply@example.test',
        fromName: 'Slice C',
        environment: IntegrationEnvironment.SANDBOX,
        enabled: true,
      },
    });
    mailConfigurationId = primary.id;
    const other = await prisma.mailConfiguration.create({
      data: {
        scopeKey: `BILLING_ENTITY:${randomUUID()}`,
        label: 'Other mailbox',
        smtpHost: 'smtp2.example.test',
        smtpPort: 587,
        smtpUsername: 'no-reply2@example.test',
        imapHost: 'imap2.example.test',
        imapPort: 993,
        imapUsername: 'no-reply2@example.test',
        imapFolder: 'INBOX',
        fromAddress: 'no-reply2@example.test',
        fromName: 'Slice C Other',
        environment: IntegrationEnvironment.SANDBOX,
        enabled: true,
      },
    });
    otherMailConfigurationId = other.id;
  });

  afterEach(async () => {
    // Foreign keys cascade/restrict per schema; delete children before the mailboxes themselves.
    // audit_events is intentionally NOT cleared here — it is append-only (a DB trigger rejects any
    // DELETE, matching the "immutable audit log" design) — rows simply accumulate for the life of
    // this suite and are never queried by table-wide count, only ever scoped by specific ids.
    await prisma.emailMessage.deleteMany({});
    await prisma.communicationThread.deleteMany({});
    await prisma.integrationHealthEvent.deleteMany({});
    await prisma.renewalCase.deleteMany({});
    await prisma.subscription.deleteMany({});
    await prisma.customerEmailAddress.deleteMany({});
    await prisma.customer.deleteMany({});
    await prisma.mailConfiguration.deleteMany({});
  });

  async function createCustomer(overrides: { status?: CustomerStatus; email?: string } = {}) {
    const email = overrides.email ?? `${randomUUID()}@example.test`;
    const customer = await prisma.customer.create({
      data: {
        billingEntityId,
        customerCode: `S3C-C-${randomUUID()}`,
        nameEn: 'Slice C Customer',
        primaryEmail: email,
        status: overrides.status ?? CustomerStatus.ACTIVE,
      },
    });
    await prisma.customerEmailAddress.create({
      data: { customerId: customer.id, email, primary: true, active: true },
    });
    return customer;
  }

  async function createRenewalCase(customerId: string) {
    const subscription = await prisma.subscription.create({
      data: {
        customerId,
        serviceTypeId,
        subscriptionCode: `S3C-SUB-${randomUUID()}`,
        name: 'Slice C Subscription',
        startDate: new Date('2020-01-01T00:00:00Z'),
        renewalDate: new Date('2027-01-01T00:00:00Z'),
        billingFrequency: BillingFrequency.ANNUAL,
        sellingPrice: '100.000',
        currency: 'JOD',
        status: SubscriptionStatus.ACTIVE,
      },
    });
    return prisma.renewalCase.create({
      data: {
        subscriptionId: subscription.id,
        cycleStartDate: new Date('2026-01-01T00:00:00Z'),
        dueDate: subscription.renewalDate,
        status: RenewalCaseStatus.REMINDER_CYCLE,
      },
    });
  }

  function buildIngestService(readerFactory: MockMailboxReaderFactory, configValues: Record<string, string> = {}) {
    const senderResolution = new MailInboundSenderResolutionService(prisma as never);
    const threadResolution = new MailThreadResolutionService(prisma as never);
    const correlation = new MailInboundCorrelationService(prisma as never, senderResolution, threadResolution);
    // Slice D's real enqueue producer needs an injected BullMQ Queue this suite does not wire up
    // (it exists to test Slice C's ingest/correlation/cursor behavior, not AI classification) — a
    // no-op stub is sufficient here, matching AI_ENABLED's own default-off behavior.
    const aiEnqueue = { enqueueIfEnabled: () => Promise.resolve() };
    return new MailInboundIngestService(
      prisma as never,
      fakeConfigService(configValues) as never,
      { now: () => new Date('2026-01-02T00:00:00.000Z') },
      new AuditService(prisma as never),
      new MailImapHealthService(prisma as never),
      correlation,
      readerFactory,
      aiEnqueue as never,
    );
  }

  async function bootstrapConfig(readerFactory: MockMailboxReaderFactory, configId: string) {
    readerFactory.getReaderFor(configId).setFolderState('INBOX', 1n, 1n, []);
    await buildIngestService(readerFactory).syncAll();
  }

  // ---------------------------------------------------------------------------------------------
  // §32 — thread-correlation matrix (representative coverage of the frozen priority list)
  // ---------------------------------------------------------------------------------------------

  it('A/B — In-Reply-To matches an existing outbound Message-ID, landing on the same thread', async () => {
    const customer = await createCustomer();
    const readerFactory = new MockMailboxReaderFactory();
    await bootstrapConfig(readerFactory, mailConfigurationId);
    const ingest = buildIngestService(readerFactory);

    const thread = await prisma.communicationThread.create({
      data: { customerId: customer.id, mailConfigurationId, subject: 'Original', status: ThreadStatus.OPEN, lastMessageAt: new Date('2026-01-01T00:00:00Z') },
    });
    const priorMessageId = `<${randomUUID()}@example.test>`;
    await prisma.emailMessage.create({
      data: {
        threadId: thread.id,
        customerId: customer.id,
        direction: 'OUTBOUND',
        channel: 'EMAIL',
        externalMessageId: priorMessageId,
        subject: 'Original',
        fromAddress: 'no-reply@example.test',
        toAddressesJson: [customer.primaryEmail],
        bodyText: 'hi',
        occurredAt: new Date('2026-01-01T00:00:00Z'),
        mailConfigurationId,
      },
    });

    readerFactory
      .getReaderFor(mailConfigurationId)
      .appendMessage('INBOX', message(1n, { fromAddress: customer.primaryEmail, inReplyToHeader: priorMessageId }));
    await ingest.syncAll();

    const rows = await prisma.emailMessage.findMany({ where: { threadId: thread.id, direction: 'INBOUND' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.classificationStatus).toBe(ClassificationStatus.PENDING);

    // B — a second reply with the SAME externalMessageId in In-Reply-To lands on the SAME thread.
    readerFactory
      .getReaderFor(mailConfigurationId)
      .appendMessage('INBOX', message(2n, { fromAddress: customer.primaryEmail, inReplyToHeader: priorMessageId }));
    await ingest.syncAll();
    const rows2 = await prisma.emailMessage.findMany({ where: { threadId: thread.id, direction: 'INBOUND' } });
    expect(rows2).toHaveLength(2);
  });

  it('C — the same externalMessageId pointing at TWO different threads is ambiguous -> HUMAN_REVIEW', async () => {
    const customer = await createCustomer();
    const readerFactory = new MockMailboxReaderFactory();
    await bootstrapConfig(readerFactory, mailConfigurationId);
    const ingest = buildIngestService(readerFactory);

    const sharedId = `<${randomUUID()}@example.test>`;
    const threadA = await prisma.communicationThread.create({
      data: { customerId: customer.id, mailConfigurationId, subject: 'A', status: ThreadStatus.OPEN, lastMessageAt: new Date() },
    });
    const threadB = await prisma.communicationThread.create({
      data: { customerId: customer.id, mailConfigurationId, subject: 'B', status: ThreadStatus.OPEN, lastMessageAt: new Date() },
    });
    for (const t of [threadA, threadB]) {
      await prisma.emailMessage.create({
        data: {
          threadId: t.id,
          direction: 'OUTBOUND',
          channel: 'EMAIL',
          externalMessageId: sharedId,
          subject: t.subject,
          fromAddress: 'no-reply@example.test',
          toAddressesJson: [customer.primaryEmail],
          bodyText: 'hi',
          occurredAt: new Date(),
          mailConfigurationId,
        },
      });
    }

    readerFactory
      .getReaderFor(mailConfigurationId)
      .appendMessage('INBOX', message(1n, { fromAddress: customer.primaryEmail, inReplyToHeader: sharedId }));
    await ingest.syncAll();

    const rows = await prisma.emailMessage.findMany({ where: { direction: 'INBOUND' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.classificationStatus).toBe(ClassificationStatus.HUMAN_REVIEW);
    expect(rows[0]!.threadId).not.toBe(threadA.id);
    expect(rows[0]!.threadId).not.toBe(threadB.id);
  });

  it('G/H — X-Renewal-Case-Id with a matching sender attaches; a mismatched sender does not (HUMAN_REVIEW)', async () => {
    const customer = await createCustomer();
    const otherCustomer = await createCustomer();
    const renewalCase = await createRenewalCase(customer.id);
    const readerFactory = new MockMailboxReaderFactory();
    await bootstrapConfig(readerFactory, mailConfigurationId);
    const ingest = buildIngestService(readerFactory);

    readerFactory
      .getReaderFor(mailConfigurationId)
      .appendMessage('INBOX', message(1n, { fromAddress: customer.primaryEmail, renewalCaseIdHeader: renewalCase.id }));
    await ingest.syncAll();

    const thread = await prisma.communicationThread.findUniqueOrThrow({ where: { renewalCaseId: renewalCase.id } });
    const firstRow = await prisma.emailMessage.findFirstOrThrow({ where: { threadId: thread.id } });
    expect(firstRow.classificationStatus).toBe(ClassificationStatus.PENDING);
    expect(thread.status).toBe(ThreadStatus.OPEN);

    // H — a DIFFERENT sender forging the same X-Renewal-Case-Id must not attach to the case.
    readerFactory
      .getReaderFor(mailConfigurationId)
      .appendMessage('INBOX', message(2n, { fromAddress: otherCustomer.primaryEmail, renewalCaseIdHeader: renewalCase.id }));
    await ingest.syncAll();

    const forgedRow = await prisma.emailMessage.findFirstOrThrow({
      where: { fromAddress: otherCustomer.primaryEmail, direction: 'INBOUND' },
    });
    expect(forgedRow.renewalCaseId).toBeNull();
    expect(forgedRow.classificationStatus).toBe(ClassificationStatus.HUMAN_REVIEW);
    const caseThreadMessages = await prisma.emailMessage.count({ where: { threadId: thread.id } });
    expect(caseThreadMessages).toBe(1);
  });

  it('I — an existing case-thread under a DIFFERENT mailConfigurationId is never merged into', async () => {
    const customer = await createCustomer();
    const renewalCase = await createRenewalCase(customer.id);
    await prisma.communicationThread.create({
      data: {
        renewalCaseId: renewalCase.id,
        customerId: customer.id,
        mailConfigurationId: otherMailConfigurationId,
        subject: 'Case thread on other config',
        status: ThreadStatus.OPEN,
        lastMessageAt: new Date(),
      },
    });

    const readerFactory = new MockMailboxReaderFactory();
    await bootstrapConfig(readerFactory, mailConfigurationId);
    const ingest = buildIngestService(readerFactory);
    readerFactory
      .getReaderFor(mailConfigurationId)
      .appendMessage('INBOX', message(1n, { fromAddress: customer.primaryEmail, renewalCaseIdHeader: renewalCase.id }));
    await ingest.syncAll();

    const row = await prisma.emailMessage.findFirstOrThrow({ where: { direction: 'INBOUND' } });
    expect(row.mailConfigurationId).toBe(mailConfigurationId);
    expect(row.classificationStatus).toBe(ClassificationStatus.HUMAN_REVIEW);
    const otherThreadCount = await prisma.emailMessage.count({
      where: { thread: { renewalCaseId: renewalCase.id, mailConfigurationId: otherMailConfigurationId } },
    });
    expect(otherThreadCount).toBe(0);
  });

  it('J/K/L — no reply headers: unique active sender -> new OPEN thread; ambiguous/unknown sender -> HUMAN_REVIEW', async () => {
    const customer = await createCustomer();
    const readerFactory = new MockMailboxReaderFactory();
    await bootstrapConfig(readerFactory, mailConfigurationId);
    const ingest = buildIngestService(readerFactory);

    readerFactory.getReaderFor(mailConfigurationId).appendMessage('INBOX', message(1n, { fromAddress: customer.primaryEmail }));
    readerFactory.getReaderFor(mailConfigurationId).appendMessage('INBOX', message(2n, { fromAddress: 'nobody@example.test' }));
    await ingest.syncAll();

    const known = await prisma.emailMessage.findFirstOrThrow({ where: { fromAddress: customer.primaryEmail } });
    expect(known.customerId).toBe(customer.id);
    expect(known.classificationStatus).toBe(ClassificationStatus.PENDING);
    const knownThread = await prisma.communicationThread.findUniqueOrThrow({ where: { id: known.threadId } });
    expect(knownThread.status).toBe(ThreadStatus.OPEN);

    const unknown = await prisma.emailMessage.findFirstOrThrow({ where: { fromAddress: 'nobody@example.test' } });
    expect(unknown.customerId).toBeNull();
    expect(unknown.classificationStatus).toBe(ClassificationStatus.HUMAN_REVIEW);
  });

  it('inactive customer sender: attribution preserved, message and thread land in HUMAN_REVIEW without reactivating', async () => {
    const customer = await createCustomer({ status: CustomerStatus.INACTIVE });
    const readerFactory = new MockMailboxReaderFactory();
    await bootstrapConfig(readerFactory, mailConfigurationId);
    const ingest = buildIngestService(readerFactory);

    readerFactory.getReaderFor(mailConfigurationId).appendMessage('INBOX', message(1n, { fromAddress: customer.primaryEmail }));
    await ingest.syncAll();

    const row = await prisma.emailMessage.findFirstOrThrow({ where: { fromAddress: customer.primaryEmail } });
    expect(row.customerId).toBe(customer.id);
    expect(row.classificationStatus).toBe(ClassificationStatus.HUMAN_REVIEW);
    const thread = await prisma.communicationThread.findUniqueOrThrow({ where: { id: row.threadId } });
    expect(thread.status).toBe(ThreadStatus.HUMAN_REVIEW);
    const stillInactive = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(stillInactive.status).toBe(CustomerStatus.INACTIVE);
  });

  it('M — a matched-thread sender mismatch preserves the match but escalates to HUMAN_REVIEW without rewriting the Customer', async () => {
    const customerA = await createCustomer();
    const customerB = await createCustomer();
    const thread = await prisma.communicationThread.create({
      data: { customerId: customerA.id, mailConfigurationId, subject: 'Thread', status: ThreadStatus.OPEN, lastMessageAt: new Date() },
    });
    const priorMessageId = `<${randomUUID()}@example.test>`;
    await prisma.emailMessage.create({
      data: {
        threadId: thread.id,
        direction: 'OUTBOUND',
        channel: 'EMAIL',
        externalMessageId: priorMessageId,
        subject: 'Thread',
        fromAddress: 'no-reply@example.test',
        toAddressesJson: [customerA.primaryEmail],
        bodyText: 'hi',
        occurredAt: new Date(),
        mailConfigurationId,
      },
    });

    const readerFactory = new MockMailboxReaderFactory();
    await bootstrapConfig(readerFactory, mailConfigurationId);
    const ingest = buildIngestService(readerFactory);
    readerFactory
      .getReaderFor(mailConfigurationId)
      .appendMessage('INBOX', message(1n, { fromAddress: customerB.primaryEmail, inReplyToHeader: priorMessageId }));
    await ingest.syncAll();

    const row = await prisma.emailMessage.findFirstOrThrow({ where: { threadId: thread.id, direction: 'INBOUND' } });
    expect(row.classificationStatus).toBe(ClassificationStatus.HUMAN_REVIEW);
    const reloadedThread = await prisma.communicationThread.findUniqueOrThrow({ where: { id: thread.id } });
    expect(reloadedThread.customerId).toBe(customerA.id); // never rewritten
    expect(reloadedThread.status).toBe(ThreadStatus.HUMAN_REVIEW);
  });

  it('N — a valid reply reopens a RESOLVED thread to OPEN without touching the RenewalCase', async () => {
    const customer = await createCustomer();
    const renewalCase = await createRenewalCase(customer.id);
    const thread = await prisma.communicationThread.create({
      data: {
        renewalCaseId: renewalCase.id,
        customerId: customer.id,
        mailConfigurationId,
        subject: 'Case',
        status: ThreadStatus.RESOLVED,
        lastMessageAt: new Date('2026-01-01T00:00:00Z'),
      },
    });
    const priorMessageId = `<${randomUUID()}@example.test>`;
    await prisma.emailMessage.create({
      data: {
        threadId: thread.id,
        renewalCaseId: renewalCase.id,
        direction: 'OUTBOUND',
        channel: 'EMAIL',
        externalMessageId: priorMessageId,
        subject: 'Case',
        fromAddress: 'no-reply@example.test',
        toAddressesJson: [customer.primaryEmail],
        bodyText: 'hi',
        occurredAt: new Date('2026-01-01T00:00:00Z'),
        mailConfigurationId,
      },
    });

    const readerFactory = new MockMailboxReaderFactory();
    await bootstrapConfig(readerFactory, mailConfigurationId);
    const ingest = buildIngestService(readerFactory);
    readerFactory.getReaderFor(mailConfigurationId).appendMessage(
      'INBOX',
      message(1n, {
        fromAddress: customer.primaryEmail,
        inReplyToHeader: priorMessageId,
        internalDate: new Date('2026-01-02T00:00:00Z'),
      }),
    );
    await ingest.syncAll();

    const reloadedThread = await prisma.communicationThread.findUniqueOrThrow({ where: { id: thread.id } });
    expect(reloadedThread.status).toBe(ThreadStatus.OPEN);
    expect(reloadedThread.lastMessageAt.getTime()).toBeGreaterThan(new Date('2026-01-01T00:00:00Z').getTime());
    const reloadedCase = await prisma.renewalCase.findUniqueOrThrow({ where: { id: renewalCase.id } });
    expect(reloadedCase.status).toBe(RenewalCaseStatus.REMINDER_CYCLE);
  });

  it('O — a reply on a terminal RenewalCase retains correlation but flags HUMAN_REVIEW, never touching the case', async () => {
    const customer = await createCustomer();
    const renewalCase = await createRenewalCase(customer.id);
    await prisma.renewalCase.update({ where: { id: renewalCase.id }, data: { status: RenewalCaseStatus.FULFILLED } });
    const thread = await prisma.communicationThread.create({
      data: {
        renewalCaseId: renewalCase.id,
        customerId: customer.id,
        mailConfigurationId,
        subject: 'Case',
        status: ThreadStatus.RESOLVED,
        lastMessageAt: new Date('2026-01-01T00:00:00Z'),
      },
    });
    const priorMessageId = `<${randomUUID()}@example.test>`;
    await prisma.emailMessage.create({
      data: {
        threadId: thread.id,
        renewalCaseId: renewalCase.id,
        direction: 'OUTBOUND',
        channel: 'EMAIL',
        externalMessageId: priorMessageId,
        subject: 'Case',
        fromAddress: 'no-reply@example.test',
        toAddressesJson: [customer.primaryEmail],
        bodyText: 'hi',
        occurredAt: new Date('2026-01-01T00:00:00Z'),
        mailConfigurationId,
      },
    });

    const readerFactory = new MockMailboxReaderFactory();
    await bootstrapConfig(readerFactory, mailConfigurationId);
    const ingest = buildIngestService(readerFactory);
    readerFactory
      .getReaderFor(mailConfigurationId)
      .appendMessage('INBOX', message(1n, { fromAddress: customer.primaryEmail, inReplyToHeader: priorMessageId }));
    await ingest.syncAll();

    const row = await prisma.emailMessage.findFirstOrThrow({ where: { threadId: thread.id, direction: 'INBOUND' } });
    expect(row.classificationStatus).toBe(ClassificationStatus.HUMAN_REVIEW);
    expect(row.renewalCaseId).toBe(renewalCase.id);
    const reloadedCase = await prisma.renewalCase.findUniqueOrThrow({ where: { id: renewalCase.id } });
    expect(reloadedCase.status).toBe(RenewalCaseStatus.FULFILLED);
  });

  // ---------------------------------------------------------------------------------------------
  // §33 — idempotency / cursor matrix
  // ---------------------------------------------------------------------------------------------

  it('duplicate/already-ingested: a UID re-fetched after the cursor is manually rewound is not re-inserted', async () => {
    const customer = await createCustomer();
    const readerFactory = new MockMailboxReaderFactory();
    await bootstrapConfig(readerFactory, mailConfigurationId);
    const ingest = buildIngestService(readerFactory);

    readerFactory.getReaderFor(mailConfigurationId).appendMessage('INBOX', message(1n, { fromAddress: customer.primaryEmail }));
    const firstSummary = await ingest.syncAll();
    expect(firstSummary.messagesIngested).toBe(1);
    expect(await prisma.emailMessage.count({})).toBe(1);

    // Simulate a replay of the same UID (e.g. a crash-recovery / at-least-once redelivery) by
    // rewinding the persisted cursor directly, bypassing the service.
    await prisma.mailConfiguration.update({ where: { id: mailConfigurationId }, data: { lastSyncUid: 0n } });

    const secondSummary = await ingest.syncAll();
    expect(secondSummary.duplicatesSkipped).toBe(1);
    expect(secondSummary.messagesIngested).toBe(0);
    expect(await prisma.emailMessage.count({})).toBe(1);

    const config = await prisma.mailConfiguration.findUniqueOrThrow({ where: { id: mailConfigurationId } });
    expect(config.lastSyncUid).toBe(1n); // cursor advances past the duplicate too.
  });

  it('a message whose subject/fromAddress exceed their column widths is truncated, not rejected by the DB', async () => {
    const customer = await createCustomer();
    const readerFactory = new MockMailboxReaderFactory();
    await bootstrapConfig(readerFactory, mailConfigurationId);
    const ingest = buildIngestService(readerFactory);

    readerFactory.getReaderFor(mailConfigurationId).appendMessage(
      'INBOX',
      message(1n, { fromAddress: customer.primaryEmail, subject: 'x'.repeat(2000) }),
    );
    const summary = await ingest.syncAll();

    expect(summary.messagesIngested).toBe(1);
    const row = await prisma.emailMessage.findFirstOrThrow({ where: { direction: 'INBOUND' } });
    expect(row.subject.length).toBeLessThanOrEqual(500);
  });

  it('two different UIDs sharing the same externalMessageId both persist as separate rows', async () => {
    const customer = await createCustomer();
    const readerFactory = new MockMailboxReaderFactory();
    await bootstrapConfig(readerFactory, mailConfigurationId);
    const ingest = buildIngestService(readerFactory);

    const sharedMessageId = `<${randomUUID()}@example.test>`;
    readerFactory
      .getReaderFor(mailConfigurationId)
      .appendMessage('INBOX', message(1n, { fromAddress: customer.primaryEmail, messageIdHeader: sharedMessageId }));
    readerFactory
      .getReaderFor(mailConfigurationId)
      .appendMessage('INBOX', message(2n, { fromAddress: customer.primaryEmail, messageIdHeader: sharedMessageId }));
    await ingest.syncAll();

    const rows = await prisma.emailMessage.findMany({ where: { externalMessageId: sharedMessageId } });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.imapUid!.toString()))).toEqual(new Set(['1', '2']));
  });

  it('§9/§10 — bootstrap excludes historical mail, and a post-bootstrap message is imported on the next run', async () => {
    const customer = await createCustomer();
    const readerFactory = new MockMailboxReaderFactory();
    readerFactory.getReaderFor(mailConfigurationId).setFolderState('INBOX', 1n, 6n, [
      message(1n, { fromAddress: customer.primaryEmail }),
      message(2n, { fromAddress: customer.primaryEmail }),
      message(3n, { fromAddress: customer.primaryEmail }),
    ]);
    const ingest = buildIngestService(readerFactory);
    const bootstrapSummary = await ingest.syncAll();
    expect(bootstrapSummary.messagesIngested).toBe(0);
    expect(await prisma.emailMessage.count({})).toBe(0);

    const config = await prisma.mailConfiguration.findUniqueOrThrow({ where: { id: mailConfigurationId } });
    expect(config.lastSyncUidValidity).toBe(1n);
    expect(config.lastSyncUid).toBe(5n);

    readerFactory.getReaderFor(mailConfigurationId).appendMessage('INBOX', message(6n, { fromAddress: customer.primaryEmail }));
    const nextSummary = await ingest.syncAll();
    expect(nextSummary.messagesIngested).toBe(1);
    expect(await prisma.emailMessage.count({})).toBe(1);
  });

  it('§11 — UIDVALIDITY mismatch blocks ingestion, records no cursor reset, and emits an UNAVAILABLE health event', async () => {
    const customer = await createCustomer();
    const readerFactory = new MockMailboxReaderFactory();
    await bootstrapConfig(readerFactory, mailConfigurationId);
    const beforeConfig = await prisma.mailConfiguration.findUniqueOrThrow({ where: { id: mailConfigurationId } });

    readerFactory.getReaderFor(mailConfigurationId).changeUidValidity('INBOX', beforeConfig.lastSyncUidValidity! + 1n, 5n);
    readerFactory.getReaderFor(mailConfigurationId).appendMessage('INBOX', message(1n, { fromAddress: customer.primaryEmail }));
    const ingest = buildIngestService(readerFactory);
    const summary = await ingest.syncAll();

    expect(summary.messagesIngested).toBe(0);
    const afterConfig = await prisma.mailConfiguration.findUniqueOrThrow({ where: { id: mailConfigurationId } });
    expect(afterConfig.lastSyncUidValidity).toBe(beforeConfig.lastSyncUidValidity);
    expect(afterConfig.lastSyncUid).toBe(beforeConfig.lastSyncUid);
    const healthEvents = await prisma.integrationHealthEvent.findMany({
      where: { mailConfigurationId, integration: 'IMAP' },
      orderBy: { createdAt: 'desc' },
    });
    expect(healthEvents[0]!.status).toBe('UNAVAILABLE');
    expect(healthEvents[0]!.message).toContain('UIDVALIDITY_CHANGED_REQUIRES_CURSOR_RESET');
  });

  it('BigInt UID/UIDVALIDITY persist and round-trip exactly', async () => {
    const customer = await createCustomer();
    const readerFactory = new MockMailboxReaderFactory();
    readerFactory.getReaderFor(mailConfigurationId).setFolderState('INBOX', 4294967295n, 1n, []);
    const bootstrapIngest = buildIngestService(readerFactory);
    await bootstrapIngest.syncAll();

    readerFactory
      .getReaderFor(mailConfigurationId)
      .appendMessage('INBOX', message(4294967290n, { fromAddress: customer.primaryEmail }));
    await bootstrapIngest.syncAll();

    const row = await prisma.emailMessage.findFirstOrThrow({ where: { direction: 'INBOUND' } });
    expect(row.imapUid).toBe(4294967290n);
    expect(row.imapUidValidity).toBe(4294967295n);
    const config = await prisma.mailConfiguration.findUniqueOrThrow({ where: { id: mailConfigurationId } });
    expect(config.lastSyncUidValidity).toBe(4294967295n);
  });

  // ---------------------------------------------------------------------------------------------
  // §36 — concurrency invariants
  // ---------------------------------------------------------------------------------------------

  it('imapIdentityKey uniqueness under a concurrent race: exactly one EmailMessage, no orphan thread', async () => {
    const customer = await createCustomer();
    const readerFactory = new MockMailboxReaderFactory();
    await bootstrapConfig(readerFactory, mailConfigurationId);
    readerFactory.getReaderFor(mailConfigurationId).appendMessage('INBOX', message(1n, { fromAddress: customer.primaryEmail }));

    const serviceA = buildIngestService(readerFactory);
    const serviceB = buildIngestService(readerFactory);
    await Promise.all([serviceA.syncAll(), serviceB.syncAll()]);

    const rows = await prisma.emailMessage.count({ where: { direction: 'INBOUND' } });
    expect(rows).toBe(1);
    const threads = await prisma.communicationThread.count({ where: { customerId: customer.id } });
    expect(threads).toBe(1);
  });

  it('RenewalCase canonical-thread creation is race-safe: two different UIDs, same case, one thread', async () => {
    const customer = await createCustomer();
    const renewalCase = await createRenewalCase(customer.id);
    const readerFactory = new MockMailboxReaderFactory();
    await bootstrapConfig(readerFactory, mailConfigurationId);
    readerFactory
      .getReaderFor(mailConfigurationId)
      .setFolderState('INBOX', 1n, 3n, [
        message(1n, { fromAddress: customer.primaryEmail, renewalCaseIdHeader: renewalCase.id }),
        message(2n, { fromAddress: customer.primaryEmail, renewalCaseIdHeader: renewalCase.id }),
      ]);

    const serviceA = buildIngestService(readerFactory);
    const serviceB = buildIngestService(readerFactory);
    await Promise.all([serviceA.syncAll(), serviceB.syncAll()]);

    const threads = await prisma.communicationThread.count({ where: { renewalCaseId: renewalCase.id } });
    expect(threads).toBe(1);
    const rows = await prisma.emailMessage.count({ where: { renewalCaseId: renewalCase.id, direction: 'INBOUND' } });
    expect(rows).toBe(2);
  });

  // ---------------------------------------------------------------------------------------------
  // Correction pass — cursor CAS, distributed-safety, and identity-truncation invariants (§1-§3, §6)
  // ---------------------------------------------------------------------------------------------

  it('§2 — concurrent bootstrap CAS: two racing workers establish the baseline exactly once, never corrupted', async () => {
    const readerFactory = new MockMailboxReaderFactory();
    readerFactory.getReaderFor(mailConfigurationId).setFolderState('INBOX', 7n, 42n, []);

    const serviceA = buildIngestService(readerFactory);
    const serviceB = buildIngestService(readerFactory);
    await Promise.all([serviceA.syncAll(), serviceB.syncAll()]);

    const config = await prisma.mailConfiguration.findUniqueOrThrow({ where: { id: mailConfigurationId } });
    expect(config.lastSyncUidValidity).toBe(7n);
    expect(config.lastSyncUid).toBe(41n);

    const baselineEvents = await prisma.auditEvent.count({
      where: { eventKey: 'mail.imap.sync_baseline_established', subjectId: mailConfigurationId },
    });
    expect(baselineEvents).toBe(1); // exactly one winner, never double-established.
  });

  it('§3 — monotonic cursor CAS: a stale/backward-dated compare-and-swap is rejected at the DB level (C=100 cannot become 90)', async () => {
    await prisma.mailConfiguration.update({
      where: { id: mailConfigurationId },
      data: { lastSyncUidValidity: 1n, lastSyncUid: 100n },
    });

    // Simulate exactly what a stale worker's own CAS attempt would issue: the same conditional
    // update the ingest service itself uses, with a deliberately stale expected cursor (90).
    const staleAttempt = await prisma.mailConfiguration.updateMany({
      where: { id: mailConfigurationId, lastSyncUidValidity: 1n, lastSyncUid: 90n },
      data: { lastSyncUid: 91n },
    });
    expect(staleAttempt.count).toBe(0); // rejected — the row no longer matches the stale WHERE.

    const config = await prisma.mailConfiguration.findUniqueOrThrow({ where: { id: mailConfigurationId } });
    expect(config.lastSyncUid).toBe(100n); // unchanged — never moved backward.
  });

  it('§3 — two workers racing to advance the SAME established cursor cannot overwrite each other backward', async () => {
    const customer = await createCustomer();
    const readerFactory = new MockMailboxReaderFactory();
    await bootstrapConfig(readerFactory, mailConfigurationId);
    readerFactory.getReaderFor(mailConfigurationId).setFolderState('INBOX', 1n, 3n, [
      message(1n, { fromAddress: customer.primaryEmail }),
      message(2n, { fromAddress: customer.primaryEmail }),
    ]);

    const serviceA = buildIngestService(readerFactory);
    const serviceB = buildIngestService(readerFactory);
    await Promise.all([serviceA.syncAll(), serviceB.syncAll()]);

    const config = await prisma.mailConfiguration.findUniqueOrThrow({ where: { id: mailConfigurationId } });
    // Whichever worker(s) made progress, the final cursor must be a value that was actually
    // reached (never regressed, never past the last real message) and every inserted UID is unique.
    expect([1n, 2n]).toContain(config.lastSyncUid);
    const rows = await prisma.emailMessage.findMany({ where: { direction: 'INBOUND' }, select: { imapUid: true } });
    const uniqueUids = new Set(rows.map((r) => r.imapUid?.toString()));
    expect(uniqueUids.size).toBe(rows.length); // no duplicate row for the same UID.
  });

  it('§1 — a partial (INCONSISTENT) cursor fails closed: no mailbox connection attempted, no ingestion, health UNAVAILABLE', async () => {
    await prisma.mailConfiguration.update({
      where: { id: mailConfigurationId },
      data: { lastSyncUidValidity: 3n, lastSyncUid: null },
    });
    // Disable the fixture's second mailbox so this run only ever touches the one under test.
    await prisma.mailConfiguration.update({ where: { id: otherMailConfigurationId }, data: { enabled: false } });
    // MockMailboxReaderFactory auto-creates a reader on first request, so the real proof that no
    // connection was ever attempted is that createReader() itself is never called at all.
    const readerFactory = new MockMailboxReaderFactory();
    const createReaderSpy = jest.spyOn(readerFactory, 'createReader');
    const ingest = buildIngestService(readerFactory);

    const summary = await ingest.syncAll();

    expect(summary.configsProcessed).toBe(1);
    expect(summary.messagesIngested).toBe(0);
    const config = await prisma.mailConfiguration.findUniqueOrThrow({ where: { id: mailConfigurationId } });
    expect(config.lastSyncUidValidity).toBe(3n); // untouched.
    expect(config.lastSyncUid).toBeNull(); // untouched — never silently repaired.
    const healthEvents = await prisma.integrationHealthEvent.findMany({
      where: { mailConfigurationId, integration: 'IMAP' },
      orderBy: { createdAt: 'desc' },
    });
    expect(healthEvents[0]!.status).toBe('UNAVAILABLE');
    expect(healthEvents[0]!.message).toContain('IMAP_CURSOR_INCONSISTENT_REQUIRES_REVIEW');
    expect(createReaderSpy).not.toHaveBeenCalled(); // no mailbox connection ever attempted.
  });

  it('§6 — an over-length In-Reply-To sharing a genuine id\'s prefix never produces a false correlation match', async () => {
    const customer = await createCustomer();
    const readerFactory = new MockMailboxReaderFactory();
    await bootstrapConfig(readerFactory, mailConfigurationId);
    const ingest = buildIngestService(readerFactory);

    const sharedPrefix = 'x'.repeat(480);
    const genuineId = `<${sharedPrefix}-real@example.test>`; // fits within VarChar(500).
    const thread = await prisma.communicationThread.create({
      data: { customerId: customer.id, mailConfigurationId, subject: 'Original', status: ThreadStatus.OPEN, lastMessageAt: new Date('2026-01-01T00:00:00Z') },
    });
    await prisma.emailMessage.create({
      data: {
        threadId: thread.id,
        customerId: customer.id,
        direction: 'OUTBOUND',
        channel: 'EMAIL',
        externalMessageId: genuineId,
        subject: 'Original',
        fromAddress: 'no-reply@example.test',
        toAddressesJson: [customer.primaryEmail],
        bodyText: 'hi',
        occurredAt: new Date('2026-01-01T00:00:00Z'),
        mailConfigurationId,
      },
    });

    // Over-length header sharing the exact same prefix, but too long to ever have been the
    // persisted genuineId itself — must never be truncated into a false match against it.
    const overLongInReplyTo = `<${sharedPrefix}-real@example.test-with-a-very-long-suffix-that-pushes-this-well-past-five-hundred-characters-${'y'.repeat(200)}>`;
    readerFactory.getReaderFor(mailConfigurationId).appendMessage(
      'INBOX',
      message(1n, { fromAddress: customer.primaryEmail, inReplyToHeader: overLongInReplyTo }),
    );
    await ingest.syncAll();

    const row = await prisma.emailMessage.findFirstOrThrow({ where: { direction: 'INBOUND' } });
    expect(row.threadId).not.toBe(thread.id); // never falsely attached to the genuine thread.
    expect(row.inReplyTo).toBeNull(); // never a truncated/invented identity persisted.
    const originalThreadMessages = await prisma.emailMessage.count({ where: { threadId: thread.id } });
    expect(originalThreadMessages).toBe(1); // only the original outbound row — no false attach.
  });

  it('§7/§8 — a very large References header and a large multi-byte body both persist within real MariaDB TEXT capacity', async () => {
    const customer = await createCustomer();
    const readerFactory = new MockMailboxReaderFactory();
    await bootstrapConfig(readerFactory, mailConfigurationId);
    const ingest = buildIngestService(readerFactory);

    const manyReferences = Array.from({ length: 2000 }, (_, i) => `<ref${i}@example.test>`).join(' ');
    const largeArabicBody = 'مرحبا بالعالم '.repeat(20_000); // well beyond the 65,535-byte TEXT max.

    readerFactory.getReaderFor(mailConfigurationId).appendMessage(
      'INBOX',
      message(1n, { fromAddress: customer.primaryEmail, referencesHeader: manyReferences, text: largeArabicBody }),
    );
    const summary = await ingest.syncAll();

    expect(summary.messagesIngested).toBe(1); // insert succeeded — never rejected by the DB.
    const row = await prisma.emailMessage.findFirstOrThrow({ where: { direction: 'INBOUND' } });
    expect(Buffer.byteLength(row.references ?? '', 'utf8')).toBeLessThanOrEqual(65_535);
    expect(Buffer.byteLength(row.bodyText, 'utf8')).toBeLessThanOrEqual(65_535);
    // Never truncated mid-token: every space-separated piece of the stored references is a
    // complete, validly-formed "<...>" token.
    for (const token of (row.references ?? '').split(' ').filter(Boolean)) {
      expect(token).toMatch(/^<[^<>\s]+@[^<>\s]+>$/);
    }
  });

  // ---------------------------------------------------------------------------------------------
  // Protocol-correctness pass — exact Message-ID matching despite utf8mb4_unicode_ci collation (§3)
  // ---------------------------------------------------------------------------------------------

  it('confirms the DB collation itself IS case-insensitive — a raw query over-matches without the app-level exact filter', async () => {
    const customer = await createCustomer();
    const threadA = await prisma.communicationThread.create({
      data: { customerId: customer.id, mailConfigurationId, subject: 'A', status: ThreadStatus.OPEN, lastMessageAt: new Date() },
    });
    await prisma.emailMessage.create({
      data: {
        threadId: threadA.id,
        direction: 'OUTBOUND',
        channel: 'EMAIL',
        externalMessageId: '<Case@Test.example>',
        subject: 'A',
        fromAddress: 'no-reply@example.test',
        toAddressesJson: [customer.primaryEmail],
        bodyText: 'hi',
        occurredAt: new Date(),
        mailConfigurationId,
      },
    });

    // A raw query for the differently-cased value demonstrates the collation's own behavior —
    // this is the exact superset mail-inbound-correlation.service.ts must never trust blindly.
    const rawMatches = await prisma.emailMessage.findMany({
      where: { mailConfigurationId, externalMessageId: { in: ['<case@test.example>'] } },
    });
    expect(rawMatches).toHaveLength(1); // proves the collation is case-insensitive at the DB layer.
    expect(rawMatches[0]!.externalMessageId).toBe('<Case@Test.example>'); // different case, still "matched" by MariaDB.
  });

  it('A — a case-exact In-Reply-To matches only the thread with the exact-case stored id, never the differently-cased one', async () => {
    const customer = await createCustomer();
    const readerFactory = new MockMailboxReaderFactory();
    await bootstrapConfig(readerFactory, mailConfigurationId);
    const ingest = buildIngestService(readerFactory);

    const threadA = await prisma.communicationThread.create({
      data: { customerId: customer.id, mailConfigurationId, subject: 'A', status: ThreadStatus.OPEN, lastMessageAt: new Date() },
    });
    const threadB = await prisma.communicationThread.create({
      data: { customerId: customer.id, mailConfigurationId, subject: 'B', status: ThreadStatus.OPEN, lastMessageAt: new Date() },
    });
    await prisma.emailMessage.create({
      data: {
        threadId: threadA.id,
        direction: 'OUTBOUND',
        channel: 'EMAIL',
        externalMessageId: '<Case@Test.example>',
        subject: 'A',
        fromAddress: 'no-reply@example.test',
        toAddressesJson: [customer.primaryEmail],
        bodyText: 'hi',
        occurredAt: new Date(),
        mailConfigurationId,
      },
    });
    await prisma.emailMessage.create({
      data: {
        threadId: threadB.id,
        direction: 'OUTBOUND',
        channel: 'EMAIL',
        externalMessageId: '<case@Test.example>',
        subject: 'B',
        fromAddress: 'no-reply@example.test',
        toAddressesJson: [customer.primaryEmail],
        bodyText: 'hi',
        occurredAt: new Date(),
        mailConfigurationId,
      },
    });

    readerFactory.getReaderFor(mailConfigurationId).appendMessage(
      'INBOX',
      message(1n, { fromAddress: customer.primaryEmail, inReplyToHeader: '<Case@Test.example>' }),
    );
    await ingest.syncAll();

    const row = await prisma.emailMessage.findFirstOrThrow({ where: { direction: 'INBOUND' } });
    expect(row.threadId).toBe(threadA.id); // ONLY the exact-case match, never threadB.
    expect(row.classificationStatus).toBe(ClassificationStatus.PENDING); // unambiguous.
  });

  it('B — an In-Reply-To that only case-differs from a stored id produces NO Message-ID correlation match', async () => {
    const customer = await createCustomer();
    const readerFactory = new MockMailboxReaderFactory();
    await bootstrapConfig(readerFactory, mailConfigurationId);
    const ingest = buildIngestService(readerFactory);

    const thread = await prisma.communicationThread.create({
      data: { customerId: customer.id, mailConfigurationId, subject: 'Original', status: ThreadStatus.OPEN, lastMessageAt: new Date() },
    });
    await prisma.emailMessage.create({
      data: {
        threadId: thread.id,
        direction: 'OUTBOUND',
        channel: 'EMAIL',
        externalMessageId: '<case@Test.example>',
        subject: 'Original',
        fromAddress: 'no-reply@example.test',
        toAddressesJson: [customer.primaryEmail],
        bodyText: 'hi',
        occurredAt: new Date(),
        mailConfigurationId,
      },
    });

    readerFactory.getReaderFor(mailConfigurationId).appendMessage(
      'INBOX',
      message(1n, { fromAddress: customer.primaryEmail, inReplyToHeader: '<Case@Test.example>' }),
    );
    await ingest.syncAll();

    const row = await prisma.emailMessage.findFirstOrThrow({ where: { direction: 'INBOUND' } });
    // No header-based match found -> falls through to sender attribution (§18), landing on a NEW
    // thread for this known, active customer — never silently reused via a case-insensitive match.
    expect(row.threadId).not.toBe(thread.id);
    expect(row.classificationStatus).toBe(ClassificationStatus.PENDING);
  });

  it('C — the exact same Message-ID duplicated twice on the SAME thread remains an unambiguous match', async () => {
    const customer = await createCustomer();
    const readerFactory = new MockMailboxReaderFactory();
    await bootstrapConfig(readerFactory, mailConfigurationId);
    const ingest = buildIngestService(readerFactory);

    const thread = await prisma.communicationThread.create({
      data: { customerId: customer.id, mailConfigurationId, subject: 'Original', status: ThreadStatus.OPEN, lastMessageAt: new Date() },
    });
    const sharedId = '<Repeated@Test.example>';
    for (let i = 0; i < 2; i++) {
      await prisma.emailMessage.create({
        data: {
          threadId: thread.id,
          direction: 'OUTBOUND',
          channel: 'EMAIL',
          externalMessageId: sharedId,
          subject: 'Original',
          fromAddress: 'no-reply@example.test',
          toAddressesJson: [customer.primaryEmail],
          bodyText: `hi ${i}`,
          occurredAt: new Date(),
          mailConfigurationId,
        },
      });
    }

    readerFactory.getReaderFor(mailConfigurationId).appendMessage(
      'INBOX',
      message(1n, { fromAddress: customer.primaryEmail, inReplyToHeader: sharedId }),
    );
    await ingest.syncAll();

    const row = await prisma.emailMessage.findFirstOrThrow({ where: { direction: 'INBOUND' } });
    expect(row.threadId).toBe(thread.id);
    expect(row.classificationStatus).toBe(ClassificationStatus.PENDING); // still unambiguous.
  });

  it('D — the exact same Message-ID duplicated across DIFFERENT threads remains ambiguous -> HUMAN_REVIEW', async () => {
    const customer = await createCustomer();
    const readerFactory = new MockMailboxReaderFactory();
    await bootstrapConfig(readerFactory, mailConfigurationId);
    const ingest = buildIngestService(readerFactory);

    const sharedId = '<Duplicated@Test.example>';
    const threadA = await prisma.communicationThread.create({
      data: { customerId: customer.id, mailConfigurationId, subject: 'A', status: ThreadStatus.OPEN, lastMessageAt: new Date() },
    });
    const threadB = await prisma.communicationThread.create({
      data: { customerId: customer.id, mailConfigurationId, subject: 'B', status: ThreadStatus.OPEN, lastMessageAt: new Date() },
    });
    for (const t of [threadA, threadB]) {
      await prisma.emailMessage.create({
        data: {
          threadId: t.id,
          direction: 'OUTBOUND',
          channel: 'EMAIL',
          externalMessageId: sharedId,
          subject: t.subject,
          fromAddress: 'no-reply@example.test',
          toAddressesJson: [customer.primaryEmail],
          bodyText: 'hi',
          occurredAt: new Date(),
          mailConfigurationId,
        },
      });
    }

    readerFactory.getReaderFor(mailConfigurationId).appendMessage(
      'INBOX',
      message(1n, { fromAddress: customer.primaryEmail, inReplyToHeader: sharedId }),
    );
    await ingest.syncAll();

    const row = await prisma.emailMessage.findFirstOrThrow({ where: { direction: 'INBOUND' } });
    expect(row.classificationStatus).toBe(ClassificationStatus.HUMAN_REVIEW);
    expect(row.threadId).not.toBe(threadA.id);
    expect(row.threadId).not.toBe(threadB.id);
  });

  // ---------------------------------------------------------------------------------------------
  // Protocol-correctness pass — fetch-time UIDVALIDITY check closes the check-then-fetch TOCTOU (§2)
  // ---------------------------------------------------------------------------------------------

  it('a UIDVALIDITY change discovered inside fetchMessagesSince itself (not a separate pre-check) still fails closed with zero ingestion', async () => {
    const customer = await createCustomer();
    const readerFactory = new MockMailboxReaderFactory();
    await bootstrapConfig(readerFactory, mailConfigurationId);
    const beforeConfig = await prisma.mailConfiguration.findUniqueOrThrow({ where: { id: mailConfigurationId } });

    // Simulate the mailbox's identity changing between "what the ingest service believes" and
    // "what the reader now observes at fetch time" — MockMailboxReader's fetchMessagesSince
    // performs its own fresh check (mirroring the real reader's same-selection check), so this
    // exercises the exact TOCTOU-closing code path, not a separately-timed pre-check.
    readerFactory
      .getReaderFor(mailConfigurationId)
      .changeUidValidity('INBOX', beforeConfig.lastSyncUidValidity! + 1n, 5n);
    readerFactory.getReaderFor(mailConfigurationId).appendMessage('INBOX', message(1n, { fromAddress: customer.primaryEmail }));

    const ingest = buildIngestService(readerFactory);
    const summary = await ingest.syncAll();

    expect(summary.messagesIngested).toBe(0);
    expect(await prisma.emailMessage.count({})).toBe(0);
    const afterConfig = await prisma.mailConfiguration.findUniqueOrThrow({ where: { id: mailConfigurationId } });
    expect(afterConfig.lastSyncUidValidity).toBe(beforeConfig.lastSyncUidValidity); // untouched.
    expect(afterConfig.lastSyncUid).toBe(beforeConfig.lastSyncUid); // untouched, no auto-reset.
    const healthEvents = await prisma.integrationHealthEvent.findMany({
      where: { mailConfigurationId, integration: 'IMAP' },
      orderBy: { createdAt: 'desc' },
    });
    expect(healthEvents[0]!.status).toBe('UNAVAILABLE');
    expect(healthEvents[0]!.message).toContain('UIDVALIDITY_CHANGED_REQUIRES_CURSOR_RESET');
  });
});
