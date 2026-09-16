import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import mariadb, { type Connection } from 'mariadb';
import { toMariaDbDriverUrl } from '../src/database/mariadb-url';
import { AuditService } from '../src/audit/audit.service';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  AiIntent,
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
import { AiClassificationWorker } from '../src/modules/ai/ai.worker';
import { AI_RECOVERY_JOB } from '../src/modules/ai/ai-queue.constants';
import { ClassificationReviewService } from '../src/modules/ai/classification-review.service';
import { EffectiveClassificationService } from '../src/modules/ai/effective-classification.service';
import { RESULT_SCHEMA_VERSION } from '../src/modules/ai/llm-gateway';
import type { LlmGateway, NormalizedClassificationResult } from '../src/modules/ai/llm-gateway';
import { readAllMigrationsSql } from './read-all-migrations';

// Live-DB verification (Slice D §28) of invariants a hand-rolled Prisma fake cannot actually prove:
// real CAS enforcement of the PENDING ownership boundary under genuine concurrency (no orphan
// AiClassification ever persisted for a losing worker), and the exact frozen effective-review
// ordering (Rule B) across real rows/timestamps rather than a mocked orderBy assertion.
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

function fakeConfigService(overrides: Record<string, string | number> = {}) {
  const values: Record<string, string | number> = { AI_ENABLED: 'true', AI_PROVIDER: 'mock', NODE_ENV: 'test', ...overrides };
  return { get: (key: string) => values[key] };
}

function validResult(overrides: Partial<NormalizedClassificationResult> = {}): NormalizedClassificationResult {
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

liveDescribe('Phase 3 Slice D MariaDB AI classification integration', () => {
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
        code: `S3D-${randomUUID()}`,
        customerCodePrefix: `S${randomUUID().slice(0, 3).toUpperCase()}`,
        name: 'Slice D Entity',
        legalName: 'Slice D Entity',
        paymentScope: PaymentScope.LOCAL,
      },
    });
    billingEntityId = billingEntity.id;

    const serviceType = await prisma.serviceType.create({
      data: { code: `S3D-ST-${randomUUID()}`, name: 'Slice D Hosting' },
    });
    serviceTypeId = serviceType.id;

    const reviewer = await prisma.user.create({
      data: {
        email: `reviewer-${randomUUID()}@example.test`,
        displayName: 'Slice D Reviewer',
        passwordHash: 'not-a-real-hash',
      },
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
        label: 'Slice D mailbox',
        smtpHost: 'smtp.example.test',
        smtpPort: 587,
        smtpUsername: 'no-reply@example.test',
        imapHost: 'imap.example.test',
        imapPort: 993,
        imapUsername: 'no-reply@example.test',
        imapFolder: 'INBOX',
        fromAddress: 'no-reply@example.test',
        fromName: 'Slice D',
        environment: IntegrationEnvironment.SANDBOX,
        enabled: true,
      },
    });
    mailConfigurationId = mailConfiguration.id;
  });

  afterEach(async () => {
    // audit_events is intentionally NOT cleared — append-only (see Slice C live spec for the same
    // established rationale); rows accumulate for the life of this suite.
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
        customerCode: `S3D-C-${randomUUID()}`,
        nameEn: 'Slice D Customer',
        primaryEmail: email,
        status: CustomerStatus.ACTIVE,
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
        subscriptionCode: `S3D-SUB-${randomUUID()}`,
        name: 'Slice D Subscription',
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

  async function createThread(customerId: string, overrides: { renewalCaseId?: string } = {}) {
    return prisma.communicationThread.create({
      data: {
        customerId,
        renewalCaseId: overrides.renewalCaseId,
        mailConfigurationId,
        subject: 'Renewal',
        status: ThreadStatus.OPEN,
        lastMessageAt: new Date('2026-01-01T00:00:00Z'),
      },
    });
  }

  async function createInboundMessage(
    threadId: string,
    overrides: {
      customerId?: string;
      renewalCaseId?: string;
      classificationStatus?: ClassificationStatus | null;
      bodyText?: string;
      occurredAt?: Date;
    } = {},
  ) {
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
        bodyText: overrides.bodyText ?? 'yes please renew',
        occurredAt: overrides.occurredAt ?? new Date('2026-01-01T00:00:00Z'),
        mailConfigurationId,
      },
    });
  }

  async function createOutboundMessage(threadId: string, overrides: { occurredAt?: Date } = {}) {
    return prisma.emailMessage.create({
      data: {
        threadId,
        direction: MessageDirection.OUTBOUND,
        classificationStatus: null,
        subject: 'Renewal notice',
        fromAddress: 'no-reply@example.test',
        toAddressesJson: ['customer@example.test'],
        bodyText: 'Your renewal is due.',
        occurredAt: overrides.occurredAt ?? new Date('2025-12-31T00:00:00Z'),
        mailConfigurationId,
      },
    });
  }

  function buildClassificationService(
    classifyIntentImpl: (input: unknown) => Promise<NormalizedClassificationResult>,
    configOverrides: Record<string, string | number> = {},
  ) {
    const gateway: LlmGateway = { classifyIntent: classifyIntentImpl };
    return new AiClassificationService(
      prisma as never,
      fakeConfigService(configOverrides) as never,
      new AuditService(prisma as never),
      new AiHealthService(prisma as never),
      gateway,
    );
  }

  function buildReviewService() {
    return new ClassificationReviewService(prisma as never, new AuditService(prisma as never));
  }

  function buildEffectiveService() {
    return new EffectiveClassificationService(prisma as never);
  }

  // -------------------------------------------------------------------------------------------
  // A/B — concurrent persistence CAS: exactly one AiClassification, no orphan on the losing side.
  // -------------------------------------------------------------------------------------------

  it('A/B — two concurrent classification attempts on the same PENDING message persist exactly ONE AiClassification', async () => {
    const customer = await createCustomer();
    const thread = await createThread(customer.id);
    const emailMessage = await createInboundMessage(thread.id, { customerId: customer.id });

    const serviceA = buildClassificationService(() => Promise.resolve(validResult()));
    const serviceB = buildClassificationService(() => Promise.resolve(validResult()));

    const [outcomeA, outcomeB] = await Promise.all([
      serviceA.classifyMessage(emailMessage.id, false),
      serviceB.classifyMessage(emailMessage.id, false),
    ]);

    const outcomes = [outcomeA, outcomeB].sort();
    expect(outcomes).toEqual(['classified', 'lost_cas']);

    const classifications = await prisma.aiClassification.findMany({ where: { emailMessageId: emailMessage.id } });
    expect(classifications).toHaveLength(1); // no orphan row for the losing worker (§28B).

    const reloadedMessage = await prisma.emailMessage.findUniqueOrThrow({ where: { id: emailMessage.id } });
    expect(reloadedMessage.classificationStatus).toBe(ClassificationStatus.CLASSIFIED);
  });

  // -------------------------------------------------------------------------------------------
  // C/D/E — final status decision rules against a real row.
  // -------------------------------------------------------------------------------------------

  it('C — a valid high-confidence result -> EmailMessage CLASSIFIED', async () => {
    const customer = await createCustomer();
    const thread = await createThread(customer.id);
    const emailMessage = await createInboundMessage(thread.id, { customerId: customer.id });
    const service = buildClassificationService(() => Promise.resolve(validResult({ confidence: 0.95 })));

    const outcome = await service.classifyMessage(emailMessage.id, false);

    expect(outcome).toBe('classified');
    const reloaded = await prisma.emailMessage.findUniqueOrThrow({ where: { id: emailMessage.id } });
    expect(reloaded.classificationStatus).toBe(ClassificationStatus.CLASSIFIED);
  });

  it('D — a valid low-confidence result (below threshold) -> EmailMessage HUMAN_REVIEW', async () => {
    const customer = await createCustomer();
    const thread = await createThread(customer.id);
    const emailMessage = await createInboundMessage(thread.id, { customerId: customer.id });
    const service = buildClassificationService(() => Promise.resolve(validResult({ confidence: 0.5 })));

    const outcome = await service.classifyMessage(emailMessage.id, false);

    expect(outcome).toBe('human_review');
    const reloaded = await prisma.emailMessage.findUniqueOrThrow({ where: { id: emailMessage.id } });
    expect(reloaded.classificationStatus).toBe(ClassificationStatus.HUMAN_REVIEW);
  });

  it('E — UNCLEAR at high confidence still -> EmailMessage HUMAN_REVIEW', async () => {
    const customer = await createCustomer();
    const thread = await createThread(customer.id);
    const emailMessage = await createInboundMessage(thread.id, { customerId: customer.id });
    const service = buildClassificationService(() =>
      Promise.resolve(validResult({ intent: AiIntent.UNCLEAR, confidence: 0.99, requiresHumanReview: true })),
    );

    const outcome = await service.classifyMessage(emailMessage.id, false);

    expect(outcome).toBe('human_review');
    const classification = await prisma.aiClassification.findFirstOrThrow({ where: { emailMessageId: emailMessage.id } });
    expect(classification.intent).toBe(AiIntent.UNCLEAR);
    const reloaded = await prisma.emailMessage.findUniqueOrThrow({ where: { id: emailMessage.id } });
    expect(reloaded.classificationStatus).toBe(ClassificationStatus.HUMAN_REVIEW);
  });

  // -------------------------------------------------------------------------------------------
  // F/G — append-only review behavior.
  // -------------------------------------------------------------------------------------------

  it('F — appending a ClassificationReview never mutates the AiClassification, creates one review row, and resolves the message', async () => {
    const customer = await createCustomer();
    const thread = await createThread(customer.id);
    const emailMessage = await createInboundMessage(thread.id, { customerId: customer.id });
    const classificationService = buildClassificationService(() => Promise.resolve(validResult()));
    await classificationService.classifyMessage(emailMessage.id, false);
    const classification = await prisma.aiClassification.findFirstOrThrow({ where: { emailMessageId: emailMessage.id } });

    const reviewService = buildReviewService();
    const review = await reviewService.createReview({
      emailMessageId: emailMessage.id,
      aiClassificationId: classification.id,
      dto: { correctedIntent: AiIntent.REJECT_RENEWAL, summary: 'Customer actually declined.' },
      reviewerId,
    });

    expect(review.id).toBeTruthy();
    const reviews = await prisma.classificationReview.findMany({ where: { aiClassificationId: classification.id } });
    expect(reviews).toHaveLength(1);

    const reloadedClassification = await prisma.aiClassification.findUniqueOrThrow({ where: { id: classification.id } });
    expect(reloadedClassification.intent).toBe(classification.intent); // immutable evidence, never mutated.
    expect(reloadedClassification.confidence.toString()).toBe(classification.confidence.toString());

    const reloadedMessage = await prisma.emailMessage.findUniqueOrThrow({ where: { id: emailMessage.id } });
    expect(reloadedMessage.classificationStatus).toBe(ClassificationStatus.RESOLVED);
  });

  it('G — a second review does not remove/replace the first; both persist, latest is effective', async () => {
    const customer = await createCustomer();
    const thread = await createThread(customer.id);
    const emailMessage = await createInboundMessage(thread.id, { customerId: customer.id });
    const classificationService = buildClassificationService(() => Promise.resolve(validResult()));
    await classificationService.classifyMessage(emailMessage.id, false);
    const classification = await prisma.aiClassification.findFirstOrThrow({ where: { emailMessageId: emailMessage.id } });
    const reviewService = buildReviewService();

    const firstReview = await reviewService.createReview({
      emailMessageId: emailMessage.id,
      aiClassificationId: classification.id,
      dto: { correctedIntent: AiIntent.REJECT_RENEWAL },
      reviewerId,
    });
    const secondReview = await reviewService.createReview({
      emailMessageId: emailMessage.id,
      aiClassificationId: classification.id,
      dto: { correctedIntent: AiIntent.COMPLAINT },
      reviewerId,
    });

    const reviews = await prisma.classificationReview.findMany({ where: { aiClassificationId: classification.id } });
    expect(reviews).toHaveLength(2);
    const persistedFirst = reviews.find((r) => r.id === firstReview.id);
    expect(persistedFirst?.correctedIntent).toBe(AiIntent.REJECT_RENEWAL); // untouched by the second append.

    const effective = await buildEffectiveService().getEffectiveClassification(emailMessage.id);
    expect(effective.source).toBe('HUMAN_REVIEW');
    expect(effective.reviewId).toBe(secondReview.id);
    expect(effective.effectiveIntent).toBe(AiIntent.COMPLAINT);

    const reloadedMessage = await prisma.emailMessage.findUniqueOrThrow({ where: { id: emailMessage.id } });
    expect(reloadedMessage.classificationStatus).toBe(ClassificationStatus.RESOLVED); // still RESOLVED.
  });

  // -------------------------------------------------------------------------------------------
  // H/I — effective-classification resolver: the frozen ordering rules (§22/§36) against real rows.
  // -------------------------------------------------------------------------------------------

  it('H — a review on an OLDER AiClassification, created AFTER a NEWER classification with no review, is still effective (never ordered by aiClassificationId)', async () => {
    const customer = await createCustomer();
    const thread = await createThread(customer.id);
    const emailMessage = await createInboundMessage(thread.id, { customerId: customer.id, classificationStatus: null });

    const olderClassification = await prisma.aiClassification.create({
      data: {
        emailMessageId: emailMessage.id,
        provider: 'mock',
        model: 'mock',
        promptVersion: 'phase3-intent-v1',
        intent: AiIntent.ACCEPT_RENEWAL,
        confidence: '0.960',
        structuredResultJson: validResult() as never,
        requiresHumanReview: false,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    });
    const newerClassification = await prisma.aiClassification.create({
      data: {
        emailMessageId: emailMessage.id,
        provider: 'mock',
        model: 'mock',
        promptVersion: 'phase3-intent-v1',
        intent: AiIntent.OTHER,
        confidence: '0.850',
        structuredResultJson: validResult({ intent: AiIntent.OTHER, confidence: 0.85 }) as never,
        requiresHumanReview: false,
        createdAt: new Date('2026-01-02T00:00:00Z'),
      },
    });

    // The review targets the OLDER classification but is itself created chronologically AFTER the
    // newer classification row — Rule B orders by review.createdAt/id, never by aiClassificationId.
    const lateReview = await prisma.classificationReview.create({
      data: {
        aiClassificationId: olderClassification.id,
        reviewerId,
        correctedIntent: AiIntent.PRICE_DISPUTE,
        correctedResultJson: { schemaVersion: 'phase3-review-v1', intent: AiIntent.PRICE_DISPUTE },
        createdAt: new Date('2026-01-03T00:00:00Z'),
      },
    });

    const effective = await buildEffectiveService().getEffectiveClassification(emailMessage.id);
    expect(effective.source).toBe('HUMAN_REVIEW');
    expect(effective.reviewId).toBe(lateReview.id);
    expect(effective.aiClassificationId).toBe(olderClassification.id); // the OLDER classification's review wins.
    expect(effective.effectiveIntent).toBe(AiIntent.PRICE_DISPUTE);
    expect(newerClassification.id).not.toBe(olderClassification.id);
  });

  it('I — no review anywhere on the message -> newest AiClassification by createdAt/id is effective', async () => {
    const customer = await createCustomer();
    const thread = await createThread(customer.id);
    const emailMessage = await createInboundMessage(thread.id, { customerId: customer.id, classificationStatus: null });

    await prisma.aiClassification.create({
      data: {
        emailMessageId: emailMessage.id,
        provider: 'mock',
        model: 'mock',
        promptVersion: 'phase3-intent-v1',
        intent: AiIntent.ACCEPT_RENEWAL,
        confidence: '0.960',
        structuredResultJson: validResult() as never,
        requiresHumanReview: false,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    });
    const newest = await prisma.aiClassification.create({
      data: {
        emailMessageId: emailMessage.id,
        provider: 'mock',
        model: 'mock',
        promptVersion: 'phase3-intent-v1',
        intent: AiIntent.COMPLAINT,
        confidence: '0.900',
        structuredResultJson: validResult({ intent: AiIntent.COMPLAINT, confidence: 0.9 }) as never,
        requiresHumanReview: false,
        createdAt: new Date('2026-01-02T00:00:00Z'),
      },
    });

    const effective = await buildEffectiveService().getEffectiveClassification(emailMessage.id);
    expect(effective.source).toBe('AI');
    expect(effective.aiClassificationId).toBe(newest.id);
    expect(effective.effectiveIntent).toBe(AiIntent.COMPLAINT);
  });

  // -------------------------------------------------------------------------------------------
  // J/K — eligibility boundaries.
  // -------------------------------------------------------------------------------------------

  it('J — an OUTBOUND EmailMessage is never automatically classified', async () => {
    const customer = await createCustomer();
    const thread = await createThread(customer.id);
    const outbound = await createOutboundMessage(thread.id);
    const service = buildClassificationService(() => Promise.resolve(validResult()));

    const outcome = await service.classifyMessage(outbound.id, false);

    expect(outcome).toBe('skipped_ineligible');
    const count = await prisma.aiClassification.count({ where: { emailMessageId: outbound.id } });
    expect(count).toBe(0);
  });

  it('K — a Slice-C HUMAN_REVIEW inbound message is never overwritten back to CLASSIFIED by AI', async () => {
    const customer = await createCustomer();
    const thread = await createThread(customer.id);
    const emailMessage = await createInboundMessage(thread.id, {
      customerId: customer.id,
      classificationStatus: ClassificationStatus.HUMAN_REVIEW,
    });
    const service = buildClassificationService(() => Promise.resolve(validResult()));

    const outcome = await service.classifyMessage(emailMessage.id, false);

    expect(outcome).toBe('skipped_ineligible');
    const reloaded = await prisma.emailMessage.findUniqueOrThrow({ where: { id: emailMessage.id } });
    expect(reloaded.classificationStatus).toBe(ClassificationStatus.HUMAN_REVIEW); // untouched.
    const count = await prisma.aiClassification.count({ where: { emailMessageId: emailMessage.id } });
    expect(count).toBe(0);
  });

  // -------------------------------------------------------------------------------------------
  // L — no business-object mutation from classification or review.
  // -------------------------------------------------------------------------------------------

  it('L — classification and review never change RenewalCase or Subscription status', async () => {
    const customer = await createCustomer();
    const { subscription, renewalCase } = await createRenewalCase(customer.id);
    const thread = await createThread(customer.id, { renewalCaseId: renewalCase.id });
    const emailMessage = await createInboundMessage(thread.id, { customerId: customer.id, renewalCaseId: renewalCase.id });

    const classificationService = buildClassificationService(() =>
      Promise.resolve(validResult({ intent: AiIntent.ACCEPT_RENEWAL, confidence: 0.97 })),
    );
    await classificationService.classifyMessage(emailMessage.id, false);
    const classification = await prisma.aiClassification.findFirstOrThrow({ where: { emailMessageId: emailMessage.id } });

    await buildReviewService().createReview({
      emailMessageId: emailMessage.id,
      aiClassificationId: classification.id,
      dto: { correctedIntent: AiIntent.REJECT_RENEWAL },
      reviewerId,
    });

    const reloadedCase = await prisma.renewalCase.findUniqueOrThrow({ where: { id: renewalCase.id } });
    expect(reloadedCase.status).toBe(RenewalCaseStatus.REMINDER_CYCLE); // unchanged by ACCEPT_RENEWAL classification or review.
    const reloadedSubscription = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(reloadedSubscription.status).toBe(SubscriptionStatus.ACTIVE); // unchanged.
  });

  // -------------------------------------------------------------------------------------------
  // Hardening pass §2 — AI-disabled mail is never stranded; recovery finds it once AI is enabled.
  // -------------------------------------------------------------------------------------------

  it('AI disabled at commit time never strands PENDING mail; enabling AI later lets recovery discover and classify it', async () => {
    const customer = await createCustomer();
    const thread = await createThread(customer.id);
    const emailMessage = await createInboundMessage(thread.id, { customerId: customer.id });
    const fakeEnqueue = { enqueueIfEnabled: jest.fn(() => Promise.resolve()) };

    // While AI is disabled, a recovery scan must be a true no-op — no queue identity is ever
    // established for this message, so nothing could ever "block" a later real enqueue.
    const disabledWorker = new AiClassificationWorker(
      buildClassificationService(() => Promise.resolve(validResult())),
      fakeEnqueue as never,
      prisma as never,
      fakeConfigService({ AI_ENABLED: 'false' }) as never,
    );
    const disabledScan = await disabledWorker.process({
      name: AI_RECOVERY_JOB,
      data: { trigger: 'scheduled' },
      attemptsMade: 0,
      opts: { attempts: 1 },
    } as never);
    expect(disabledScan).toEqual({ scanned: 0 });
    expect(fakeEnqueue.enqueueIfEnabled).not.toHaveBeenCalled();
    const stillPending = await prisma.emailMessage.findUniqueOrThrow({ where: { id: emailMessage.id } });
    expect(stillPending.classificationStatus).toBe(ClassificationStatus.PENDING); // never mutated.

    // AI is now enabled (e.g. the application was reconfigured/restarted) and the next scheduled
    // recovery-scan tick fires — it must discover this historical PENDING message.
    const enabledWorker = new AiClassificationWorker(
      buildClassificationService(() => Promise.resolve(validResult())),
      fakeEnqueue as never,
      prisma as never,
      fakeConfigService({ AI_ENABLED: 'true' }) as never,
    );
    const enabledScan = await enabledWorker.process({
      name: AI_RECOVERY_JOB,
      data: { trigger: 'scheduled' },
      attemptsMade: 0,
      opts: { attempts: 1 },
    } as never);
    expect(enabledScan).toEqual({ scanned: 1 });
    expect(fakeEnqueue.enqueueIfEnabled).toHaveBeenCalledWith(emailMessage.id);

    // Simulates the BullMQ worker actually processing the job the recovery scan would have
    // enqueued — classification proceeds normally, exactly as if nothing had ever been disabled.
    const classificationService = buildClassificationService(() => Promise.resolve(validResult({ confidence: 0.97 })));
    const outcome = await classificationService.classifyMessage(emailMessage.id, false);
    expect(outcome).toBe('classified');
    const reloaded = await prisma.emailMessage.findUniqueOrThrow({ where: { id: emailMessage.id } });
    expect(reloaded.classificationStatus).toBe(ClassificationStatus.CLASSIFIED);
  });
});
