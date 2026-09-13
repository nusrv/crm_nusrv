import { randomUUID } from 'node:crypto';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import mariadb, { type Connection } from 'mariadb';
import { toMariaDbDriverUrl } from '../src/database/mariadb-url';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  ActorType,
  BillingFrequency,
  IntegrationEnvironment,
  PaymentScope,
  ReminderAudience,
} from '../src/generated/prisma/enums';
import { readAllMigrationsSql } from './read-all-migrations';

// Live-DB verification of every Slice A schema/constraint invariant that the OTHER live suites
// don't touch (those only prove the migration applies and existing Phase 0-2.2 behavior is
// unaffected — see mariadb-live.spec.ts etc.). This file exercises the six new tables directly:
// no mocks, real MariaDB constraint enforcement only.
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

liveDescribe('Phase 3 Slice A MariaDB communication-domain integration', () => {
  let connection: Connection;
  let prisma: PrismaClient;
  let billingEntityId: string;
  let customerId: string;
  let renewalCaseId: string;
  let subscriptionId: string;
  let mailConfigurationId: string;
  let userId: string;

  beforeAll(async () => {
    const url = databaseUrl as string;
    connection = await mariadb.createConnection(options(url));
    await reset(connection);
    await connection.query(migrations);
    prisma = new PrismaClient({ adapter: new PrismaMariaDb(toMariaDbDriverUrl(url)) });

    const billingEntity = await prisma.billingEntity.create({
      data: {
        code: `S3A-${randomUUID()}`,
        customerCodePrefix: `S${randomUUID().slice(0, 3).toUpperCase()}`,
        name: 'Slice A Entity',
        legalName: 'Slice A Entity',
        paymentScope: PaymentScope.LOCAL,
      },
    });
    billingEntityId = billingEntity.id;

    const customer = await prisma.customer.create({
      data: {
        billingEntityId,
        customerCode: `S3A-C-${randomUUID()}`,
        nameEn: 'Slice A Customer',
        primaryEmail: `${randomUUID()}@example.test`,
      },
    });
    customerId = customer.id;

    const serviceType = await prisma.serviceType.create({
      data: { code: `S3A-ST-${randomUUID()}`, name: 'Slice A Hosting' },
    });

    const subscription = await prisma.subscription.create({
      data: {
        customerId,
        serviceTypeId: serviceType.id,
        subscriptionCode: `S3A-SUB-${randomUUID()}`,
        name: 'Slice A Subscription',
        startDate: new Date('2026-01-01T00:00:00Z'),
        renewalDate: new Date('2027-01-01T00:00:00Z'),
        billingFrequency: BillingFrequency.ANNUAL,
        sellingPrice: '100.000',
        currency: 'JOD',
      },
    });
    subscriptionId = subscription.id;

    const renewalCase = await prisma.renewalCase.create({
      data: {
        subscriptionId,
        cycleStartDate: new Date('2026-01-01T00:00:00Z'),
        dueDate: new Date('2027-01-01T00:00:00Z'),
      },
    });
    renewalCaseId = renewalCase.id;

    const mailConfiguration = await prisma.mailConfiguration.create({
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
        fromName: 'Slice A',
        environment: IntegrationEnvironment.SANDBOX,
      },
    });
    mailConfigurationId = mailConfiguration.id;

    const user = await prisma.user.create({
      data: {
        email: `s3a-reviewer-${randomUUID()}@example.test`,
        displayName: 'Slice A Reviewer',
        passwordHash: 'test-hash',
      },
    });
    userId = user.id;
  }, 30_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    if (connection) {
      await reset(connection);
      await connection.end();
    }
  }, 30_000);

  // ----------------------------------------------------------------------------------------
  // B. Existing CommunicationOutbox rows remain valid with emailMessageId/messageIdHeader NULL
  // ----------------------------------------------------------------------------------------
  it('B: a CommunicationOutbox row created the existing (pre-Slice-A) way has NULL emailMessageId and messageIdHeader', async () => {
    const auditEvent = await prisma.auditEvent.create({
      data: {
        actorType: ActorType.SYSTEM,
        eventKey: 'test.outbox.created',
        subjectType: 'RenewalCase',
        subjectId: renewalCaseId,
      },
    });
    const outbox = await prisma.communicationOutbox.create({
      data: {
        customerId,
        subscriptionId,
        renewalCaseId,
        auditEventId: auditEvent.id,
        audience: ReminderAudience.CUSTOMER,
        recipient: 'customer@example.test',
        subject: 'Renewal reminder',
        body: 'Body',
        daysBeforeDue: 30,
        scheduledAt: new Date(),
        idempotencyKey: `test:${randomUUID()}`,
      },
    });
    expect(outbox.emailMessageId).toBeNull();
    expect(outbox.messageIdHeader).toBeNull();
  });

  // ----------------------------------------------------------------------------------------
  // C. CommunicationThread: two rows with renewalCaseId = NULL are both allowed
  // ----------------------------------------------------------------------------------------
  it('C: two unattributed CommunicationThread rows (renewalCaseId NULL) can coexist', async () => {
    const threadA = await prisma.communicationThread.create({
      data: {
        mailConfigurationId,
        subject: 'Unattributed A',
        lastMessageAt: new Date(),
      },
    });
    const threadB = await prisma.communicationThread.create({
      data: {
        mailConfigurationId,
        subject: 'Unattributed B',
        lastMessageAt: new Date(),
      },
    });
    expect(threadA.renewalCaseId).toBeNull();
    expect(threadB.renewalCaseId).toBeNull();
    expect(threadA.id).not.toBe(threadB.id);
  });

  // ----------------------------------------------------------------------------------------
  // D. CommunicationThread: two rows with the SAME non-null renewalCaseId are rejected
  // ----------------------------------------------------------------------------------------
  it('D: a second CommunicationThread for the same RenewalCase is rejected by the UNIQUE constraint', async () => {
    await prisma.communicationThread.create({
      data: {
        customerId,
        renewalCaseId,
        mailConfigurationId,
        subject: 'Canonical thread',
        lastMessageAt: new Date(),
      },
    });
    await expect(
      prisma.communicationThread.create({
        data: {
          customerId,
          renewalCaseId,
          mailConfigurationId,
          subject: 'Duplicate canonical thread',
          lastMessageAt: new Date(),
        },
      }),
    ).rejects.toThrow();
  });

  // ----------------------------------------------------------------------------------------
  // E. MailConfiguration: duplicate scopeKey GLOBAL rejected
  // ----------------------------------------------------------------------------------------
  it('E: a second GLOBAL MailConfiguration is rejected (scopeKey UNIQUE)', async () => {
    await expect(
      prisma.mailConfiguration.create({
        data: {
          scopeKey: 'GLOBAL',
          label: 'Second global mailbox',
          smtpHost: 'smtp2.example.test',
          smtpPort: 587,
          smtpUsername: 'other@example.test',
          imapHost: 'imap2.example.test',
          imapPort: 993,
          imapUsername: 'other@example.test',
          fromAddress: 'other@example.test',
          fromName: 'Duplicate Global',
        },
      }),
    ).rejects.toThrow();
  });

  // ----------------------------------------------------------------------------------------
  // F. MailConfiguration: duplicate BILLING_ENTITY:<same-id> scope rejected
  // ----------------------------------------------------------------------------------------
  it('F: two MailConfigurations for the same BillingEntity are rejected (scopeKey UNIQUE)', async () => {
    const scopeKey = `BILLING_ENTITY:${billingEntityId}`;
    await prisma.mailConfiguration.create({
      data: {
        billingEntityId,
        scopeKey,
        label: 'Entity mailbox',
        smtpHost: 'smtp3.example.test',
        smtpPort: 587,
        smtpUsername: 'entity@example.test',
        imapHost: 'imap3.example.test',
        imapPort: 993,
        imapUsername: 'entity@example.test',
        fromAddress: 'entity@example.test',
        fromName: 'Entity Mailbox',
      },
    });
    await expect(
      prisma.mailConfiguration.create({
        data: {
          billingEntityId,
          scopeKey,
          label: 'Duplicate entity mailbox',
          smtpHost: 'smtp4.example.test',
          smtpPort: 587,
          smtpUsername: 'entity2@example.test',
          imapHost: 'imap4.example.test',
          imapPort: 993,
          imapUsername: 'entity2@example.test',
          fromAddress: 'entity2@example.test',
          fromName: 'Duplicate Entity Mailbox',
        },
      }),
    ).rejects.toThrow();
  });

  // ----------------------------------------------------------------------------------------
  // G. BillingEntity delete is restricted while a MailConfiguration references it
  // ----------------------------------------------------------------------------------------
  it('G: deleting a BillingEntity referenced by a MailConfiguration is restricted, never silently SET NULL', async () => {
    const entity = await prisma.billingEntity.create({
      data: {
        code: `S3A-DEL-${randomUUID()}`,
        customerCodePrefix: `D${randomUUID().slice(0, 3).toUpperCase()}`,
        name: 'Deletable Entity',
        legalName: 'Deletable Entity',
        paymentScope: PaymentScope.LOCAL,
      },
    });
    await prisma.mailConfiguration.create({
      data: {
        billingEntityId: entity.id,
        scopeKey: `BILLING_ENTITY:${entity.id}`,
        label: 'Restrict-check mailbox',
        smtpHost: 'smtp5.example.test',
        smtpPort: 587,
        smtpUsername: 'restrict@example.test',
        imapHost: 'imap5.example.test',
        imapPort: 993,
        imapUsername: 'restrict@example.test',
        fromAddress: 'restrict@example.test',
        fromName: 'Restrict Check',
      },
    });
    await expect(prisma.billingEntity.delete({ where: { id: entity.id } })).rejects.toThrow();
  });

  // ----------------------------------------------------------------------------------------
  // H / I. EmailMessage imapIdentityKey: multiple NULLs allowed (outbound), duplicate non-null rejected
  // ----------------------------------------------------------------------------------------
  it('H: two OUTBOUND EmailMessage rows with imapIdentityKey NULL can coexist', async () => {
    const thread = await prisma.communicationThread.create({
      data: { mailConfigurationId, subject: 'Outbound thread', lastMessageAt: new Date() },
    });
    const base = {
      threadId: thread.id,
      mailConfigurationId,
      direction: 'OUTBOUND' as const,
      subject: 'Reply',
      fromAddress: 'no-reply@example.test',
      toAddressesJson: ['customer@example.test'],
      bodyText: 'Body',
      occurredAt: new Date(),
    };
    const messageA = await prisma.emailMessage.create({ data: base });
    const messageB = await prisma.emailMessage.create({ data: base });
    expect(messageA.imapIdentityKey).toBeNull();
    expect(messageB.imapIdentityKey).toBeNull();
  });

  it('I: a second EmailMessage with the same non-null imapIdentityKey is rejected', async () => {
    const thread = await prisma.communicationThread.create({
      data: { mailConfigurationId, subject: 'Inbound dedup thread', lastMessageAt: new Date() },
    });
    const identityKey = `key-${randomUUID()}`;
    const base = {
      threadId: thread.id,
      mailConfigurationId,
      direction: 'INBOUND' as const,
      subject: 'Inbound',
      fromAddress: 'customer@example.test',
      toAddressesJson: ['no-reply@example.test'],
      bodyText: 'Body',
      occurredAt: new Date(),
      imapIdentityKey: identityKey,
    };
    await prisma.emailMessage.create({ data: base });
    await expect(prisma.emailMessage.create({ data: base })).rejects.toThrow();
  });

  // ----------------------------------------------------------------------------------------
  // J. EmailMessage: same externalMessageId on two distinct rows is allowed (non-unique)
  // ----------------------------------------------------------------------------------------
  it('J: two EmailMessage rows sharing the same (duplicated/malformed) externalMessageId are both accepted', async () => {
    const thread = await prisma.communicationThread.create({
      data: { mailConfigurationId, subject: 'Broken sender thread', lastMessageAt: new Date() },
    });
    const sharedMessageId = '<broken-sender-reused-id@example.test>';
    const base = {
      threadId: thread.id,
      mailConfigurationId,
      direction: 'INBOUND' as const,
      subject: 'Inbound',
      fromAddress: 'customer@example.test',
      toAddressesJson: ['no-reply@example.test'],
      bodyText: 'Body',
      occurredAt: new Date(),
      externalMessageId: sharedMessageId,
    };
    const messageA = await prisma.emailMessage.create({ data: base });
    const messageB = await prisma.emailMessage.create({ data: base });
    expect(messageA.externalMessageId).toBe(sharedMessageId);
    expect(messageB.externalMessageId).toBe(sharedMessageId);
    expect(messageA.id).not.toBe(messageB.id);
  });

  // ----------------------------------------------------------------------------------------
  // K. ClassificationReview: multiple rows for the same message/classification are allowed
  // ----------------------------------------------------------------------------------------
  it('K: multiple ClassificationReview rows for the same AiClassification/EmailMessage are allowed (append-only)', async () => {
    const thread = await prisma.communicationThread.create({
      data: { mailConfigurationId, subject: 'Review thread', lastMessageAt: new Date() },
    });
    const message = await prisma.emailMessage.create({
      data: {
        threadId: thread.id,
        mailConfigurationId,
        direction: 'INBOUND',
        subject: 'Inbound',
        fromAddress: 'customer@example.test',
        toAddressesJson: ['no-reply@example.test'],
        bodyText: 'Body',
        occurredAt: new Date(),
      },
    });
    const classification = await prisma.aiClassification.create({
      data: {
        emailMessageId: message.id,
        provider: 'test-provider',
        model: 'test-model',
        promptVersion: 'v1',
        intent: 'ACCEPT_RENEWAL',
        confidence: '0.900',
        structuredResultJson: { intent: 'ACCEPT_RENEWAL' },
      },
    });
    const reviewA = await prisma.classificationReview.create({
      data: {
        aiClassificationId: classification.id,
        reviewerId: userId,
        correctedIntent: 'ACCEPT_RENEWAL',
        correctedResultJson: { intent: 'ACCEPT_RENEWAL' },
      },
    });
    const reviewB = await prisma.classificationReview.create({
      data: {
        aiClassificationId: classification.id,
        reviewerId: userId,
        correctedIntent: 'REQUEST_CLARIFICATION',
        correctedResultJson: { intent: 'REQUEST_CLARIFICATION' },
        notes: 'Reconsidered after a follow-up call.',
      },
    });
    // "Reviews for this message" is now obtained ONLY by joining through the classification —
    // there is no independent emailMessageId column on ClassificationReview to filter by directly.
    const reviews = await prisma.classificationReview.findMany({
      where: { aiClassification: { emailMessageId: message.id } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(reviews).toHaveLength(2);
    expect(reviews.map((r) => r.id)).toEqual(expect.arrayContaining([reviewA.id, reviewB.id]));
    // The original AiClassification is never mutated by a review.
    const reloadedClassification = await prisma.aiClassification.findUniqueOrThrow({
      where: { id: classification.id },
    });
    expect(reloadedClassification.intent).toBe('ACCEPT_RENEWAL');
  });

  // ----------------------------------------------------------------------------------------
  // L. FK protections
  // ----------------------------------------------------------------------------------------
  it('L1: an AiClassification cannot be created against a non-existent EmailMessage', async () => {
    await expect(
      prisma.aiClassification.create({
        data: {
          emailMessageId: randomUUID(),
          provider: 'test-provider',
          model: 'test-model',
          promptVersion: 'v1',
          intent: 'OTHER',
          confidence: '0.500',
          structuredResultJson: {},
        },
      }),
    ).rejects.toThrow();
  });

  it('L2: a ClassificationReview cannot be created against a non-existent classification or reviewer', async () => {
    const thread = await prisma.communicationThread.create({
      data: { mailConfigurationId, subject: 'FK check thread', lastMessageAt: new Date() },
    });
    const message = await prisma.emailMessage.create({
      data: {
        threadId: thread.id,
        mailConfigurationId,
        direction: 'INBOUND',
        subject: 'Inbound',
        fromAddress: 'customer@example.test',
        toAddressesJson: ['no-reply@example.test'],
        bodyText: 'Body',
        occurredAt: new Date(),
      },
    });
    const classification = await prisma.aiClassification.create({
      data: {
        emailMessageId: message.id,
        provider: 'test-provider',
        model: 'test-model',
        promptVersion: 'v1',
        intent: 'OTHER',
        confidence: '0.500',
        structuredResultJson: {},
      },
    });

    await expect(
      prisma.classificationReview.create({
        data: {
          aiClassificationId: randomUUID(),
          reviewerId: userId,
          correctedIntent: 'OTHER',
          correctedResultJson: {},
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.classificationReview.create({
        data: {
          aiClassificationId: classification.id,
          reviewerId: randomUUID(),
          correctedIntent: 'OTHER',
          correctedResultJson: {},
        },
      }),
    ).rejects.toThrow();
  });

  // ----------------------------------------------------------------------------------------
  // Referential-integrity fix: ClassificationReview can no longer independently point to a
  // different message than its own AiClassification (the emailMessageId column was removed).
  // ----------------------------------------------------------------------------------------
  it('M1: raw SQL cannot set an email_message_id on classification_reviews — the column does not exist at the DB level', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO classification_reviews
           (id, ai_classification_id, email_message_id, reviewer_id, corrected_intent, corrected_result_json, created_at)
         VALUES (?, ?, ?, ?, 'OTHER', '{}', NOW(3))`,
        randomUUID(),
        randomUUID(),
        randomUUID(),
        userId,
      ),
    ).rejects.toThrow(/Unknown column/i);
  });

  it('M2: a review always resolves to the correct message ONLY through its AiClassification, never independently', async () => {
    const threadA = await prisma.communicationThread.create({
      data: { mailConfigurationId, subject: 'Message A thread', lastMessageAt: new Date() },
    });
    const messageA = await prisma.emailMessage.create({
      data: {
        threadId: threadA.id,
        mailConfigurationId,
        direction: 'INBOUND',
        subject: 'Message A',
        fromAddress: 'customer-a@example.test',
        toAddressesJson: ['no-reply@example.test'],
        bodyText: 'Body A',
        occurredAt: new Date(),
      },
    });
    const threadB = await prisma.communicationThread.create({
      data: { mailConfigurationId, subject: 'Message B thread', lastMessageAt: new Date() },
    });
    const messageB = await prisma.emailMessage.create({
      data: {
        threadId: threadB.id,
        mailConfigurationId,
        direction: 'INBOUND',
        subject: 'Message B',
        fromAddress: 'customer-b@example.test',
        toAddressesJson: ['no-reply@example.test'],
        bodyText: 'Body B',
        occurredAt: new Date(),
      },
    });
    const classificationForA = await prisma.aiClassification.create({
      data: {
        emailMessageId: messageA.id,
        provider: 'test-provider',
        model: 'test-model',
        promptVersion: 'v1',
        intent: 'ACCEPT_RENEWAL',
        confidence: '0.900',
        structuredResultJson: {},
      },
    });
    const review = await prisma.classificationReview.create({
      data: {
        aiClassificationId: classificationForA.id,
        reviewerId: userId,
        correctedIntent: 'ACCEPT_RENEWAL',
        correctedResultJson: {},
      },
    });

    const reloaded = await prisma.classificationReview.findUniqueOrThrow({
      where: { id: review.id },
      include: { aiClassification: true },
    });
    // The only message this review can possibly resolve to is the one its own classification
    // belongs to — messageA, never messageB — because there is no other column through which it
    // could point anywhere else.
    expect(reloaded.aiClassification.emailMessageId).toBe(messageA.id);
    expect(reloaded.aiClassification.emailMessageId).not.toBe(messageB.id);
    expect(reloaded).not.toHaveProperty('emailMessageId');
  });

  it('L3: a MailConfiguration referenced by a CommunicationThread/EmailMessage cannot be silently deleted', async () => {
    const configForDeleteCheck = await prisma.mailConfiguration.create({
      data: {
        scopeKey: `BILLING_ENTITY:${randomUUID()}`,
        label: 'Delete-check mailbox',
        smtpHost: 'smtp6.example.test',
        smtpPort: 587,
        smtpUsername: 'deletecheck@example.test',
        imapHost: 'imap6.example.test',
        imapPort: 993,
        imapUsername: 'deletecheck@example.test',
        fromAddress: 'deletecheck@example.test',
        fromName: 'Delete Check',
      },
    });
    await prisma.communicationThread.create({
      data: {
        mailConfigurationId: configForDeleteCheck.id,
        subject: 'References the mailbox',
        lastMessageAt: new Date(),
      },
    });
    await expect(
      prisma.mailConfiguration.delete({ where: { id: configForDeleteCheck.id } }),
    ).rejects.toThrow();
  });
});
