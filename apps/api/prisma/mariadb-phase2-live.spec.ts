import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import mariadb, { type Connection } from 'mariadb';
import { AuditService } from '../src/audit/audit.service';
import { toMariaDbDriverUrl } from '../src/database/mariadb-url';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  BillingFrequency,
  CustomerStatus,
  IntegrationEnvironment,
  PaymentScope,
  ReminderAudience,
  RenewalCaseStatus,
  SubscriptionStatus,
  TechnicalConnectionType,
} from '../src/generated/prisma/enums';
import { RenewalEngineService } from '../src/modules/renewal-cases/renewal-engine.service';
import { RenewalTemplateRenderer } from '../src/modules/renewal-cases/renewal-template.renderer';
import { BusinessTimeService } from '../src/time/business-time.service';
import { ClockService } from '../src/time/clock.service';

const databaseUrl = process.env.MARIADB_TEST_DATABASE_URL;
const liveDescribe = databaseUrl ? describe : describe.skip;
const migrations = [
  '20260823000000_mariadb_phase_0_1_foundation',
  '20260824000000_phase_2_renewal_engine',
]
  .map((directory) =>
    readFileSync(join(process.cwd(), 'prisma', 'migrations', directory, 'migration.sql'), 'utf8'),
  )
  .join('\n');

function connectionOptions(url: string): mariadb.ConnectionConfig {
  const parsed = new URL(url);
  const database = decodeURIComponent(parsed.pathname.slice(1));
  if (parsed.protocol !== 'mysql:' || !database.endsWith('_test')) {
    throw new Error('MARIADB_TEST_DATABASE_URL must use mysql:// and target a *_test database.');
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

async function resetDatabase(connection: Connection): Promise<void> {
  await connection.query('SET FOREIGN_KEY_CHECKS = 0');
  const tables: Array<{ TABLE_NAME: string }> = await connection.query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()',
  );
  for (const { TABLE_NAME: table } of tables) {
    if (!/^[a-z0-9_]+$/i.test(table)) throw new Error('Unsafe test table name.');
    await connection.query(`DROP TABLE \`${table}\``);
  }
  await connection.query('SET FOREIGN_KEY_CHECKS = 1');
}

function dueDate(asOf: Date, days: number): Date {
  const due = new Date(
    `${new BusinessTimeService({ getOrThrow: () => 'Asia/Amman' } as never).businessDateKey(asOf)}T00:00:00Z`,
  );
  due.setUTCDate(due.getUTCDate() + days);
  return due;
}

liveDescribe('Phase 2 MariaDB renewal engine integration', () => {
  let connection: Connection;
  let prisma: PrismaClient;
  let engine: RenewalEngineService;
  let billingEntityId: string;
  let customerId: string;
  let serviceTypeId: string;
  const asOf = new Date('2026-08-24T08:00:00.000Z');

  beforeAll(async () => {
    const url = databaseUrl as string;
    connection = await mariadb.createConnection(connectionOptions(url));
    await resetDatabase(connection);
    await connection.query(migrations);
    prisma = new PrismaClient({ adapter: new PrismaMariaDb(toMariaDbDriverUrl(url)) });
    const audit = new AuditService(prisma as never);
    const businessTime = new BusinessTimeService({ getOrThrow: () => 'Asia/Amman' } as never);
    engine = new RenewalEngineService(
      prisma as never,
      audit,
      businessTime,
      new ClockService(),
      new RenewalTemplateRenderer(),
    );

    const adminRole = await prisma.role.create({ data: { code: 'ADMIN', name: 'Admin' } });
    const itRole = await prisma.role.create({ data: { code: 'IT', name: 'IT' } });
    const managementRole = await prisma.role.create({
      data: { code: 'MANAGEMENT', name: 'Management' },
    });
    const userSeeds: Array<[string, string, string]> = [
      ['admin@example.test', 'Admin User', adminRole.id],
      ['it@example.test', 'IT User', itRole.id],
      ['management@example.test', 'Management User', managementRole.id],
    ];
    const users = await Promise.all(
      userSeeds.map(async ([email, displayName, roleId]) => {
        const user = await prisma.user.create({
          data: { email, displayName, passwordHash: 'test-password-hash' },
        });
        await prisma.userRole.create({ data: { userId: user.id, roleId } });
        return user;
      }),
    );
    expect(users).toHaveLength(3);
    billingEntityId = (
      await prisma.billingEntity.create({
        data: {
          code: 'PHASE2_ENTITY',
          name: 'Phase 2 Entity',
          legalName: 'Phase 2 Entity LLC',
          paymentScope: PaymentScope.LOCAL,
        },
      })
    ).id;
    customerId = (
      await prisma.customer.create({
        data: {
          billingEntityId,
          customerCode: 'PHASE2_CUSTOMER',
          companyName: 'Phase 2 Customer',
          contactName: 'Renewal Contact',
          primaryEmail: 'customer@example.test',
          status: CustomerStatus.ACTIVE,
        },
      })
    ).id;
    serviceTypeId = (
      await prisma.serviceType.create({ data: { code: 'PHASE2_HOSTING', name: 'Hosting' } })
    ).id;

    for (const days of [30, 21, 14, 7, 2, 0]) {
      const label = days === 0 ? 'D0' : `D${days}`;
      const template = await prisma.renewalTemplate.create({
        data: {
          code: `LIVE_${label}`,
          name: `Live ${label}`,
          subjectTemplate: `${label} {{subscriptionName}}`,
          bodyTemplate:
            days === 0
              ? 'Final warning: {{subscriptionName}} is subject to suspension after 24 hours. {{renewalCaseReference}}'
              : '{{customerCompany}} {{subscriptionName}} {{renewalDate}} {{renewalAmount}} {{currency}}',
        },
      });
      await prisma.reminderRule.create({
        data: {
          code: `LIVE_CUSTOMER_${label}`,
          name: `Live customer ${label}`,
          daysBeforeDue: days,
          templateId: template.id,
        },
      });
    }
    await prisma.notificationRule.createMany({
      data: [
        {
          code: 'LIVE_INTERNAL_D2',
          name: 'D2 IT',
          daysBeforeDue: 2,
          recipientRoles: ['IT'],
          recipientEmails: [],
          subjectTemplate: 'D2 {{subscriptionName}}',
          bodyTemplate: '{{renewalCaseReference}}',
        },
        {
          code: 'LIVE_INTERNAL_D0',
          name: 'D0 IT and Management',
          daysBeforeDue: 0,
          recipientRoles: ['IT', 'MANAGEMENT'],
          recipientEmails: [],
          subjectTemplate: 'D0 {{subscriptionName}}',
          bodyTemplate: '{{renewalCaseReference}}',
        },
      ],
    });
  }, 30_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    if (connection) {
      await resetDatabase(connection);
      await connection.end();
    }
  }, 30_000);

  async function createSubscription(
    code: string,
    daysBeforeDue: number,
    status: SubscriptionStatus = SubscriptionStatus.ACTIVE,
  ) {
    return prisma.subscription.create({
      data: {
        customerId,
        serviceTypeId,
        subscriptionCode: code,
        name: `${code} Hosting`,
        description: 'Managed hosting',
        startDate: new Date('2025-01-01T00:00:00Z'),
        renewalDate: dueDate(asOf, daysBeforeDue),
        billingFrequency: BillingFrequency.ANNUAL,
        sellingPrice: '120.000',
        currency: 'JOD',
        status,
      },
    });
  }

  it('queues D-30/D-21/D-14/D-7/D-2/D0 once and D-2/D0 internal escalation once', async () => {
    for (const days of [30, 21, 14, 7, 2, 0]) {
      await createSubscription(`MILESTONE_${days}`, days);
    }
    await createSubscription('INACTIVE_30', 30, SubscriptionStatus.CLOSED);

    const first = await engine.evaluateAll({ asOf, trigger: 'test' });
    const second = await engine.evaluateAll({ asOf, trigger: 'test' });
    expect(first).toMatchObject({
      subscriptionsEvaluated: 6,
      casesCreated: 6,
      customerRemindersQueued: 6,
      internalNotificationsQueued: 3,
    });
    expect(second).toMatchObject({
      casesCreated: 0,
      customerRemindersQueued: 0,
      internalNotificationsQueued: 0,
      duplicatesPrevented: 9,
    });
    expect(
      await prisma.communicationOutbox.groupBy({
        by: ['daysBeforeDue'],
        where: { audience: ReminderAudience.CUSTOMER },
        _count: { _all: true },
        orderBy: { daysBeforeDue: 'desc' },
      }),
    ).toEqual(
      [30, 21, 14, 7, 2, 0].map((daysBeforeDue) => ({
        daysBeforeDue,
        _count: { _all: 1 },
      })),
    );
    const finalWarning = await prisma.communicationOutbox.findFirstOrThrow({
      where: { audience: ReminderAudience.CUSTOMER, daysBeforeDue: 0 },
    });
    expect(finalWarning.body).toContain('suspension after 24 hours');
    expect(await prisma.renewalCase.count()).toBe(6);
    expect(await prisma.renewalEvaluationDecision.count()).toBe(9);
  });

  it('uses database uniqueness under concurrent workers', async () => {
    const subscription = await createSubscription('CONCURRENT_D14', 14);
    await Promise.all([
      engine.evaluateAll({ asOf, trigger: 'test' }),
      engine.evaluateAll({ asOf, trigger: 'test' }),
    ]);
    expect(await prisma.renewalCase.count({ where: { subscriptionId: subscription.id } })).toBe(1);
    expect(
      await prisma.communicationOutbox.count({
        where: { subscriptionId: subscription.id, audience: ReminderAudience.CUSTOMER },
      }),
    ).toBe(1);
  });

  it('honors active holds, ignores expired holds, excludes inactive subscriptions, and blocks ineligible states', async () => {
    const held = await createSubscription('HELD_D7', 7);
    const expired = await createSubscription('EXPIRED_HOLD_D7', 7);
    const ineligible = await createSubscription('ACCEPTED_D7', 7);
    const inactive = await createSubscription('INACTIVE_D7', 7, SubscriptionStatus.CLOSED);
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@example.test' } });
    const heldCase = await prisma.renewalCase.create({
      data: {
        subscriptionId: held.id,
        cycleStartDate: new Date('2025-08-31T00:00:00Z'),
        dueDate: held.renewalDate,
      },
    });
    const expiredCase = await prisma.renewalCase.create({
      data: {
        subscriptionId: expired.id,
        cycleStartDate: new Date('2025-08-31T00:00:00Z'),
        dueDate: expired.renewalDate,
      },
    });
    await prisma.renewalCase.create({
      data: {
        subscriptionId: ineligible.id,
        cycleStartDate: new Date('2025-08-31T00:00:00Z'),
        dueDate: ineligible.renewalDate,
        status: RenewalCaseStatus.ACCEPTED,
      },
    });
    await prisma.renewalHold.createMany({
      data: [
        {
          renewalCaseId: heldCase.id,
          reason: 'Awaiting internal decision',
          expiresAt: new Date('2026-08-25T08:00:00Z'),
          createdById: admin.id,
        },
        {
          renewalCaseId: expiredCase.id,
          reason: 'Expired hold',
          expiresAt: new Date('2026-08-24T07:00:00Z'),
          createdById: admin.id,
        },
      ],
    });

    await engine.evaluateAll({ asOf, trigger: 'test' });
    expect(await prisma.communicationOutbox.count({ where: { subscriptionId: held.id } })).toBe(0);
    expect(await prisma.communicationOutbox.count({ where: { subscriptionId: expired.id } })).toBe(
      1,
    );
    expect(
      await prisma.communicationOutbox.count({ where: { subscriptionId: ineligible.id } }),
    ).toBe(0);
    expect(await prisma.renewalCase.count({ where: { subscriptionId: inactive.id } })).toBe(0);
    expect(
      await prisma.renewalEvaluationDecision.count({
        where: { renewalCaseId: heldCase.id, outcome: 'SKIPPED_HOLD' },
      }),
    ).toBe(1);
  });

  it('aggregates simultaneous holds, deduplicates decisions, and preserves remaining suppression after release', async () => {
    const subscription = await createSubscription('MULTI_HOLD_D2', 2);
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@example.test' } });
    const renewalCase = await prisma.renewalCase.create({
      data: {
        subscriptionId: subscription.id,
        cycleStartDate: new Date('2025-08-26T00:00:00Z'),
        dueDate: subscription.renewalDate,
      },
    });
    const customerHold = await prisma.renewalHold.create({
      data: {
        renewalCaseId: renewalCase.id,
        reason: 'Suppress customer reminder only',
        stopsCustomerReminders: true,
        stopsInternalNotifications: false,
        createdById: admin.id,
      },
    });
    const internalHold = await prisma.renewalHold.create({
      data: {
        renewalCaseId: renewalCase.id,
        reason: 'Suppress internal notification only',
        stopsCustomerReminders: false,
        stopsInternalNotifications: true,
        createdById: admin.id,
      },
    });

    const first = await engine.evaluateAll({ asOf, trigger: 'test' });
    const second = await engine.evaluateAll({ asOf, trigger: 'test' });
    expect(first.heldDecisions).toBeGreaterThanOrEqual(2);
    expect(second.heldDecisions).toBe(0);
    expect(
      await prisma.communicationOutbox.count({ where: { subscriptionId: subscription.id } }),
    ).toBe(0);
    expect(
      await prisma.renewalEvaluationDecision.count({
        where: { renewalCaseId: renewalCase.id, outcome: 'SKIPPED_HOLD' },
      }),
    ).toBe(2);

    const holdAudits = await prisma.auditEvent.findMany({
      where: {
        eventKey: 'renewal.reminder.skipped.hold',
        subjectType: 'RenewalEvaluationDecision',
      },
      orderBy: { createdAt: 'desc' },
      take: 2,
      select: { metadata: true },
    });
    const effectiveHoldIds = holdAudits.map((event) => {
      const metadata = event.metadata as { effectiveHoldIds?: string[] } | null;
      return metadata?.effectiveHoldIds ?? [];
    });
    expect(effectiveHoldIds).toEqual(
      expect.arrayContaining([[customerHold.id], [internalHold.id]]),
    );

    await prisma.renewalHold.update({
      where: { id: customerHold.id },
      data: { active: false, releasedAt: asOf, releasedById: admin.id },
    });
    await engine.evaluateAll({ asOf, trigger: 'test' });
    expect(
      await prisma.communicationOutbox.count({
        where: { subscriptionId: subscription.id, audience: ReminderAudience.CUSTOMER },
      }),
    ).toBe(1);
    expect(
      await prisma.communicationOutbox.count({
        where: { subscriptionId: subscription.id, audience: ReminderAudience.INTERNAL },
      }),
    ).toBe(0);
    expect(
      await prisma.renewalEvaluationDecision.count({
        where: { renewalCaseId: renewalCase.id, outcome: 'SKIPPED_HOLD' },
      }),
    ).toBe(2);
  });

  it('creates a new deterministic cycle without mutating the old case when renewal date changes', async () => {
    const subscription = await createSubscription('DATE_CHANGED', 21);
    await engine.evaluateAll({ asOf, trigger: 'test' });
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { renewalDate: dueDate(asOf, 30) },
    });
    await engine.evaluateAll({ asOf, trigger: 'test' });
    expect(await prisma.renewalCase.count({ where: { subscriptionId: subscription.id } })).toBe(2);
    expect(
      await prisma.communicationOutbox.count({
        where: { subscriptionId: subscription.id, audience: ReminderAudience.CUSTOMER },
      }),
    ).toBe(2);
  });

  it('keeps the approved 500-character Technical Connection endpoint mapping in Phase 2', async () => {
    const endpoint = `https://phase2.example.test/${'segment-'.repeat(40)}`;
    const connectionRecord = await prisma.technicalConnection.create({
      data: {
        code: `PHASE2-CONNECTION-${randomUUID()}`,
        name: 'Phase 2 long endpoint',
        type: TechnicalConnectionType.PLESK,
        environment: IntegrationEnvironment.SANDBOX,
        endpoint,
      },
    });
    expect(
      (await prisma.technicalConnection.findUniqueOrThrow({ where: { id: connectionRecord.id } }))
        .endpoint,
    ).toBe(endpoint);
  });
});
