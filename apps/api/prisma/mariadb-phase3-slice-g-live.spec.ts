import { randomUUID } from 'node:crypto';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import mariadb, { type Connection } from 'mariadb';
import { toMariaDbDriverUrl } from '../src/database/mariadb-url';
import { AuditService } from '../src/audit/audit.service';
import { PrismaClient, Prisma } from '../src/generated/prisma/client';
import {
  AiIntent,
  AiRoutingAction,
  AiRoutingStatus,
  BillingFrequency,
  ClassificationStatus,
  CustomerStatus,
  IntegrationEnvironment,
  MessageDirection,
  PaymentScope,
  RenewalCaseStatus,
  SubscriptionStatus,
  ThreadStatus,
} from '../src/generated/prisma/enums';
import { AiClassificationService } from '../src/modules/ai/ai-classification.service';
import { AiHealthService } from '../src/modules/ai/ai-health.service';
import { AiRoutingService } from '../src/modules/ai/ai-routing.service';
import { ClassificationReviewService } from '../src/modules/ai/classification-review.service';
import { CommunicationThreadsService } from '../src/modules/communications/communication-threads.service';
import { RESULT_SCHEMA_VERSION } from '../src/modules/ai/llm-gateway';
import type { LlmGateway, NormalizedClassificationResult } from '../src/modules/ai/llm-gateway';
import { RenewalCasesService } from '../src/modules/renewal-cases/renewal-cases.service';
import { ClockService } from '../src/time/clock.service';
import { readAllMigrationsSql } from './read-all-migrations';

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

/** Phase 3.1 §J — see mariadb-phase3-slice-d-live.spec.ts's identical helper doc comment: this
 * live spec's own purpose is real-Prisma routing/CAS correctness, not AiSettings DB resolution
 * (covered by dedicated unit tests), so a lightweight fake built from the same `configOverrides`
 * shape preserves every existing test's intent unchanged. */
function fakeAiSettingsResolver(overrides: Record<string, string | number> = {}) {
  const values: Record<string, string | number> = {
    AI_ENABLED: 'true',
    AI_CONFIDENCE_THRESHOLD: 0.9,
    AI_AUTO_ROUTE_ACCEPT: 'false',
    ...overrides,
  };
  return {
    getSettings: () =>
      Promise.resolve({
        enabled: values.AI_ENABLED === 'true',
        provider: 'OPENAI',
        model: null,
        confidenceThreshold: Number(values.AI_CONFIDENCE_THRESHOLD ?? 0.9),
        autoRouteAcceptEnabled: values.AI_AUTO_ROUTE_ACCEPT === 'true',
        autoRouteAcceptCutoverAt: values.AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT
          ? new Date(values.AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT as string)
          : null,
      }),
  };
}

function acceptResult(overrides: Partial<NormalizedClassificationResult> = {}): NormalizedClassificationResult {
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    intent: AiIntent.ACCEPT_RENEWAL,
    confidence: 0.96,
    requiresHumanReview: false,
    summary: 'Customer confirms renewal.',
    language: 'en',
    ...overrides,
  };
}

function rejectResult(): NormalizedClassificationResult {
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    intent: AiIntent.REJECT_RENEWAL,
    confidence: 0.95,
    requiresHumanReview: false,
    summary: 'Customer declines renewal.',
    language: 'en',
  };
}

liveDescribe('Phase 3 Slice G MariaDB AI-routing integration', () => {
  let connection: Connection;
  let prisma: PrismaClient;
  let billingEntityId: string;
  let serviceTypeId: string;
  let mailConfigurationId: string;
  let reviewerId: string;

  beforeAll(async () => {
    const url = databaseUrl as string;
    connection = await mariadb.createConnection(options(url));
    await reset(connection);
    await connection.query(migrations);
    prisma = new PrismaClient({ adapter: new PrismaMariaDb(toMariaDbDriverUrl(url)) });

    const billingEntity = await prisma.billingEntity.create({
      data: {
        code: `S3G-${randomUUID()}`,
        customerCodePrefix: `S${randomUUID().slice(0, 3).toUpperCase()}`,
        name: 'Slice G Entity',
        legalName: 'Slice G Entity',
        paymentScope: PaymentScope.LOCAL,
      },
    });
    billingEntityId = billingEntity.id;

    const serviceType = await prisma.serviceType.create({ data: { code: `S3G-ST-${randomUUID()}`, name: 'Slice G Hosting' } });
    serviceTypeId = serviceType.id;

    const reviewer = await prisma.user.create({
      data: { email: `reviewer-${randomUUID()}@example.test`, displayName: 'Slice G Reviewer', passwordHash: 'not-a-real-hash' },
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

  beforeEach(async () => {
    const mailConfiguration = await prisma.mailConfiguration.create({
      data: {
        scopeKey: `BILLING_ENTITY:${randomUUID()}`,
        label: 'Slice G mailbox',
        smtpHost: 'smtp.example.test',
        smtpPort: 587,
        smtpUsername: 'no-reply@example.test',
        imapHost: 'imap.example.test',
        imapPort: 993,
        imapUsername: 'no-reply@example.test',
        imapFolder: 'INBOX',
        fromAddress: 'no-reply@example.test',
        fromName: 'Slice G',
        environment: IntegrationEnvironment.SANDBOX,
        enabled: true,
      },
    });
    mailConfigurationId = mailConfiguration.id;
  });

  afterEach(async () => {
    await prisma.classificationReview.deleteMany({});
    await prisma.aiRoutingDecision.deleteMany({});
    await prisma.aiClassification.deleteMany({});
    await prisma.emailMessage.deleteMany({});
    await prisma.communicationThread.deleteMany({});
    await prisma.integrationHealthEvent.deleteMany({});
    await prisma.renewalHold.deleteMany({});
    await prisma.renewalCase.deleteMany({});
    await prisma.subscription.deleteMany({});
    await prisma.customerEmailAddress.deleteMany({});
    await prisma.customer.deleteMany({});
    await prisma.mailConfiguration.deleteMany({});
  });

  async function createCustomer() {
    const email = `${randomUUID()}@example.test`;
    const customer = await prisma.customer.create({
      data: { billingEntityId, customerCode: `S3G-C-${randomUUID()}`, nameEn: 'Slice G Customer', primaryEmail: email, status: CustomerStatus.ACTIVE },
    });
    await prisma.customerEmailAddress.create({ data: { customerId: customer.id, email, primary: true, active: true } });
    return customer;
  }

  async function createRenewalCase(customerId: string, status: RenewalCaseStatus = RenewalCaseStatus.REMINDER_CYCLE) {
    const subscription = await prisma.subscription.create({
      data: {
        customerId,
        serviceTypeId,
        subscriptionCode: `S3G-SUB-${randomUUID()}`,
        name: 'Slice G Subscription',
        startDate: new Date('2020-01-01T00:00:00Z'),
        renewalDate: new Date('2027-01-01T00:00:00Z'),
        billingFrequency: BillingFrequency.ANNUAL,
        sellingPrice: '100.000',
        currency: 'JOD',
        status: SubscriptionStatus.ACTIVE,
      },
    });
    const renewalCase = await prisma.renewalCase.create({
      data: { subscriptionId: subscription.id, cycleStartDate: new Date('2026-01-01T00:00:00Z'), dueDate: subscription.renewalDate, status },
    });
    return { subscription, renewalCase };
  }

  async function createThread(customerId: string, overrides: { renewalCaseId?: string } = {}) {
    return prisma.communicationThread.create({
      data: { customerId, renewalCaseId: overrides.renewalCaseId, mailConfigurationId, subject: 'Renewal', status: ThreadStatus.OPEN, lastMessageAt: new Date('2026-01-01T00:00:00Z') },
    });
  }

  async function createInboundMessage(
    threadId: string,
    overrides: {
      customerId?: string;
      renewalCaseId?: string;
      classificationStatus?: ClassificationStatus | null;
      occurredAt?: Date;
      createdAt?: Date;
    } = {},
  ) {
    // Contract-audit hardening §1/§2 — createdAt has a schema-level @default(now()), which Prisma
    // only applies when the field is omitted from `data`; passing it explicitly (only when the
    // historical-mail regression tests below actually request it) overrides that default with a
    // real, distinct, persisted value the cutover predicate can be tested against.
    return prisma.emailMessage.create({
      data: {
        threadId,
        customerId: overrides.customerId,
        renewalCaseId: overrides.renewalCaseId,
        direction: MessageDirection.INBOUND,
        classificationStatus: overrides.classificationStatus === undefined ? ClassificationStatus.PENDING : overrides.classificationStatus,
        subject: 'Renewal',
        fromAddress: 'customer@example.test',
        toAddressesJson: ['support@nusrv.test'],
        bodyText: 'yes please renew',
        occurredAt: overrides.occurredAt ?? new Date('2026-01-01T00:00:00Z'),
        ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
        mailConfigurationId,
      },
    });
  }

  function noopRoutingEnqueue() {
    return { enqueue: () => Promise.resolve() };
  }

  function buildClassificationService(classifyIntentImpl: (input: unknown) => Promise<NormalizedClassificationResult>, configOverrides: Record<string, string | number> = {}) {
    const gateway: LlmGateway = {
      classifyIntent: classifyIntentImpl,
      draftReply: () => Promise.reject(new Error('draftReply is not used by this live spec.')),
    };
    return new AiClassificationService(
      prisma as never,
      fakeAiSettingsResolver(configOverrides) as never,
      new AuditService(prisma as never),
      new AiHealthService(prisma as never),
      new ClockService(),
      noopRoutingEnqueue() as never,
      gateway,
    );
  }

  function buildRoutingService(configOverrides: Record<string, string | number> = {}) {
    return new AiRoutingService(prisma as never, new AuditService(prisma as never), new ClockService(), fakeAiSettingsResolver(configOverrides) as never);
  }

  function buildReviewService() {
    return new ClassificationReviewService(prisma as never, new AuditService(prisma as never));
  }

  function buildRenewalCasesService() {
    return new RenewalCasesService(prisma as never, new AuditService(prisma as never), new ClockService(), {} as never);
  }

  function buildThreadsService() {
    // list() never calls effectiveClassification — only detail() does — so a stub is sufficient here.
    return new CommunicationThreadsService(prisma as never, new AuditService(prisma as never), {} as never);
  }

  it('§26 — atomic classification+routing-decision creation: exactly one AiRoutingDecision exists per AiClassification, and the unique constraint enforces it', async () => {
    const customer = await createCustomer();
    const thread = await createThread(customer.id);
    const message = await createInboundMessage(thread.id, { customerId: customer.id });
    const service = buildClassificationService(() => Promise.resolve(acceptResult()));

    await service.classifyMessage(message.id, false);

    const classification = await prisma.aiClassification.findFirstOrThrow({ where: { emailMessageId: message.id } });
    const decisions = await prisma.aiRoutingDecision.findMany({ where: { aiClassificationId: classification.id } });
    expect(decisions).toHaveLength(1);

    await expect(
      prisma.aiRoutingDecision.create({
        data: { aiClassificationId: classification.id, routingVersion: 'phase3-routing-v1', action: AiRoutingAction.HUMAN_REVIEW, status: AiRoutingStatus.SUCCEEDED },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('§26 — classification CAS lost -> neither AiClassification nor AiRoutingDecision persists', async () => {
    const customer = await createCustomer();
    const thread = await createThread(customer.id);
    // Already CLASSIFIED — classifyMessage's own eligibility check (PENDING only) will skip it.
    const message = await createInboundMessage(thread.id, { customerId: customer.id, classificationStatus: ClassificationStatus.CLASSIFIED });
    const service = buildClassificationService(() => Promise.resolve(acceptResult()));

    const outcome = await service.classifyMessage(message.id, false);

    expect(outcome).toBe('skipped_ineligible');
    expect(await prisma.aiClassification.count({ where: { emailMessageId: message.id } })).toBe(0);
    expect(await prisma.aiRoutingDecision.count({})).toBe(0);
  });

  it('§27 — valid high-confidence AUTO_ACCEPT: RenewalCase ACCEPTED, reminder-ineligible, ActorType.AI/actorId NULL audit, decision SUCCEEDED, message CLASSIFIED, thread OPEN', async () => {
    const customer = await createCustomer();
    const { renewalCase } = await createRenewalCase(customer.id, RenewalCaseStatus.REMINDER_CYCLE);
    const thread = await createThread(customer.id, { renewalCaseId: renewalCase.id });
    const message = await createInboundMessage(thread.id, { customerId: customer.id, renewalCaseId: renewalCase.id });

    const classification = buildClassificationService(() => Promise.resolve(acceptResult()), {
      AI_AUTO_ROUTE_ACCEPT: 'true',
      AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT: '2020-01-01T00:00:00.000Z',
    });
    await classification.classifyMessage(message.id, false);

    const decision = await prisma.aiRoutingDecision.findFirstOrThrow({ where: { renewalCaseId: renewalCase.id } });
    expect(decision.action).toBe(AiRoutingAction.AUTO_ACCEPT);
    expect(decision.status).toBe(AiRoutingStatus.PENDING);

    const routing = buildRoutingService();
    const outcome = await routing.processOne(decision.id);
    expect(outcome).toBe('succeeded');

    const finalCase = await prisma.renewalCase.findUniqueOrThrow({ where: { id: renewalCase.id } });
    expect(finalCase.status).toBe(RenewalCaseStatus.ACCEPTED);
    expect(finalCase.customerDecision).toBe('ACCEPTED');
    expect(finalCase.acceptedAt).not.toBeNull();

    const finalMessage = await prisma.emailMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(finalMessage.classificationStatus).toBe(ClassificationStatus.CLASSIFIED);
    const finalThread = await prisma.communicationThread.findUniqueOrThrow({ where: { id: thread.id } });
    expect(finalThread.status).toBe(ThreadStatus.OPEN);

    const finalDecision = await prisma.aiRoutingDecision.findUniqueOrThrow({ where: { id: decision.id } });
    expect(finalDecision.status).toBe(AiRoutingStatus.SUCCEEDED);
    expect(finalDecision.resultCode).toBe('AUTO_ACCEPTED');

    const auditEvent = await prisma.auditEvent.findFirstOrThrow({ where: { eventKey: 'ai.routing.auto_accepted', subjectId: renewalCase.id } });
    expect(auditEvent.actorType).toBe('AI');
    expect(auditEvent.actorId).toBeNull();
  });

  it('§26/§28.C — concurrent routing workers processing the same PENDING decision: exactly one claims it, the transition applies exactly once', async () => {
    const customer = await createCustomer();
    const { renewalCase } = await createRenewalCase(customer.id, RenewalCaseStatus.REMINDER_CYCLE);
    const thread = await createThread(customer.id, { renewalCaseId: renewalCase.id });
    const message = await createInboundMessage(thread.id, { customerId: customer.id, renewalCaseId: renewalCase.id });
    const classification = buildClassificationService(() => Promise.resolve(acceptResult()), {
      AI_AUTO_ROUTE_ACCEPT: 'true',
      AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT: '2020-01-01T00:00:00.000Z',
    });
    await classification.classifyMessage(message.id, false);
    const decision = await prisma.aiRoutingDecision.findFirstOrThrow({ where: { renewalCaseId: renewalCase.id } });

    const workerA = buildRoutingService();
    const workerB = buildRoutingService();
    const [outcomeA, outcomeB] = await Promise.all([workerA.processOne(decision.id), workerB.processOne(decision.id)]);

    const outcomes = [outcomeA, outcomeB].sort();
    // One genuinely claims and executes; the other observes the row already PROCESSING/terminal.
    expect(outcomes).toContain('succeeded');
    expect(outcomes.filter((o) => o === 'succeeded')).toHaveLength(1);

    const finalCase = await prisma.renewalCase.findUniqueOrThrow({ where: { id: renewalCase.id } });
    expect(finalCase.status).toBe(RenewalCaseStatus.ACCEPTED);
    // A single audit event for the transition — never two.
    const auditEvents = await prisma.auditEvent.findMany({ where: { eventKey: 'ai.routing.auto_accepted', subjectId: renewalCase.id } });
    expect(auditEvents).toHaveLength(1);
  }, 20_000);

  it('§28.A/B — a human business decision that lands first wins; AI auto-accept is safely skipped, never overrides it', async () => {
    const customer = await createCustomer();
    const { renewalCase } = await createRenewalCase(customer.id, RenewalCaseStatus.REMINDER_CYCLE);
    const thread = await createThread(customer.id, { renewalCaseId: renewalCase.id });
    const message = await createInboundMessage(thread.id, { customerId: customer.id, renewalCaseId: renewalCase.id });
    const classification = buildClassificationService(() => Promise.resolve(acceptResult()), {
      AI_AUTO_ROUTE_ACCEPT: 'true',
      AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT: '2020-01-01T00:00:00.000Z',
    });
    await classification.classifyMessage(message.id, false);
    const decision = await prisma.aiRoutingDecision.findFirstOrThrow({ where: { renewalCaseId: renewalCase.id } });

    // The human wins the race outright (deterministic ordering — the mechanism under test is the
    // CAS/guard logic itself, which behaves identically regardless of arrival order).
    const renewalCasesService = buildRenewalCasesService();
    await renewalCasesService.markDoNotRenew(renewalCase.id, { actorId: reviewerId });

    const routing = buildRoutingService();
    const outcome = await routing.processOne(decision.id);

    expect(outcome).toBe('skipped');
    const finalCase = await prisma.renewalCase.findUniqueOrThrow({ where: { id: renewalCase.id } });
    expect(finalCase.status).toBe(RenewalCaseStatus.DO_NOT_RENEW); // never overridden by AI.
    const finalDecision = await prisma.aiRoutingDecision.findUniqueOrThrow({ where: { id: decision.id } });
    expect(finalDecision.resultCode).toBe('SKIPPED_CONCURRENT_BUSINESS_DECISION');
    const finalMessage = await prisma.emailMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(finalMessage.classificationStatus).toBe(ClassificationStatus.HUMAN_REVIEW); // surfaced for attention.
  });

  it('§28.C — a ClassificationReview that lands first wins the shared EmailMessage row; AI auto-accept does NOT execute', async () => {
    const customer = await createCustomer();
    const { renewalCase } = await createRenewalCase(customer.id, RenewalCaseStatus.REMINDER_CYCLE);
    const thread = await createThread(customer.id, { renewalCaseId: renewalCase.id });
    const message = await createInboundMessage(thread.id, { customerId: customer.id, renewalCaseId: renewalCase.id });
    const classification = buildClassificationService(() => Promise.resolve(acceptResult()), {
      AI_AUTO_ROUTE_ACCEPT: 'true',
      AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT: '2020-01-01T00:00:00.000Z',
    });
    await classification.classifyMessage(message.id, false);
    const aiClassification = await prisma.aiClassification.findFirstOrThrow({ where: { emailMessageId: message.id } });
    const decision = await prisma.aiRoutingDecision.findFirstOrThrow({ where: { renewalCaseId: renewalCase.id } });

    const review = buildReviewService();
    await review.createReview({
      emailMessageId: message.id,
      aiClassificationId: aiClassification.id,
      dto: { correctedIntent: AiIntent.REJECT_RENEWAL, notes: 'Actually a rejection.' },
      reviewerId,
    });

    const routing = buildRoutingService();
    const outcome = await routing.processOne(decision.id);

    expect(outcome).toBe('skipped');
    const finalCase = await prisma.renewalCase.findUniqueOrThrow({ where: { id: renewalCase.id } });
    expect(finalCase.status).toBe(RenewalCaseStatus.REMINDER_CYCLE); // AI never touched it.
    const finalDecision = await prisma.aiRoutingDecision.findUniqueOrThrow({ where: { id: decision.id } });
    expect(finalDecision.resultCode).toBe('SKIPPED_HUMAN_ALREADY_REVIEWED');
    const finalMessage = await prisma.emailMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(finalMessage.classificationStatus).toBe(ClassificationStatus.RESOLVED); // never downgraded.
  });

  it('§28.D — AI route wins first: ACCEPT commits, and a LATER human ClassificationReview is still recorded as evidence but never reverses it', async () => {
    const customer = await createCustomer();
    const { renewalCase } = await createRenewalCase(customer.id, RenewalCaseStatus.REMINDER_CYCLE);
    const thread = await createThread(customer.id, { renewalCaseId: renewalCase.id });
    const message = await createInboundMessage(thread.id, { customerId: customer.id, renewalCaseId: renewalCase.id });
    const classification = buildClassificationService(() => Promise.resolve(acceptResult()), {
      AI_AUTO_ROUTE_ACCEPT: 'true',
      AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT: '2020-01-01T00:00:00.000Z',
    });
    await classification.classifyMessage(message.id, false);
    const aiClassification = await prisma.aiClassification.findFirstOrThrow({ where: { emailMessageId: message.id } });
    const decision = await prisma.aiRoutingDecision.findFirstOrThrow({ where: { renewalCaseId: renewalCase.id } });

    const routing = buildRoutingService();
    const routeOutcome = await routing.processOne(decision.id);
    expect(routeOutcome).toBe('succeeded');

    // A human later corrects the classification — this must still be recordable as evidence...
    const review = buildReviewService();
    await expect(
      review.createReview({
        emailMessageId: message.id,
        aiClassificationId: aiClassification.id,
        dto: { correctedIntent: AiIntent.REJECT_RENEWAL, notes: 'Reviewed after the fact.' },
        reviewerId,
      }),
    ).resolves.toBeDefined();

    // ...but it must NEVER automatically reverse the already-executed ACCEPTED transition.
    const finalCase = await prisma.renewalCase.findUniqueOrThrow({ where: { id: renewalCase.id } });
    expect(finalCase.status).toBe(RenewalCaseStatus.ACCEPTED);
  });

  it('§28.E — a superseded (stale) classification never routes once a newer one exists for the same message', async () => {
    const customer = await createCustomer();
    const { renewalCase } = await createRenewalCase(customer.id, RenewalCaseStatus.REMINDER_CYCLE);
    const thread = await createThread(customer.id, { renewalCaseId: renewalCase.id });
    const message = await createInboundMessage(thread.id, { customerId: customer.id, renewalCaseId: renewalCase.id, classificationStatus: ClassificationStatus.RESOLVED });
    const staleClassification = await prisma.aiClassification.create({
      data: {
        emailMessageId: message.id,
        provider: 'mock',
        model: 'mock',
        promptVersion: 'phase3-intent-v1',
        intent: AiIntent.ACCEPT_RENEWAL,
        confidence: '0.960',
        structuredResultJson: acceptResult() as unknown as Prisma.InputJsonValue,
        requiresHumanReview: false,
      },
    });
    // A newer classification for the SAME message, simulating the theoretical multi-classification case.
    await prisma.aiClassification.create({
      data: {
        emailMessageId: message.id,
        provider: 'mock',
        model: 'mock',
        promptVersion: 'phase3-intent-v1',
        intent: AiIntent.ACCEPT_RENEWAL,
        confidence: '0.960',
        structuredResultJson: acceptResult() as unknown as Prisma.InputJsonValue,
        requiresHumanReview: false,
      },
    });
    const staleDecision = await prisma.aiRoutingDecision.create({
      data: { aiClassificationId: staleClassification.id, renewalCaseId: renewalCase.id, routingVersion: 'phase3-routing-v1', action: AiRoutingAction.AUTO_ACCEPT, status: AiRoutingStatus.PENDING },
    });

    const routing = buildRoutingService();
    const outcome = await routing.processOne(staleDecision.id);

    expect(outcome).toBe('skipped');
    const finalDecision = await prisma.aiRoutingDecision.findUniqueOrThrow({ where: { id: staleDecision.id } });
    expect(finalDecision.resultCode).toBe('SKIPPED_CLASSIFICATION_SUPERSEDED');
    const finalCase = await prisma.renewalCase.findUniqueOrThrow({ where: { id: renewalCase.id } });
    expect(finalCase.status).toBe(RenewalCaseStatus.REMINDER_CYCLE);
  });

  it('§29 — HUMAN_REVIEW routing (e.g. REJECT_RENEWAL): message and thread move to HUMAN_REVIEW, RenewalCase never mutated', async () => {
    const customer = await createCustomer();
    const { renewalCase } = await createRenewalCase(customer.id, RenewalCaseStatus.REMINDER_CYCLE);
    const thread = await createThread(customer.id, { renewalCaseId: renewalCase.id });
    const message = await createInboundMessage(thread.id, { customerId: customer.id, renewalCaseId: renewalCase.id });
    const classification = buildClassificationService(() => Promise.resolve(rejectResult()));
    await classification.classifyMessage(message.id, false);

    const decision = await prisma.aiRoutingDecision.findFirstOrThrow({ where: { renewalCaseId: renewalCase.id } });
    expect(decision.action).toBe(AiRoutingAction.HUMAN_REVIEW);
    expect(decision.status).toBe(AiRoutingStatus.PENDING); // classifier itself returned CLASSIFIED (high confidence) — worker execution needed.

    const routing = buildRoutingService();
    const outcome = await routing.processOne(decision.id);
    expect(outcome).toBe('succeeded');

    const finalMessage = await prisma.emailMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(finalMessage.classificationStatus).toBe(ClassificationStatus.HUMAN_REVIEW);
    const finalThread = await prisma.communicationThread.findUniqueOrThrow({ where: { id: thread.id } });
    expect(finalThread.status).toBe(ThreadStatus.HUMAN_REVIEW);
    const finalCase = await prisma.renewalCase.findUniqueOrThrow({ where: { id: renewalCase.id } });
    expect(finalCase.status).toBe(RenewalCaseStatus.REMINDER_CYCLE); // never touched.

    // §30 — no future-phase side effects at all: no operator reply / outbound mail ever created.
    expect(await prisma.operatorReplyOutbox.count({})).toBe(0);
    expect(await prisma.communicationOutbox.count({ where: { renewalCaseId: renewalCase.id } })).toBe(0);
  });

  it('§7 — a classifier-level HUMAN_REVIEW (low confidence) is born already-complete: no worker execution needed, no message/thread mutation by routing itself', async () => {
    const customer = await createCustomer();
    const { renewalCase } = await createRenewalCase(customer.id, RenewalCaseStatus.REMINDER_CYCLE);
    const thread = await createThread(customer.id, { renewalCaseId: renewalCase.id });
    const message = await createInboundMessage(thread.id, { customerId: customer.id, renewalCaseId: renewalCase.id });
    const classification = buildClassificationService(() => Promise.resolve(acceptResult({ confidence: 0.5 })));
    await classification.classifyMessage(message.id, false);

    const decision = await prisma.aiRoutingDecision.findFirstOrThrow({ where: { renewalCaseId: renewalCase.id } });
    expect(decision.action).toBe(AiRoutingAction.HUMAN_REVIEW);
    expect(decision.status).toBe(AiRoutingStatus.SUCCEEDED);
    expect(decision.resultCode).toBe('CLASSIFIER_REQUIRED_HUMAN_REVIEW');
    expect(decision.completedAt).not.toBeNull();

    // The classifier itself already set HUMAN_REVIEW directly — confirm routing created no
    // ADDITIONAL mutation (thread stays OPEN — only a routing-WORKER execution would touch it, and
    // none was needed/triggered here).
    const finalThread = await prisma.communicationThread.findUniqueOrThrow({ where: { id: thread.id } });
    expect(finalThread.status).toBe(ThreadStatus.OPEN);

    // §6 (contract-audit hardening) — even though CommunicationThread.status stays OPEN, prove the
    // thread IS visible/operationally discoverable via the existing Communication Center
    // requires-attention query, driven by EmailMessage.classificationStatus alone.
    const threads = buildThreadsService();
    const attentionList = await threads.list({ page: 1, pageSize: 20 });
    const found = attentionList.data.find((row: { id: string }) => row.id === thread.id);
    expect(found).toBeDefined();
    expect(found?.requiresAttention).toBe(true);
    const filteredList = await threads.list({ page: 1, pageSize: 20, attention: true });
    expect(filteredList.data.some((row: { id: string }) => row.id === thread.id)).toBe(true);
  });

  it('§H/§J/§30 — historical AiClassification with no AiRoutingDecision is invisible to the recovery scanner forever', async () => {
    const customer = await createCustomer();
    const thread = await createThread(customer.id);
    const message = await createInboundMessage(thread.id, { customerId: customer.id, classificationStatus: ClassificationStatus.RESOLVED });
    await prisma.aiClassification.create({
      data: {
        emailMessageId: message.id,
        provider: 'mock',
        model: 'mock',
        promptVersion: 'phase3-intent-v1',
        intent: AiIntent.ACCEPT_RENEWAL,
        confidence: '0.990',
        structuredResultJson: acceptResult() as unknown as Prisma.InputJsonValue,
        requiresHumanReview: false,
      },
    });

    const routing = buildRoutingService();
    const summary = await routing.processBatch();

    expect(summary.candidates).toBe(0);
    expect(await prisma.aiRoutingDecision.count({})).toBe(0);
  });

  it('§6/§F — a config flip (AI_AUTO_ROUTE_ACCEPT false->true) after classification never reinterprets the already-created decision', async () => {
    const customer = await createCustomer();
    const { renewalCase } = await createRenewalCase(customer.id, RenewalCaseStatus.REMINDER_CYCLE);
    const thread = await createThread(customer.id, { renewalCaseId: renewalCase.id });
    const message = await createInboundMessage(thread.id, { customerId: customer.id, renewalCaseId: renewalCase.id });
    // Classified while auto-routing is OFF.
    const classification = buildClassificationService(() => Promise.resolve(acceptResult()), { AI_AUTO_ROUTE_ACCEPT: 'false' });
    await classification.classifyMessage(message.id, false);

    const decision = await prisma.aiRoutingDecision.findFirstOrThrow({ where: { renewalCaseId: renewalCase.id } });
    expect(decision.action).toBe(AiRoutingAction.HUMAN_REVIEW); // snapshotted while OFF.

    // The flag is now flipped ON, but the EXISTING decision must never be reinterpreted.
    const routing = buildRoutingService({ AI_AUTO_ROUTE_ACCEPT: 'true', AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT: '2020-01-01T00:00:00.000Z' });
    const outcome = await routing.processOne(decision.id);

    expect(outcome).toBe('succeeded');
    const finalDecision = await prisma.aiRoutingDecision.findUniqueOrThrow({ where: { id: decision.id } });
    expect(finalDecision.action).toBe(AiRoutingAction.HUMAN_REVIEW); // still never AUTO_ACCEPT.
    const finalCase = await prisma.renewalCase.findUniqueOrThrow({ where: { id: renewalCase.id } });
    expect(finalCase.status).toBe(RenewalCaseStatus.REMINDER_CYCLE); // never auto-accepted retroactively.
  });

  it('contract-audit hardening §2.E — a historical PENDING EmailMessage processed via the normal Slice-D recovery path may still be classified, but Slice-G routing is HUMAN_REVIEW with zero RenewalCase mutation', async () => {
    const customer = await createCustomer();
    const { renewalCase } = await createRenewalCase(customer.id, RenewalCaseStatus.REMINDER_CYCLE);
    const thread = await createThread(customer.id, { renewalCaseId: renewalCase.id });
    // Ingested and occurred well BEFORE the cutover, while AI was disabled — remained PENDING.
    const historicalTimestamp = new Date('2025-06-01T00:00:00.000Z');
    const message = await createInboundMessage(thread.id, {
      customerId: customer.id,
      renewalCaseId: renewalCase.id,
      occurredAt: historicalTimestamp,
      createdAt: historicalTimestamp,
    });
    expect(message.createdAt.getTime()).toBe(historicalTimestamp.getTime());

    // AI is enabled later (cutover in the future relative to the historical message, but in the
    // past relative to "now" when classification actually runs) and the normal Slice-D recovery
    // path picks up this still-PENDING message — modeled here by calling classifyMessage() directly,
    // exactly what AiClassificationWorker.runRecoveryScan()'s re-enqueue ultimately triggers.
    const classification = buildClassificationService(() => Promise.resolve(acceptResult()), {
      AI_AUTO_ROUTE_ACCEPT: 'true',
      AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT: '2026-01-01T00:00:00.000Z',
    });
    const outcome = await classification.classifyMessage(message.id, false);

    expect(outcome).toBe('classified'); // Slice D classification itself is unaffected — it may still occur.
    const decision = await prisma.aiRoutingDecision.findFirstOrThrow({ where: { renewalCaseId: renewalCase.id } });
    expect(decision.action).toBe(AiRoutingAction.HUMAN_REVIEW); // never AUTO_ACCEPT for historical mail.
    expect(decision.status).toBe(AiRoutingStatus.PENDING);

    // Execute the resulting HUMAN_REVIEW routing decision through the worker to close the loop.
    const routing = buildRoutingService({ AI_AUTO_ROUTE_ACCEPT: 'true', AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT: '2026-01-01T00:00:00.000Z' });
    const routeOutcome = await routing.processOne(decision.id);
    expect(routeOutcome).toBe('succeeded');

    const finalMessage = await prisma.emailMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(finalMessage.classificationStatus).toBe(ClassificationStatus.HUMAN_REVIEW);
    const finalCase = await prisma.renewalCase.findUniqueOrThrow({ where: { id: renewalCase.id } });
    expect(finalCase.status).toBe(RenewalCaseStatus.REMINDER_CYCLE); // zero RenewalCase mutation.
  });

  it('contract-audit hardening §5 — the AUTO_ACCEPT execution kill switch: paused while off, resumes normally once restored, action never reinterpreted', async () => {
    const customer = await createCustomer();
    const { renewalCase } = await createRenewalCase(customer.id, RenewalCaseStatus.REMINDER_CYCLE);
    const thread = await createThread(customer.id, { renewalCaseId: renewalCase.id });
    const message = await createInboundMessage(thread.id, { customerId: customer.id, renewalCaseId: renewalCase.id });
    const classification = buildClassificationService(() => Promise.resolve(acceptResult()), {
      AI_AUTO_ROUTE_ACCEPT: 'true',
      AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT: '2020-01-01T00:00:00.000Z',
    });
    await classification.classifyMessage(message.id, false);
    const decision = await prisma.aiRoutingDecision.findFirstOrThrow({ where: { renewalCaseId: renewalCase.id } });
    expect(decision.action).toBe(AiRoutingAction.AUTO_ACCEPT);

    // The switch is paused (e.g. an operator emergency-disables it) before the worker ever runs.
    const pausedRouting = buildRoutingService({ AI_AUTO_ROUTE_ACCEPT: 'false' });
    const pausedOutcome = await pausedRouting.processOne(decision.id);

    expect(pausedOutcome).toBe('paused');
    const pausedDecision = await prisma.aiRoutingDecision.findUniqueOrThrow({ where: { id: decision.id } });
    expect(pausedDecision.status).toBe(AiRoutingStatus.PENDING);
    expect(pausedDecision.action).toBe(AiRoutingAction.AUTO_ACCEPT); // never reinterpreted.
    expect(pausedDecision.attempts).toBe(0);
    const pausedCase = await prisma.renewalCase.findUniqueOrThrow({ where: { id: renewalCase.id } });
    expect(pausedCase.status).toBe(RenewalCaseStatus.REMINDER_CYCLE);

    // The switch is restored — the SAME durable decision resumes normally.
    const resumedRouting = buildRoutingService({ AI_AUTO_ROUTE_ACCEPT: 'true', AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT: '2020-01-01T00:00:00.000Z' });
    const resumedOutcome = await resumedRouting.processOne(decision.id);

    expect(resumedOutcome).toBe('succeeded');
    const finalCase = await prisma.renewalCase.findUniqueOrThrow({ where: { id: renewalCase.id } });
    expect(finalCase.status).toBe(RenewalCaseStatus.ACCEPTED);
  });
});
