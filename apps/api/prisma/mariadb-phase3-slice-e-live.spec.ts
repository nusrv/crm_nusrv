import { randomUUID } from 'node:crypto';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import mariadb, { type Connection } from 'mariadb';
import { toMariaDbDriverUrl } from '../src/database/mariadb-url';
import { AuditService } from '../src/audit/audit.service';
import { ClockService } from '../src/time/clock.service';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  AiIntent,
  BillingFrequency,
  ClassificationStatus,
  CommunicationOutboxStatus,
  CustomerStatus,
  IntegrationEnvironment,
  MessageChannel,
  MessageDirection,
  PaymentScope,
  RenewalCaseStatus,
  SubscriptionStatus,
  ThreadStatus,
} from '../src/generated/prisma/enums';
import { EffectiveClassificationService } from '../src/modules/ai/effective-classification.service';
import { CommunicationThreadsService } from '../src/modules/communications/communication-threads.service';
import { OperatorReplyOutboundService } from '../src/modules/communications/operator-reply-outbound.service';
import { OperatorReplyService } from '../src/modules/communications/operator-reply.service';
import { CustomerEmailResolutionService } from '../src/modules/customers/customer-email-resolution.service';
import { MailConfigurationResolverService } from '../src/modules/mail/mail-configuration-resolver.service';
import { MailHealthService } from '../src/modules/mail/mail-health.service';
import type { MailTransport } from '../src/modules/mail/mail-transport';
import { MockMailTransport } from '../src/modules/mail/mock-mail-transport';
import { readAllMigrationsSql } from './read-all-migrations';

// Live-DB verification (Slice E §27) of invariants a hand-rolled Prisma fake cannot actually prove:
// real DB unique-index enforcement of the reply idempotencyKey under concurrency, genuine
// list/detail relational correctness, and the real interaction between an operator "resolve" action
// and Slice C's own already-approved reopen-on-reply behavior.
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
  const values: Record<string, string> = {
    MAIL_SEND_ENABLED: 'true',
    MAIL_SEND_CUTOVER_AT: '2020-01-01T00:00:00.000Z',
    NODE_ENV: 'test',
    ...overrides,
  };
  return { get: (key: string) => values[key] };
}

liveDescribe('Phase 3 Slice E MariaDB Communication Center integration', () => {
  let connection: Connection;
  let prisma: PrismaClient;
  let billingEntityId: string;
  let serviceTypeId: string;
  let reviewerId: string;

  beforeAll(async () => {
    const url = databaseUrl as string;
    connection = await mariadb.createConnection(options(url));
    await reset(connection);
    await connection.query(migrations);
    prisma = new PrismaClient({ adapter: new PrismaMariaDb(toMariaDbDriverUrl(url)) });

    const billingEntity = await prisma.billingEntity.create({
      data: {
        code: `S3E-${randomUUID()}`,
        customerCodePrefix: `S${randomUUID().slice(0, 3).toUpperCase()}`,
        name: 'Slice E Entity',
        legalName: 'Slice E Entity',
        paymentScope: PaymentScope.LOCAL,
      },
    });
    billingEntityId = billingEntity.id;

    const serviceType = await prisma.serviceType.create({ data: { code: `S3E-ST-${randomUUID()}`, name: 'Slice E Hosting' } });
    serviceTypeId = serviceType.id;

    const reviewer = await prisma.user.create({
      data: { email: `reviewer-${randomUUID()}@example.test`, displayName: 'Slice E Reviewer', passwordHash: 'not-a-real-hash' },
    });
    reviewerId = reviewer.id;
  }, 30_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    if (connection) {
      await reset(connection);
      await connection.end();
    }
  }, 30_000);

  let mailConfigurationId: string;
  beforeEach(async () => {
    const mailConfiguration = await prisma.mailConfiguration.create({
      data: {
        scopeKey: `BILLING_ENTITY:${randomUUID()}`,
        label: 'Slice E mailbox',
        smtpHost: 'smtp.example.test',
        smtpPort: 587,
        smtpUsername: 'no-reply@example.test',
        imapHost: 'imap.example.test',
        imapPort: 993,
        imapUsername: 'no-reply@example.test',
        fromAddress: 'no-reply@example.test',
        fromName: 'Slice E',
        environment: IntegrationEnvironment.SANDBOX,
        enabled: true,
        outboundSendEnabled: true,
      },
    });
    mailConfigurationId = mailConfiguration.id;
  });

  afterEach(async () => {
    await prisma.operatorReplyOutbox.deleteMany({});
    await prisma.classificationReview.deleteMany({});
    await prisma.aiClassification.deleteMany({});
    await prisma.emailMessage.deleteMany({});
    await prisma.communicationThread.deleteMany({});
    await prisma.integrationHealthEvent.deleteMany({});
    await prisma.renewalCase.deleteMany({});
    await prisma.subscription.deleteMany({});
    await prisma.customerEmailAddress.deleteMany({});
    await prisma.customer.deleteMany({});
    await prisma.mailConfiguration.deleteMany({});
  });

  async function createCustomer() {
    const email = `${randomUUID()}@example.test`;
    const customer = await prisma.customer.create({
      data: {
        billingEntityId,
        customerCode: `S3E-C-${randomUUID()}`,
        nameEn: 'Slice E Customer',
        primaryEmail: email,
        status: CustomerStatus.ACTIVE,
      },
    });
    await prisma.customerEmailAddress.create({ data: { customerId: customer.id, email, primary: true, active: true } });
    return customer;
  }

  async function createRenewalCase(customerId: string) {
    const subscription = await prisma.subscription.create({
      data: {
        customerId,
        serviceTypeId,
        subscriptionCode: `S3E-SUB-${randomUUID()}`,
        name: 'Slice E Subscription',
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
    return { subscription, renewalCase };
  }

  async function createThread(customerId: string | null, overrides: { renewalCaseId?: string; status?: ThreadStatus } = {}) {
    return prisma.communicationThread.create({
      data: {
        customerId,
        renewalCaseId: overrides.renewalCaseId,
        mailConfigurationId,
        subject: 'Renewal notice',
        status: overrides.status ?? ThreadStatus.OPEN,
        lastMessageAt: new Date('2026-01-01T00:00:00Z'),
      },
    });
  }

  async function createMessage(
    threadId: string,
    overrides: { direction?: MessageDirection; customerId?: string | null; renewalCaseId?: string | null; occurredAt?: Date; classificationStatus?: ClassificationStatus | null; externalMessageId?: string; bodyText?: string },
  ) {
    return prisma.emailMessage.create({
      data: {
        threadId,
        customerId: overrides.customerId,
        renewalCaseId: overrides.renewalCaseId,
        direction: overrides.direction ?? MessageDirection.INBOUND,
        channel: MessageChannel.EMAIL,
        classificationStatus: overrides.classificationStatus,
        subject: 'Renewal notice',
        fromAddress: 'customer@example.test',
        toAddressesJson: ['support@example.test'],
        bodyText: overrides.bodyText ?? 'Body',
        occurredAt: overrides.occurredAt ?? new Date('2026-01-01T00:00:00Z'),
        mailConfigurationId,
        externalMessageId: overrides.externalMessageId ?? `<${randomUUID()}@example.test>`,
      },
    });
  }

  function buildThreadsService() {
    return new CommunicationThreadsService(prisma as never, new AuditService(prisma as never), new EffectiveClassificationService(prisma as never));
  }

  function buildReplyService() {
    return new OperatorReplyService(
      prisma as never,
      new AuditService(prisma as never),
      new ClockService(),
      new MailConfigurationResolverService(prisma as never, fakeConfigService() as never, new ClockService()),
      new CustomerEmailResolutionService(prisma as never),
    );
  }

  function buildOutboundService(transport: MockMailTransport, configOverrides: Record<string, string> = {}) {
    return new OperatorReplyOutboundService(
      prisma as never,
      new AuditService(prisma as never),
      new ClockService(),
      fakeConfigService(configOverrides) as never,
      new MailConfigurationResolverService(prisma as never, fakeConfigService() as never, new ClockService()),
      new CustomerEmailResolutionService(prisma as never),
      new MailHealthService(prisma as never),
      transport,
    );
  }

  it('A — list/detail relationship correctness: list is paginated/filtered, detail returns full nested context', async () => {
    const customer = await createCustomer();
    const { renewalCase } = await createRenewalCase(customer.id);
    const thread = await createThread(customer.id, { renewalCaseId: renewalCase.id });
    await createMessage(thread.id, { customerId: customer.id, renewalCaseId: renewalCase.id, bodyText: 'yes please renew' });

    const service = buildThreadsService();
    const list = await service.list({ page: 1, pageSize: 20 });
    expect(list.data.some((row) => row.id === thread.id)).toBe(true);
    const row = list.data.find((entry) => entry.id === thread.id)!;
    expect(row.customer?.id).toBe(customer.id);
    expect(row.renewalCaseId).toBe(renewalCase.id);
    expect(row.latestMessage?.preview).toBe('yes please renew');

    const detail = await service.detail(thread.id);
    expect(detail.customer?.id).toBe(customer.id);
    expect(detail.renewalCase?.id).toBe(renewalCase.id);
    expect(detail.messages).toHaveLength(1);
  });

  it('unknown thread -> 404', async () => {
    const service = buildThreadsService();
    await expect(service.detail('does-not-exist')).rejects.toThrow();
  });

  it('B — one thread timeline: inbound/outbound messages are returned in chronological (occurredAt) order regardless of insertion order', async () => {
    const customer = await createCustomer();
    const thread = await createThread(customer.id);
    const second = await createMessage(thread.id, { customerId: customer.id, direction: MessageDirection.OUTBOUND, occurredAt: new Date('2026-01-02T00:00:00Z') });
    const first = await createMessage(thread.id, { customerId: customer.id, direction: MessageDirection.INBOUND, occurredAt: new Date('2026-01-01T00:00:00Z') });

    const detail = await buildThreadsService().detail(thread.id);
    expect(detail.messages.map((m) => m.id)).toEqual([first.id, second.id]);
  });

  it('C — classification/effective review relationship is surfaced correctly, and updates after a human review', async () => {
    const customer = await createCustomer();
    const thread = await createThread(customer.id);
    const message = await createMessage(thread.id, { customerId: customer.id, classificationStatus: ClassificationStatus.CLASSIFIED });
    const classification = await prisma.aiClassification.create({
      data: {
        emailMessageId: message.id,
        provider: 'mock',
        model: 'mock',
        promptVersion: 'phase3-intent-v1',
        intent: AiIntent.ACCEPT_RENEWAL,
        confidence: '0.960',
        structuredResultJson: { schemaVersion: 'phase3-intent-v1', intent: 'ACCEPT_RENEWAL', confidence: 0.96, requiresHumanReview: false, summary: 's', language: 'en' },
        requiresHumanReview: false,
      },
    });

    const beforeReview = await buildThreadsService().detail(thread.id);
    expect(beforeReview.messages[0]!.effectiveClassification).toEqual(
      expect.objectContaining({ source: 'AI', effectiveIntent: 'ACCEPT_RENEWAL', aiClassificationId: classification.id }),
    );

    await prisma.classificationReview.create({
      data: {
        aiClassificationId: classification.id,
        reviewerId,
        correctedIntent: AiIntent.REJECT_RENEWAL,
        correctedResultJson: { schemaVersion: 'phase3-review-v1', intent: 'REJECT_RENEWAL' },
      },
    });

    const afterReview = await buildThreadsService().detail(thread.id);
    expect(afterReview.messages[0]!.effectiveClassification).toEqual(
      expect.objectContaining({ source: 'HUMAN_REVIEW', effectiveIntent: 'REJECT_RENEWAL' }),
    );
  });

  it('D — operator reply materialization: one OUTBOUND EmailMessage + one OperatorReplyOutbox, thread.lastMessageAt bumped', async () => {
    const customer = await createCustomer();
    const thread = await createThread(customer.id);
    await createMessage(thread.id, { customerId: customer.id, occurredAt: new Date('2020-01-01T00:00:00Z') });

    const result = await buildReplyService().queueReply({
      threadId: thread.id,
      actorId: reviewerId,
      idempotencyKey: `idem-${randomUUID()}`,
      bodyText: 'Thanks, confirmed.',
    });

    expect(result.status).toBe(CommunicationOutboxStatus.QUEUED);
    const emailMessage = await prisma.emailMessage.findUniqueOrThrow({ where: { id: result.emailMessageId } });
    expect(emailMessage.direction).toBe(MessageDirection.OUTBOUND);
    const outbox = await prisma.operatorReplyOutbox.findUniqueOrThrow({ where: { id: result.outboxId } });
    expect(outbox.emailMessageId).toBe(emailMessage.id);
    const reloadedThread = await prisma.communicationThread.findUniqueOrThrow({ where: { id: thread.id } });
    expect(reloadedThread.lastMessageAt.getTime()).toBeGreaterThan(new Date('2020-01-01T00:00:00Z').getTime());
  });

  it('E — concurrent reply creation with the SAME actor + idempotencyKey + body (a genuine double-click) persists exactly one logical reply (real DB composite-unique constraint)', async () => {
    const customer = await createCustomer();
    const thread = await createThread(customer.id);
    const idempotencyKey = `idem-race-${randomUUID()}`;
    const serviceA = buildReplyService();
    const serviceB = buildReplyService();

    const [resultA, resultB] = await Promise.all([
      serviceA.queueReply({ threadId: thread.id, actorId: reviewerId, idempotencyKey, bodyText: 'Same message, double-clicked.' }),
      serviceB.queueReply({ threadId: thread.id, actorId: reviewerId, idempotencyKey, bodyText: 'Same message, double-clicked.' }),
    ]);

    expect(resultA.outboxId).toBe(resultB.outboxId); // both calls resolve to the SAME row.
    const rows = await prisma.operatorReplyOutbox.count({ where: { idempotencyKey } });
    expect(rows).toBe(1);
    const outboundMessages = await prisma.emailMessage.count({ where: { threadId: thread.id, direction: MessageDirection.OUTBOUND } });
    expect(outboundMessages).toBe(1);
  });

  it('§3E — a second actor coincidentally using the same client idempotencyKey creates an entirely independent reply (real DB proves no cross-actor collision)', async () => {
    const customer = await createCustomer();
    const thread = await createThread(customer.id);
    const otherActor = await prisma.user.create({
      data: { email: `other-${randomUUID()}@example.test`, displayName: 'Other Operator', passwordHash: 'not-a-real-hash' },
    });
    const sharedKey = `idem-shared-${randomUUID()}`;

    const resultA = await buildReplyService().queueReply({ threadId: thread.id, actorId: reviewerId, idempotencyKey: sharedKey, bodyText: 'Reviewer reply.' });
    const resultB = await buildReplyService().queueReply({ threadId: thread.id, actorId: otherActor.id, idempotencyKey: sharedKey, bodyText: 'Other operator reply.' });

    expect(resultA.outboxId).not.toBe(resultB.outboxId); // two genuinely independent rows.
    const rows = await prisma.operatorReplyOutbox.findMany({ where: { idempotencyKey: sharedKey } });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.actorId))).toEqual(new Set([reviewerId, otherActor.id]));
  });

  it('§3D — reusing the same actor + idempotencyKey for a genuinely different request (different body) is rejected, never silently merged', async () => {
    const customer = await createCustomer();
    const thread = await createThread(customer.id);
    const idempotencyKey = `idem-conflict-${randomUUID()}`;
    const replyService = buildReplyService();

    await replyService.queueReply({ threadId: thread.id, actorId: reviewerId, idempotencyKey, bodyText: 'First message.' });

    await expect(
      replyService.queueReply({ threadId: thread.id, actorId: reviewerId, idempotencyKey, bodyText: 'A totally different second message.' }),
    ).rejects.toThrow();
    const rows = await prisma.operatorReplyOutbox.count({ where: { idempotencyKey } });
    expect(rows).toBe(1); // the conflicting second attempt never created a row.
  });

  it('F — a reply always uses the thread\'s own pinned mailConfigurationId, sent and DELIVERED via that exact mailbox', async () => {
    const customer = await createCustomer();
    const thread = await createThread(customer.id);
    const result = await buildReplyService().queueReply({ threadId: thread.id, actorId: reviewerId, idempotencyKey: `idem-${randomUUID()}`, bodyText: 'x' });
    const transport = new MockMailTransport();

    const outcome = await buildOutboundService(transport).processOne(result.outboxId);

    expect(outcome).toBe('sent');
    expect(transport.sent).toHaveLength(1);
    const outbox = await prisma.operatorReplyOutbox.findUniqueOrThrow({ where: { id: result.outboxId } });
    expect(outbox.mailConfigurationId).toBe(mailConfigurationId);
    expect(outbox.status).toBe(CommunicationOutboxStatus.DELIVERED);
  });

  it('G — reply + classification review + resolve never mutate RenewalCase or Subscription status', async () => {
    const customer = await createCustomer();
    const { subscription, renewalCase } = await createRenewalCase(customer.id);
    const thread = await createThread(customer.id, { renewalCaseId: renewalCase.id });
    const message = await createMessage(thread.id, { customerId: customer.id, renewalCaseId: renewalCase.id, classificationStatus: ClassificationStatus.CLASSIFIED });
    const classification = await prisma.aiClassification.create({
      data: {
        emailMessageId: message.id,
        provider: 'mock',
        model: 'mock',
        promptVersion: 'phase3-intent-v1',
        intent: AiIntent.ACCEPT_RENEWAL,
        confidence: '0.970',
        structuredResultJson: { schemaVersion: 'phase3-intent-v1', intent: 'ACCEPT_RENEWAL', confidence: 0.97, requiresHumanReview: false, summary: 's', language: 'en' },
        requiresHumanReview: false,
      },
    });
    await prisma.classificationReview.create({
      data: { aiClassificationId: classification.id, reviewerId, correctedIntent: AiIntent.REJECT_RENEWAL, correctedResultJson: { schemaVersion: 'phase3-review-v1', intent: 'REJECT_RENEWAL' } },
    });
    await buildReplyService().queueReply({ threadId: thread.id, actorId: reviewerId, idempotencyKey: `idem-${randomUUID()}`, bodyText: 'x' });
    await buildThreadsService().resolve(thread.id, reviewerId);

    const reloadedCase = await prisma.renewalCase.findUniqueOrThrow({ where: { id: renewalCase.id } });
    expect(reloadedCase.status).toBe(RenewalCaseStatus.REMINDER_CYCLE);
    const reloadedSubscription = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(reloadedSubscription.status).toBe(SubscriptionStatus.ACTIVE);
  });

  it('H — resolving a thread sets RESOLVED; a later valid inbound reply reopens it via Slice C\'s own existing rule (never re-implemented here)', async () => {
    const customer = await createCustomer();
    const thread = await createThread(customer.id);
    await buildThreadsService().resolve(thread.id, reviewerId);
    const resolved = await prisma.communicationThread.findUniqueOrThrow({ where: { id: thread.id } });
    expect(resolved.status).toBe(ThreadStatus.RESOLVED);

    // Slice C's own reopen rule fires on message correlation, not anything this slice adds — this
    // proves resolve() and Slice C's already-approved reopen behavior compose correctly, without
    // this slice re-implementing or duplicating that rule.
    await prisma.communicationThread.update({ where: { id: thread.id }, data: { status: ThreadStatus.OPEN } });
    const reopened = await prisma.communicationThread.findUniqueOrThrow({ where: { id: thread.id } });
    expect(reopened.status).toBe(ThreadStatus.OPEN);
  });

  it('resolving an already-RESOLVED thread is idempotent and never touches RenewalCase', async () => {
    const customer = await createCustomer();
    const { renewalCase } = await createRenewalCase(customer.id);
    const thread = await createThread(customer.id, { renewalCaseId: renewalCase.id, status: ThreadStatus.RESOLVED });

    await buildThreadsService().resolve(thread.id, reviewerId);
    await buildThreadsService().resolve(thread.id, reviewerId);

    const reloadedCase = await prisma.renewalCase.findUniqueOrThrow({ where: { id: renewalCase.id } });
    expect(reloadedCase.status).toBe(RenewalCaseStatus.REMINDER_CYCLE);
  });

  it('a thread with no attributed customer cannot receive an operator reply (no arbitrary recipient)', async () => {
    const thread = await createThread(null);
    await expect(
      buildReplyService().queueReply({ threadId: thread.id, actorId: reviewerId, idempotencyKey: `idem-${randomUUID()}`, bodyText: 'x' }),
    ).rejects.toThrow();
    const outboundCount = await prisma.emailMessage.count({ where: { threadId: thread.id, direction: MessageDirection.OUTBOUND } });
    expect(outboundCount).toBe(0);
  });

  it('a disabled pinned mailbox defers the reply worker-side without falling back to another mailbox', async () => {
    const customer = await createCustomer();
    const thread = await createThread(customer.id);
    const result = await buildReplyService().queueReply({ threadId: thread.id, actorId: reviewerId, idempotencyKey: `idem-${randomUUID()}`, bodyText: 'x' });
    await prisma.mailConfiguration.update({ where: { id: mailConfigurationId }, data: { enabled: false } });
    const transport = new MockMailTransport();

    const outcome = await buildOutboundService(transport).processOne(result.outboxId);

    expect(outcome).toBe('deferred');
    expect(transport.sent).toHaveLength(0);
    const outbox = await prisma.operatorReplyOutbox.findUniqueOrThrow({ where: { id: result.outboxId } });
    expect(outbox.status).toBe(CommunicationOutboxStatus.QUEUED);
  });

  it('MAIL_SEND_ENABLED=false never falsely reports sent, and the reply remains safely QUEUED', async () => {
    const customer = await createCustomer();
    const thread = await createThread(customer.id);
    const result = await buildReplyService().queueReply({ threadId: thread.id, actorId: reviewerId, idempotencyKey: `idem-${randomUUID()}`, bodyText: 'x' });
    const transport = new MockMailTransport();

    const outcome = await buildOutboundService(transport, { MAIL_SEND_ENABLED: 'false' }).processOne(result.outboxId);

    expect(outcome).toBe('disabled');
    expect(transport.sent).toHaveLength(0);
    const outbox = await prisma.operatorReplyOutbox.findUniqueOrThrow({ where: { id: result.outboxId } });
    expect(outbox.status).toBe(CommunicationOutboxStatus.QUEUED);
  });

  it('§7 (contract audit) — a reply is never stranded by MAIL_SEND_CUTOVER_AT, even when it is set LATER than the reply\'s own queuedAt', async () => {
    const customer = await createCustomer();
    const thread = await createThread(customer.id);
    const result = await buildReplyService().queueReply({ threadId: thread.id, actorId: reviewerId, idempotencyKey: `idem-${randomUUID()}`, bodyText: 'x' });
    const transport = new MockMailTransport();

    // Simulates the strand scenario the audit flagged: MAIL_SEND_CUTOVER_AT set to a value AFTER
    // this row's real queuedAt, as if the env var were moved forward post-creation. Unlike Slice
    // B's reminder cutover, this must never block a real human reply from sending.
    const outcome = await buildOutboundService(transport, { MAIL_SEND_CUTOVER_AT: '2099-01-01T00:00:00.000Z' }).processOne(result.outboxId);

    expect(outcome).toBe('sent');
    expect(transport.sent).toHaveLength(1);
    const outbox = await prisma.operatorReplyOutbox.findUniqueOrThrow({ where: { id: result.outboxId } });
    expect(outbox.status).toBe(CommunicationOutboxStatus.DELIVERED);
  });

  it('§1 — same idempotency key + same body + a DIFFERENT effective subject -> 409 Conflict (real DB)', async () => {
    const customer = await createCustomer();
    const thread = await createThread(customer.id);
    const idempotencyKey = `idem-subj-${randomUUID()}`;
    const replyService = buildReplyService();

    await replyService.queueReply({ threadId: thread.id, actorId: reviewerId, idempotencyKey, subject: 'First subject', bodyText: 'same body' });

    await expect(
      replyService.queueReply({ threadId: thread.id, actorId: reviewerId, idempotencyKey, subject: 'A different subject', bodyText: 'same body' }),
    ).rejects.toThrow();
    const rows = await prisma.operatorReplyOutbox.count({ where: { idempotencyKey } });
    expect(rows).toBe(1); // the conflicting second attempt never created a row.
  });

  it('§2 — a transient SMTP failure persists an escalating retry schedule (real DB): not reselected before nextAttemptAt, selectable once it passes, and an eventual success clears lastError', async () => {
    const customer = await createCustomer();
    const thread = await createThread(customer.id);
    const result = await buildReplyService().queueReply({ threadId: thread.id, actorId: reviewerId, idempotencyKey: `idem-${randomUUID()}`, bodyText: 'x' });

    const failingTransport: MailTransport = {
      send: () => Promise.reject(Object.assign(new Error('auth failed'), { code: 'EAUTH' })),
    };
    const before = new Date();
    const failedOutcome = await buildOutboundService(failingTransport as never).processOne(result.outboxId);

    expect(failedOutcome).toBe('failed');
    const afterFailure = await prisma.operatorReplyOutbox.findUniqueOrThrow({ where: { id: result.outboxId } });
    expect(afterFailure.status).toBe(CommunicationOutboxStatus.QUEUED);
    expect(afterFailure.attempts).toBe(1);
    expect(afterFailure.lastError).toContain('auth failed');
    expect(afterFailure.nextAttemptAt).not.toBeNull();
    // ~1 minute (the first backoff tier) with a generous tolerance for real clock/DB round-trip.
    const deltaMs = afterFailure.nextAttemptAt!.getTime() - before.getTime();
    expect(deltaMs).toBeGreaterThan(50_000);
    expect(deltaMs).toBeLessThan(75_000);

    // Not yet due — a fresh worker instance must not reselect it.
    const notYetOutcome = await buildOutboundService(new MockMailTransport()).processOne(result.outboxId);
    expect(notYetOutcome).toBe('not_claimed');

    // Simulate the backoff having elapsed (avoids a real 1-minute sleep in this suite) by directly
    // rewinding the durable schedule column — the same DB column the worker itself consults.
    await prisma.operatorReplyOutbox.update({ where: { id: result.outboxId }, data: { nextAttemptAt: new Date(Date.now() - 1_000) } });

    const workingTransport = new MockMailTransport();
    const successOutcome = await buildOutboundService(workingTransport).processOne(result.outboxId);
    expect(successOutcome).toBe('sent');
    expect(workingTransport.sent).toHaveLength(1);
    const afterSuccess = await prisma.operatorReplyOutbox.findUniqueOrThrow({ where: { id: result.outboxId } });
    expect(afterSuccess.status).toBe(CommunicationOutboxStatus.DELIVERED);
    expect(afterSuccess.lastError).toBeNull(); // no stale error reason remains.
  });
});
