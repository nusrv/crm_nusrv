import { jest } from '@jest/globals';
import { Prisma } from '../../generated/prisma/client';
import { CustomerStatus, RenewalCaseStatus, SubscriptionStatus } from '../../generated/prisma/enums';
import { BusinessTimeService } from '../../time/business-time.service';
import { RenewalEngineService } from './renewal-engine.service';
import { RenewalTemplateRenderer } from './renewal-template.renderer';

const MILESTONES = [30, 21, 14, 7, 2, 0];

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

/**
 * A minimal, stateful in-memory fake of the slice of Prisma this engine actually calls — real
 * enough to exercise the real unique-constraint-based idempotency paths (RenewalCase, Communication-
 * Outbox, RenewalEvaluationDecision) across multiple evaluateAll() calls, without a live database.
 * True DB-level concurrency (two workers racing the same unique index) is proven separately by the
 * live MariaDB suite — this fake proves the engine's own selection/dedup *logic*.
 */
function buildFakePrisma() {
  const renewalCasesById = new Map<string, Record<string, unknown>>();
  const caseIdByKey = new Map<string, string>();
  const outboxIdempotencyKeys = new Set<string>();
  const decisionKeys = new Set<string>();
  let caseSeq = 0;

  const caseKey = (subscriptionId: string, dueDate: Date) => `${subscriptionId}|${dueDate.toISOString()}`;

  const renewalCase = {
    create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
      const key = caseKey(data.subscriptionId as string, data.dueDate as Date);
      if (caseIdByKey.has(key)) return Promise.reject(uniqueViolation());
      const id = `case-${++caseSeq}`;
      const record = { id, status: RenewalCaseStatus.UPCOMING, holds: [], ...data };
      renewalCasesById.set(id, record);
      caseIdByKey.set(key, id);
      return Promise.resolve(record);
    }),
    updateMany: jest.fn(({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const record = renewalCasesById.get(where.id as string);
      if (!record) return Promise.resolve({ count: 0 });
      if (where.status && record.status !== where.status) return Promise.resolve({ count: 0 });
      Object.assign(record, data);
      return Promise.resolve({ count: 1 });
    }),
    findUniqueOrThrow: jest.fn(
      ({ where }: { where: { id?: string; subscriptionId_dueDate?: { subscriptionId: string; dueDate: Date } } }) => {
        let record: Record<string, unknown> | undefined;
        if (where.id) record = renewalCasesById.get(where.id);
        else if (where.subscriptionId_dueDate) {
          const id = caseIdByKey.get(caseKey(where.subscriptionId_dueDate.subscriptionId, where.subscriptionId_dueDate.dueDate));
          record = id ? renewalCasesById.get(id) : undefined;
        }
        if (!record) throw new Error('RenewalCase not found in fake store');
        return Promise.resolve(record);
      },
    ),
  };

  const communicationOutbox = {
    create: jest.fn(({ data }: { data: { idempotencyKey: string } }) => {
      if (outboxIdempotencyKeys.has(data.idempotencyKey)) return Promise.reject(uniqueViolation());
      outboxIdempotencyKeys.add(data.idempotencyKey);
      return Promise.resolve(data);
    }),
  };

  const renewalEvaluationDecision = {
    create: jest.fn(({ data }: { data: { decisionKey: string } }) => {
      if (decisionKeys.has(data.decisionKey)) return Promise.reject(uniqueViolation());
      decisionKeys.add(data.decisionKey);
      return Promise.resolve({ id: `decision-${decisionKeys.size}`, ...data });
    }),
  };

  const tx = { renewalCase, communicationOutbox, renewalEvaluationDecision };

  let overdueSubscriptions: unknown[] = [];
  let windowSubscriptions: unknown[] = [];

  const prisma = {
    reminderRule: {
      findMany: jest.fn(() =>
        Promise.resolve(
          MILESTONES.map((daysBeforeDue) => ({
            id: `rule-${daysBeforeDue}`,
            daysBeforeDue,
            template: { enabled: true, subjectTemplate: 'Renewal {{subscriptionName}}', bodyTemplate: 'Hi {{customerCompany}}' },
          })),
        ),
      ),
    },
    notificationRule: { findMany: jest.fn(() => Promise.resolve([])) },
    subscription: {
      findMany: jest.fn((args: { select?: unknown }) =>
        Promise.resolve(args.select ? overdueSubscriptions : windowSubscriptions),
      ),
    },
    renewalCase,
    communicationOutbox,
    renewalEvaluationDecision,
    user: { findMany: jest.fn(() => Promise.resolve([])) },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };

  return {
    prisma,
    renewalCasesById,
    outboxIdempotencyKeys,
    setOverdueSubscriptions: (subs: unknown[]) => {
      overdueSubscriptions = subs;
    },
    setWindowSubscriptions: (subs: unknown[]) => {
      windowSubscriptions = subs;
    },
  };
}

function buildEngine(prisma: unknown) {
  const businessTime = new BusinessTimeService({ getOrThrow: () => 'Asia/Amman' } as never);
  const auditRecord = jest.fn(() => Promise.resolve({ id: 'audit-id' }));
  const emailResolution = {
    resolvePrimaryRecipient: jest.fn(() => Promise.resolve({ email: 'customer@example.test', source: 'NORMALIZED_PRIMARY' })),
  };
  return new RenewalEngineService(
    prisma as never,
    { record: auditRecord } as never,
    businessTime,
    { now: () => new Date() },
    new RenewalTemplateRenderer(),
    emailResolution as never,
  );
}

function subscriptionAtDaysBeforeDue(businessTime: BusinessTimeService, asOf: Date, daysBeforeDue: number) {
  const renewalDate = businessTime.addBusinessDays(asOf, daysBeforeDue);
  return {
    id: 'sub-1',
    customerId: 'customer-1',
    startDate: new Date('2020-01-01T00:00:00.000Z'),
    renewalDate,
    billingFrequency: 'ANNUAL',
    renewalIntervalMonths: 12,
    name: 'Hosting Plan',
    description: 'Hosting Plan',
    sellingPrice: { toFixed: () => '100.000' },
    currency: 'JOD',
    customer: {
      id: 'customer-1',
      primaryEmail: null,
      contactName: 'Contact',
      nameEn: 'Customer Co',
      nameAr: null,
      status: CustomerStatus.ACTIVE,
      billingEntity: { name: 'Billing Entity' },
    },
    serviceType: { name: 'Hosting' },
  };
}

describe('RenewalEngineService — missed-milestone recovery (Slice B §2/§4)', () => {
  const asOf = new Date('2026-09-01T08:00:00.000Z');
  const businessTime = new BusinessTimeService({ getOrThrow: () => 'Asia/Amman' } as never);

  it('A — a single missed D-21 is queued once when the engine resumes at D-20', async () => {
    const fake = buildFakePrisma();
    fake.setWindowSubscriptions([subscriptionAtDaysBeforeDue(businessTime, asOf, 20)]);
    const engine = buildEngine(fake.prisma);

    const summary = await engine.evaluateAll({ asOf, trigger: 'test' });

    expect(summary.customerRemindersQueued).toBe(1);
    expect(fake.outboxIdempotencyKeys.size).toBe(1);
  });

  it('B — D-21 and D-14 both missed: only D-14 (the nearer one) is queued when resuming at D-12', async () => {
    const fake = buildFakePrisma();
    fake.setWindowSubscriptions([subscriptionAtDaysBeforeDue(businessTime, asOf, 12)]);
    const engine = buildEngine(fake.prisma);

    const summary = await engine.evaluateAll({ asOf, trigger: 'test' });

    expect(summary.customerRemindersQueued).toBe(1);
    expect(fake.outboxIdempotencyKeys.size).toBe(1);
  });

  it('C — once D-14 is already queued, resuming at D-12 never replays the older D-21', async () => {
    const fake = buildFakePrisma();
    const subscription = subscriptionAtDaysBeforeDue(businessTime, asOf, 14);
    fake.setWindowSubscriptions([subscription]);
    const engine = buildEngine(fake.prisma);
    await engine.evaluateAll({ asOf, trigger: 'test' });
    expect(fake.outboxIdempotencyKeys.size).toBe(1);

    // Two business days later the same subscription now reads as D-12.
    const laterAsOf = businessTime.addBusinessDays(asOf, 2);
    const summary = await engine.evaluateAll({ asOf: laterAsOf, trigger: 'test' });

    expect(summary.customerRemindersQueued).toBe(0);
    expect(summary.duplicatesPrevented).toBe(1);
    expect(fake.outboxIdempotencyKeys.size).toBe(1);
  });

  it('D — running twice on the same missed-catch-up day (D-6, for missed D-7) produces one outbox row only', async () => {
    const fake = buildFakePrisma();
    fake.setWindowSubscriptions([subscriptionAtDaysBeforeDue(businessTime, asOf, 6)]);
    const engine = buildEngine(fake.prisma);

    const first = await engine.evaluateAll({ asOf, trigger: 'test' });
    const second = await engine.evaluateAll({ asOf, trigger: 'test' });

    expect(first.customerRemindersQueued).toBe(1);
    expect(second.customerRemindersQueued).toBe(0);
    expect(second.duplicatesPrevented).toBe(1);
    expect(fake.outboxIdempotencyKeys.size).toBe(1);
  });
});

describe('RenewalEngineService — overdue enrollment (Slice B §3/§4)', () => {
  const asOf = new Date('2026-09-01T08:00:00.000Z');

  function overdueSubscriptionFixture(id = 'sub-overdue-1') {
    return {
      id,
      startDate: new Date('2020-01-01T00:00:00.000Z'),
      renewalDate: new Date('2026-08-01T00:00:00.000Z'),
      billingFrequency: 'ANNUAL',
      renewalIntervalMonths: 12,
    };
  }

  it('F — an overdue ACTIVE subscription with no RenewalCase gets one created', async () => {
    const fake = buildFakePrisma();
    fake.setOverdueSubscriptions([overdueSubscriptionFixture()]);
    const engine = buildEngine(fake.prisma);

    const summary = await engine.evaluateAll({ asOf, trigger: 'test' });

    expect(summary.overdueSubscriptionsScanned).toBe(1);
    expect(summary.overdueRenewalCasesCreated).toBe(1);
    expect(fake.renewalCasesById.size).toBe(1);
  });

  it('G — an overdue ACTIVE subscription that already has a RenewalCase is never duplicated', async () => {
    const fake = buildFakePrisma();
    const fixture = overdueSubscriptionFixture();
    fake.setOverdueSubscriptions([fixture]);
    const engine = buildEngine(fake.prisma);
    await engine.evaluateAll({ asOf, trigger: 'test' });
    expect(fake.renewalCasesById.size).toBe(1);

    const summary = await engine.evaluateAll({ asOf, trigger: 'test' });

    expect(summary.overdueRenewalCasesCreated).toBe(0);
    expect(fake.renewalCasesById.size).toBe(1);
  });

  it('H — overdue enrollment requests only ACTIVE subscriptions belonging to ACTIVE customers', async () => {
    const fake = buildFakePrisma();
    fake.setOverdueSubscriptions([]);
    const engine = buildEngine(fake.prisma);

    await engine.evaluateAll({ asOf, trigger: 'test' });

    const overdueCall = fake.prisma.subscription.findMany.mock.calls.find(
      (call) => 'select' in call[0],
    )?.[0] as { where: { status: unknown; customer: unknown; renewalDate: { lt: Date } } } | undefined;
    expect(overdueCall).toBeDefined();
    expect(overdueCall?.where).toMatchObject({
      status: SubscriptionStatus.ACTIVE,
      customer: { status: CustomerStatus.ACTIVE },
    });
    expect(overdueCall?.where.renewalDate.lt).toBeInstanceOf(Date);
  });

  it('does not queue a stale customer reminder for an already-overdue case even if it reaches reminder evaluation', async () => {
    const fake = buildFakePrisma();
    const businessTime = new BusinessTimeService({ getOrThrow: () => 'Asia/Amman' } as never);
    // Deliberately overdue by one day — proves resolveApplicableCustomerMilestone's negative guard
    // even if a subscription were ever handed to the main evaluation loop while overdue.
    fake.setWindowSubscriptions([subscriptionAtDaysBeforeDue(businessTime, asOf, -1)]);
    const engine = buildEngine(fake.prisma);

    const summary = await engine.evaluateAll({ asOf, trigger: 'test' });

    expect(summary.customerRemindersQueued).toBe(0);
    expect(fake.outboxIdempotencyKeys.size).toBe(0);
  });
});
