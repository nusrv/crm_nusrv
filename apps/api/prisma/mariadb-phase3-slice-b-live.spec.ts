import { randomUUID } from 'node:crypto';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import mariadb, { type Connection } from 'mariadb';
import { toMariaDbDriverUrl } from '../src/database/mariadb-url';
import { AuditService } from '../src/audit/audit.service';
import { BusinessTimeService } from '../src/time/business-time.service';
import { ClockService } from '../src/time/clock.service';
import { PrismaClient } from '../src/generated/prisma/client';
import type { MailConfiguration } from '../src/generated/prisma/client';
import {
  BillingFrequency,
  CommunicationOutboxStatus,
  CustomerStatus,
  IntegrationEnvironment,
  PaymentScope,
  ReminderAudience,
  RenewalCaseStatus,
  SubscriptionStatus,
} from '../src/generated/prisma/enums';
import { CustomerEmailResolutionService } from '../src/modules/customers/customer-email-resolution.service';
import { MailConfigurationResolverService } from '../src/modules/mail/mail-configuration-resolver.service';
import { MailHealthService } from '../src/modules/mail/mail-health.service';
import { MailOutboundService } from '../src/modules/mail/mail-outbound.service';
import { MailThreadResolutionService } from '../src/modules/mail/mail-thread-resolution.service';
import type { MailTransport, PreparedOutboundMessage } from '../src/modules/mail/mail-transport';
import { MockMailTransport } from '../src/modules/mail/mock-mail-transport';
import { RenewalEngineService } from '../src/modules/renewal-cases/renewal-engine.service';
import { RenewalTemplateRenderer } from '../src/modules/renewal-cases/renewal-template.renderer';
import { readAllMigrationsSql } from './read-all-migrations';

// Live-DB verification of the Slice B invariants a hand-rolled Prisma fake cannot actually prove:
// real unique-index enforcement under concurrency (CAS claim, one thread per RenewalCase) and real
// unique-index enforcement of the missed-milestone idempotency key. Business-rule branching itself
// is already exhaustively covered by mail-outbound.service.spec.ts and renewal-engine-recovery.spec.ts
// against an in-memory fake; this file exists only for what a fake cannot prove.
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

/** Rejects on its first call only, then delegates to a MockMailTransport — proves retry identity
 * persistence (same EmailMessage/Message-ID reused) across a genuine transient-failure-then-retry
 * cycle without any network I/O. */
class FlakyThenMockTransport implements MailTransport {
  private failuresRemaining: number;
  readonly inner = new MockMailTransport();

  constructor(failuresRemaining: number) {
    this.failuresRemaining = failuresRemaining;
  }

  async send(message: PreparedOutboundMessage, config: MailConfiguration): Promise<void> {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error('Simulated transient SMTP failure');
    }
    await this.inner.send(message, config);
  }
}

function fakeConfigService(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    MAIL_SEND_ENABLED: 'true',
    MAIL_SEND_CUTOVER_AT: '2020-01-01T00:00:00.000Z',
    NODE_ENV: 'test',
    ...overrides,
  };
  return { get: (key: string) => values[key] };
}

liveDescribe('Phase 3 Slice B MariaDB outbound-mail integration', () => {
  let connection: Connection;
  let prisma: PrismaClient;
  let billingEntityId: string;
  let serviceTypeId: string;

  beforeAll(async () => {
    const url = databaseUrl as string;
    connection = await mariadb.createConnection(options(url));
    await reset(connection);
    await connection.query(migrations);
    prisma = new PrismaClient({ adapter: new PrismaMariaDb(toMariaDbDriverUrl(url)) });

    const billingEntity = await prisma.billingEntity.create({
      data: {
        code: `S3B-${randomUUID()}`,
        customerCodePrefix: `S${randomUUID().slice(0, 3).toUpperCase()}`,
        name: 'Slice B Entity',
        legalName: 'Slice B Entity',
        paymentScope: PaymentScope.LOCAL,
      },
    });
    billingEntityId = billingEntity.id;

    // GLOBAL configuration only needs to exist for MailConfigurationResolverService to find it —
    // no test needs its id directly.
    await prisma.mailConfiguration.create({
      data: {
        scopeKey: 'GLOBAL',
        label: 'Global mailbox',
        smtpHost: 'smtp.example.test',
        smtpPort: 587,
        smtpUsername: 'no-reply@example.test',
        imapHost: 'imap.example.test',
        imapPort: 993,
        imapUsername: 'no-reply@example.test',
        fromAddress: 'no-reply@example.test',
        fromName: 'Slice B',
        environment: IntegrationEnvironment.SANDBOX,
        enabled: true,
        outboundSendEnabled: true,
        outboundSendCutoverAt: new Date('2020-01-01T00:00:00.000Z'),
      },
    });

    const serviceType = await prisma.serviceType.create({
      data: { code: `S3B-ST-${randomUUID()}`, name: 'Slice B Hosting' },
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

  async function createFixtureCase() {
    const customer = await prisma.customer.create({
      data: {
        billingEntityId,
        customerCode: `S3B-C-${randomUUID()}`,
        nameEn: 'Slice B Customer',
        primaryEmail: `${randomUUID()}@example.test`,
        status: CustomerStatus.ACTIVE,
      },
    });
    const subscription = await prisma.subscription.create({
      data: {
        customerId: customer.id,
        serviceTypeId,
        subscriptionCode: `S3B-SUB-${randomUUID()}`,
        name: 'Slice B Subscription',
        startDate: new Date('2020-01-01T00:00:00Z'),
        renewalDate: new Date('2027-01-01T00:00:00Z'),
        billingFrequency: BillingFrequency.ANNUAL,
        sellingPrice: '100.000',
        currency: 'JOD',
        status: SubscriptionStatus.ACTIVE,
      },
    });
    const renewalCase = await prisma.renewalCase.create({
      data: {
        subscriptionId: subscription.id,
        cycleStartDate: new Date('2026-01-01T00:00:00Z'),
        dueDate: subscription.renewalDate,
        status: RenewalCaseStatus.REMINDER_CYCLE,
      },
    });
    return { customer, subscription, renewalCase };
  }

  async function createQueuedOutbox(params: {
    customerId: string;
    subscriptionId: string;
    renewalCaseId: string;
    recipient: string;
  }) {
    const auditEvent = await prisma.auditEvent.create({
      data: {
        actorType: 'SYSTEM',
        eventKey: 'test.outbox.created',
        subjectType: 'RenewalCase',
        subjectId: params.renewalCaseId,
      },
    });
    return prisma.communicationOutbox.create({
      data: {
        customerId: params.customerId,
        subscriptionId: params.subscriptionId,
        renewalCaseId: params.renewalCaseId,
        auditEventId: auditEvent.id,
        audience: ReminderAudience.CUSTOMER,
        recipient: params.recipient,
        subject: 'Renewal reminder',
        body: 'Please renew.',
        daysBeforeDue: 14,
        status: CommunicationOutboxStatus.QUEUED,
        scheduledAt: new Date('2026-01-01T00:00:00Z'),
        idempotencyKey: `test:${randomUUID()}`,
      },
    });
  }

  function buildOutboundService(transport: MailTransport) {
    return new MailOutboundService(
      prisma as never,
      new AuditService(prisma as never),
      { now: () => new Date() },
      new MailConfigurationResolverService(prisma as never, fakeConfigService() as never, new ClockService()),
      new MailThreadResolutionService(prisma as never),
      new MailHealthService(prisma as never),
      new CustomerEmailResolutionService(prisma as never),
      transport,
    );
  }

  it('claims a row atomically under concurrency: exactly one of two racing workers sends it', async () => {
    const { customer, subscription, renewalCase } = await createFixtureCase();
    const outbox = await createQueuedOutbox({
      customerId: customer.id,
      subscriptionId: subscription.id,
      renewalCaseId: renewalCase.id,
      recipient: customer.primaryEmail,
    });
    const transport = new MockMailTransport();
    const serviceA = buildOutboundService(transport);
    const serviceB = buildOutboundService(transport);

    const [outcomeA, outcomeB] = await Promise.all([
      serviceA.processOne(outbox.id),
      serviceB.processOne(outbox.id),
    ]);

    const outcomes = [outcomeA, outcomeB].sort();
    expect(outcomes).toEqual(['not_claimed', 'sent'].sort());
    expect(transport.sent).toHaveLength(1);
    const final = await prisma.communicationOutbox.findUniqueOrThrow({ where: { id: outbox.id } });
    expect(final.status).toBe(CommunicationOutboxStatus.DELIVERED);
  });

  it('resolves to exactly one CommunicationThread per RenewalCase under concurrent materialization', async () => {
    const { customer, subscription, renewalCase } = await createFixtureCase();
    const outboxOne = await createQueuedOutbox({
      customerId: customer.id,
      subscriptionId: subscription.id,
      renewalCaseId: renewalCase.id,
      recipient: customer.primaryEmail,
    });
    const outboxTwo = await createQueuedOutbox({
      customerId: customer.id,
      subscriptionId: subscription.id,
      renewalCaseId: renewalCase.id,
      recipient: customer.primaryEmail,
    });
    const transport = new MockMailTransport();
    const serviceA = buildOutboundService(transport);
    const serviceB = buildOutboundService(transport);

    const [outcomeOne, outcomeTwo] = await Promise.all([
      serviceA.processOne(outboxOne.id),
      serviceB.processOne(outboxTwo.id),
    ]);

    expect(outcomeOne).toBe('sent');
    expect(outcomeTwo).toBe('sent');
    const threads = await prisma.communicationThread.findMany({ where: { renewalCaseId: renewalCase.id } });
    expect(threads).toHaveLength(1);
    const [rowOne, rowTwo] = await Promise.all([
      prisma.communicationOutbox.findUniqueOrThrow({ where: { id: outboxOne.id } }),
      prisma.communicationOutbox.findUniqueOrThrow({ where: { id: outboxTwo.id } }),
    ]);
    expect(rowOne.emailMessageId).not.toBeNull();
    expect(rowTwo.emailMessageId).not.toBeNull();
    expect(rowOne.emailMessageId).not.toBe(rowTwo.emailMessageId);
    const [messageOne, messageTwo] = await Promise.all([
      prisma.emailMessage.findUniqueOrThrow({ where: { id: rowOne.emailMessageId! } }),
      prisma.emailMessage.findUniqueOrThrow({ where: { id: rowTwo.emailMessageId! } }),
    ]);
    expect(messageOne.threadId).toBe(threads[0]!.id);
    expect(messageTwo.threadId).toBe(threads[0]!.id);
  });

  it('reuses the same EmailMessage and Message-ID across a transient-failure-then-retry cycle', async () => {
    const { customer, subscription, renewalCase } = await createFixtureCase();
    const outbox = await createQueuedOutbox({
      customerId: customer.id,
      subscriptionId: subscription.id,
      renewalCaseId: renewalCase.id,
      recipient: customer.primaryEmail,
    });
    const flaky = new FlakyThenMockTransport(1);
    const service = buildOutboundService(flaky);

    const firstOutcome = await service.processOne(outbox.id);
    expect(firstOutcome).toBe('failed');
    const afterFirst = await prisma.communicationOutbox.findUniqueOrThrow({ where: { id: outbox.id } });
    expect(afterFirst.status).toBe(CommunicationOutboxStatus.QUEUED);
    expect(afterFirst.attempts).toBe(1);
    expect(afterFirst.emailMessageId).not.toBeNull();
    const messageIdAfterFirst = afterFirst.messageIdHeader;

    const secondOutcome = await service.processOne(outbox.id);
    expect(secondOutcome).toBe('sent');
    const afterSecond = await prisma.communicationOutbox.findUniqueOrThrow({ where: { id: outbox.id } });
    expect(afterSecond.status).toBe(CommunicationOutboxStatus.DELIVERED);
    expect(afterSecond.emailMessageId).toBe(afterFirst.emailMessageId);
    expect(afterSecond.messageIdHeader).toBe(messageIdAfterFirst);
    const emailMessages = await prisma.emailMessage.findMany({
      where: { renewalCaseId: renewalCase.id },
    });
    expect(emailMessages).toHaveLength(1);
    expect(emailMessages[0]!.externalMessageId).toBe(messageIdAfterFirst);
  });

  it('enforces missed-milestone idempotency at the database level across two real engine runs', async () => {
    const { customer, subscription, renewalCase } = await createFixtureCase();
    void renewalCase;
    const template = await prisma.renewalTemplate.create({
      data: {
        code: `S3B-TPL-${randomUUID()}`,
        name: 'Slice B Template',
        subjectTemplate: 'Renewal for {{subscriptionName}}',
        bodyTemplate: 'Hi {{customerCompany}}',
      },
    });
    await prisma.reminderRule.create({
      data: { code: `S3B-RULE-${randomUUID()}`, name: 'D-14', daysBeforeDue: 14, templateId: template.id },
    });

    const businessTime = new BusinessTimeService({ getOrThrow: () => 'Asia/Amman' } as never);
    // The subscription's renewalDate is fixed at fixture-creation time; pick an "asOf" that reads
    // as D-12 relative to it (a missed D-21 and D-14 scenario resuming at D-12) so the engine must
    // select D-14, and run it twice to prove the real idempotency_key unique index — not just the
    // in-memory fake used by renewal-engine-recovery.spec.ts — prevents a second row.
    const asOf = businessTime.addBusinessDays(new Date(), -1);
    asOf.setUTCFullYear(subscription.renewalDate.getUTCFullYear());
    asOf.setUTCMonth(subscription.renewalDate.getUTCMonth());
    asOf.setUTCDate(subscription.renewalDate.getUTCDate() - 12);

    const engine = new RenewalEngineService(
      prisma as never,
      new AuditService(prisma as never),
      businessTime,
      { now: () => asOf },
      new RenewalTemplateRenderer(),
      new CustomerEmailResolutionService(prisma as never),
    );

    await engine.evaluateAll({ asOf, trigger: 'test' });
    await engine.evaluateAll({ asOf, trigger: 'test' });

    const outboxRows = await prisma.communicationOutbox.findMany({
      where: { subscriptionId: subscription.id, audience: ReminderAudience.CUSTOMER },
    });
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]!.daysBeforeDue).toBe(14);
    void customer;
  });

  describe('claim predicate — fresh QUEUED vs. stale-PROCESSING reclaim vs. cutover', () => {
    it('E — claims a fresh QUEUED row with lastAttemptAt = NULL: the lease token round-trips through real MariaDB DATETIME precision and every guarded write (materialize-link, attempt increment, DELIVERED) succeeds using it', async () => {
      const { customer, subscription, renewalCase } = await createFixtureCase();
      const outbox = await createQueuedOutbox({
        customerId: customer.id,
        subscriptionId: subscription.id,
        renewalCaseId: renewalCase.id,
        recipient: customer.primaryEmail,
      });
      expect(outbox.lastAttemptAt).toBeNull();
      const service = buildOutboundService(new MockMailTransport());

      const outcome = await service.processOne(outbox.id);

      // 'sent' is only reachable if claim()'s re-read of lastAttemptAt exactly matched what every
      // subsequent guarded updateMany() compared against, all the way through to the DELIVERED
      // write — i.e. the lease token genuinely round-tripped through MariaDB's actual DATETIME
      // column precision without this test needing to know or assume what that precision is.
      expect(outcome).toBe('sent');
      const final = await prisma.communicationOutbox.findUniqueOrThrow({ where: { id: outbox.id } });
      expect(final.status).toBe(CommunicationOutboxStatus.DELIVERED);
      expect(final.attempts).toBe(1);
      expect(final.lastAttemptAt).not.toBeNull();
    });

    it('does not claim a row currently PROCESSING within the stale-lease window', async () => {
      const { customer, subscription, renewalCase } = await createFixtureCase();
      const outbox = await createQueuedOutbox({
        customerId: customer.id,
        subscriptionId: subscription.id,
        renewalCaseId: renewalCase.id,
        recipient: customer.primaryEmail,
      });
      await prisma.communicationOutbox.update({
        where: { id: outbox.id },
        data: { status: CommunicationOutboxStatus.PROCESSING, lastAttemptAt: new Date() },
      });
      const service = buildOutboundService(new MockMailTransport());

      const outcome = await service.processOne(outbox.id);

      expect(outcome).toBe('not_claimed');
    });

    it('F — reclaims a row stuck PROCESSING past the stale-lease window (crash recovery): the old token becomes invalid and a genuinely new one is issued and used throughout', async () => {
      const { customer, subscription, renewalCase } = await createFixtureCase();
      const outbox = await createQueuedOutbox({
        customerId: customer.id,
        subscriptionId: subscription.id,
        renewalCaseId: renewalCase.id,
        recipient: customer.primaryEmail,
      });
      const staleLastAttempt = new Date(Date.now() - 11 * 60 * 1000); // > 10-minute lease
      await prisma.communicationOutbox.update({
        where: { id: outbox.id },
        data: { status: CommunicationOutboxStatus.PROCESSING, lastAttemptAt: staleLastAttempt },
      });
      const service = buildOutboundService(new MockMailTransport());

      const outcome = await service.processOne(outbox.id);

      expect(outcome).toBe('sent');
      const final = await prisma.communicationOutbox.findUniqueOrThrow({ where: { id: outbox.id } });
      expect(final.status).toBe(CommunicationOutboxStatus.DELIVERED);
      // A genuinely new lease token was issued at reclaim time and used consistently through every
      // subsequent guarded write — the stale one from the "crashed" worker is nowhere in this row
      // anymore.
      expect(final.lastAttemptAt).not.toBeNull();
      expect(final.lastAttemptAt!.getTime()).not.toBe(staleLastAttempt.getTime());
      expect(final.lastAttemptAt!.getTime()).toBeGreaterThan(staleLastAttempt.getTime());
    });

    it('the ownership-guard conditional write itself rejects a stale lastAttemptAt and accepts the current one, verified directly against MariaDB', async () => {
      const { customer, subscription, renewalCase } = await createFixtureCase();
      const outbox = await createQueuedOutbox({
        customerId: customer.id,
        subscriptionId: subscription.id,
        renewalCaseId: renewalCase.id,
        recipient: customer.primaryEmail,
      });
      const service = buildOutboundService(new MockMailTransport());
      // Fail transiently on the first attempt so the row returns to QUEUED with attempts=1, while
      // its lastAttemptAt (the lease token from that first claim) is left untouched — exactly the
      // "worker A's old token" state a genuine mid-flight reclaim race would leave behind.
      const flaky = new FlakyThenMockTransport(1);
      const flakyService = buildOutboundService(flaky);
      const firstOutcome = await flakyService.processOne(outbox.id);
      expect(firstOutcome).toBe('failed');
      const afterFirst = await prisma.communicationOutbox.findUniqueOrThrow({ where: { id: outbox.id } });
      expect(afterFirst.status).toBe(CommunicationOutboxStatus.QUEUED);
      const staleToken = afterFirst.lastAttemptAt!;

      // Force a real elapsed-time gap comfortably larger than any DATETIME column precision this
      // schema could plausibly use (whole-second truncation included), so the two tokens are
      // GUARANTEED to differ regardless of what that precision actually is — this is the "account
      // for it explicitly" the precision concern calls for, rather than assuming millisecond
      // precision and hoping two rapid sequential claims happen to land in different instants.
      await new Promise((resolve) => setTimeout(resolve, 1200));

      // A second worker now genuinely reclaims the row (a real claim through the same production
      // code path — status QUEUED requires no staleness at all), receiving a NEW token.
      const secondOutcome = await service.processOne(outbox.id);
      expect(secondOutcome).toBe('sent');
      const afterSecond = await prisma.communicationOutbox.findUniqueOrThrow({ where: { id: outbox.id } });
      expect(afterSecond.status).toBe(CommunicationOutboxStatus.DELIVERED);
      const currentToken = afterSecond.lastAttemptAt!;
      // Precondition for the rest of this test to actually prove anything: confirm the tokens
      // really are distinct (see the explicit delay above) before relying on that to test the
      // guard's discriminating power.
      expect(currentToken.getTime()).not.toBe(staleToken.getTime());

      // Directly against MariaDB: the exact conditional-write shape every guarded mutation in
      // MailOutboundService uses. The stale token (worker A's) must be rejected; the current token
      // (whatever the row now actually holds) must be accepted. This is the literal SQL-level CAS
      // predicate, proven independently of any particular service call's internal timing.
      const rejectedByStaleToken = await prisma.communicationOutbox.updateMany({
        where: { id: outbox.id, status: CommunicationOutboxStatus.DELIVERED, lastAttemptAt: staleToken },
        data: { lastError: 'should never be written' },
      });
      expect(rejectedByStaleToken.count).toBe(0);

      const acceptedByCurrentToken = await prisma.communicationOutbox.updateMany({
        where: { id: outbox.id, status: CommunicationOutboxStatus.DELIVERED, lastAttemptAt: currentToken },
        data: { lastError: null },
      });
      expect(acceptedByCurrentToken.count).toBe(1);
    });

    it('Phase 3.1 §2A/§2B correction — a historical row (created long ago) is still claimable; only the per-mailbox DB outboundSendCutoverAt (already reached in this fixture) gates eligibility, never a global createdAt/env cutover at claim time', async () => {
      const { customer, subscription, renewalCase } = await createFixtureCase();
      const outbox = await createQueuedOutbox({
        customerId: customer.id,
        subscriptionId: subscription.id,
        renewalCaseId: renewalCase.id,
        recipient: customer.primaryEmail,
      });
      await prisma.communicationOutbox.update({
        where: { id: outbox.id },
        data: { createdAt: new Date('2019-01-01T00:00:00.000Z') },
      });
      const service = buildOutboundService(new MockMailTransport());

      const outcome = await service.processOne(outbox.id);

      expect(outcome).toBe('sent');
      const updated = await prisma.communicationOutbox.findUniqueOrThrow({ where: { id: outbox.id } });
      expect(updated.status).toBe(CommunicationOutboxStatus.DELIVERED);
    });
  });

  describe('MailConfiguration/thread pinning under real BillingEntity override creation', () => {
    it('stays pinned to the original (GLOBAL) configuration after a new enabled BillingEntity override appears mid-retry', async () => {
      const { customer, subscription, renewalCase } = await createFixtureCase();
      const outbox = await createQueuedOutbox({
        customerId: customer.id,
        subscriptionId: subscription.id,
        renewalCaseId: renewalCase.id,
        recipient: customer.primaryEmail,
      });
      const flaky = new FlakyThenMockTransport(1);
      const service = buildOutboundService(flaky);

      const firstOutcome = await service.processOne(outbox.id);
      expect(firstOutcome).toBe('failed');
      const afterFirst = await prisma.communicationOutbox.findUniqueOrThrow({ where: { id: outbox.id } });
      const thread = await prisma.communicationThread.findUniqueOrThrow({
        where: { renewalCaseId: renewalCase.id },
      });
      expect(thread.mailConfigurationId).not.toBeNull();
      const originalConfigId = thread.mailConfigurationId;

      // A BillingEntity-specific override now appears and is enabled — a real DB row, not a mock.
      await prisma.mailConfiguration.create({
        data: {
          billingEntityId,
          scopeKey: `BILLING_ENTITY:${billingEntityId}`,
          label: 'New override mailbox',
          smtpHost: 'smtp-override.example.test',
          smtpPort: 587,
          smtpUsername: 'override@example.test',
          imapHost: 'imap-override.example.test',
          imapPort: 993,
          imapUsername: 'override@example.test',
          fromAddress: 'override@example.test',
          fromName: 'Override',
          environment: IntegrationEnvironment.SANDBOX,
          enabled: true,
          outboundSendEnabled: true,
          outboundSendCutoverAt: new Date('2020-01-01T00:00:00.000Z'),
        },
      });

      const secondOutcome = await service.processOne(outbox.id);

      expect(secondOutcome).toBe('sent');
      expect(flaky.inner.sent).toHaveLength(1);
      expect(flaky.inner.sent[0]!.fromAddress).toBe('no-reply@example.test'); // the original GLOBAL config, not the override
      const finalEmailMessage = await prisma.emailMessage.findUniqueOrThrow({
        where: { id: afterFirst.emailMessageId! },
      });
      expect(finalEmailMessage.mailConfigurationId).toBe(originalConfigId);
      const finalThread = await prisma.communicationThread.findUniqueOrThrow({
        where: { renewalCaseId: renewalCase.id },
      });
      expect(finalThread.mailConfigurationId).toBe(originalConfigId);
    });
  });

  describe('no-recipient defer then later send', () => {
    it('defers with no recipient, then sends exactly once after staff add a valid primary email', async () => {
      const { customer, subscription, renewalCase } = await createFixtureCase();
      // Remove the only signal CustomerEmailResolutionService has — the legacy scalar.
      await prisma.customer.update({ where: { id: customer.id }, data: { primaryEmail: '' } });
      const outbox = await createQueuedOutbox({
        customerId: customer.id,
        subscriptionId: subscription.id,
        renewalCaseId: renewalCase.id,
        recipient: 'placeholder@example.test',
      });
      const transport = new MockMailTransport();
      const service = buildOutboundService(transport);

      const firstOutcome = await service.processOne(outbox.id);
      expect(firstOutcome).toBe('deferred');
      expect(transport.sent).toHaveLength(0);
      const afterDefer = await prisma.communicationOutbox.findUniqueOrThrow({ where: { id: outbox.id } });
      expect(afterDefer.status).toBe(CommunicationOutboxStatus.QUEUED);
      expect(afterDefer.attempts).toBe(0);

      await prisma.customer.update({ where: { id: customer.id }, data: { primaryEmail: 'fixed@example.test' } });

      const secondOutcome = await service.processOne(outbox.id);

      expect(secondOutcome).toBe('sent');
      expect(transport.sent).toHaveLength(1);
      expect(transport.sent[0]!.toAddress).toBe('fixed@example.test');
      const finalRow = await prisma.communicationOutbox.findUniqueOrThrow({ where: { id: outbox.id } });
      expect(finalRow.status).toBe(CommunicationOutboxStatus.DELIVERED);
      expect(finalRow.recipient).toBe('fixed@example.test');
    });
  });
});
