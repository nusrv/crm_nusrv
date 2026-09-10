import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import mariadb, { type Connection } from 'mariadb';
import { AuditService } from '../src/audit/audit.service';
import { toMariaDbDriverUrl } from '../src/database/mariadb-url';
import { BillingFrequency, SubscriptionStatus } from '../src/generated/prisma/enums';
import { PrismaClient } from '../src/generated/prisma/client';
import { CustomerCodeService } from '../src/modules/customers/customer-code.service';
import { CustomerEmailResolutionService } from '../src/modules/customers/customer-email-resolution.service';
import { CustomersService } from '../src/modules/customers/customers.service';
import { SubscriptionCodeService } from '../src/modules/subscriptions/subscription-code.service';
import { readAllMigrationsSql } from './read-all-migrations';

// Proves the `subscription_code_sequences.customer_id` FK's referential action against a real
// MariaDB server, which is not something a mocked unit test can exercise:
//   - deleting a Customer through the real, unmodified `CustomersService.deleteCustomer()` flow
//     must still succeed now that every customer with a subscription has a sequence row (it was
//     ON DELETE RESTRICT originally, which would have broken that existing flow outright) — and the
//     sequence row must be gone afterward, not orphaned
//   - deleting an individual Subscription must never touch the sequence row (there is no FK between
//     `subscriptions` and `subscription_code_sequences`), so the next generated code continues
//     rather than reusing the deleted one's number
const databaseUrl = process.env.MARIADB_TEST_DATABASE_URL;
const liveDescribe = databaseUrl ? describe : describe.skip;

// Was a manually duplicated 8-item list (drift risk identical to the one fixed in
// mariadb-phase2-live.spec.ts) — now the single centralized helper, which is also correct since
// this suite already needed every migration up to HEAD anyway.
const migrations = readAllMigrationsSql();

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

liveDescribe('SubscriptionCodeSequence FK referential action against real pre-existing data', () => {
  let setupConnection: Connection;
  let prisma: PrismaClient;
  let billingEntityId: string;

  beforeAll(async () => {
    const url = databaseUrl as string;
    setupConnection = await mariadb.createConnection(connectionOptions(url));
    await resetDatabase(setupConnection);
    await setupConnection.query(migrations);
    prisma = new PrismaClient({ adapter: new PrismaMariaDb(toMariaDbDriverUrl(url)) });

    const billingEntity = await prisma.billingEntity.create({
      data: {
        code: 'FUTURE_FORESIGHT_INTERNATIONAL_TEST',
        customerCodePrefix: 'FF',
        name: 'Future Foresight Test',
        legalName: 'Future Foresight Test LLC',
        paymentScope: 'INTERNATIONAL',
      },
    });
    billingEntityId = billingEntity.id;
    await prisma.serviceType.create({
      data: { id: 'svc-hosting', code: 'HOSTING', name: 'Hosting' },
    });
  }, 30_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    if (setupConnection) {
      await resetDatabase(setupConnection);
      await setupConnection.end();
    }
  }, 30_000);

  async function createCustomer(customerCode: string) {
    return prisma.customer.create({
      data: {
        billingEntityId,
        customerCode,
        nameEn: `Customer ${customerCode}`,
        primaryEmail: `${customerCode.toLowerCase()}@example.test`,
        status: 'ACTIVE',
      },
    });
  }

  async function createSubscription(customerId: string) {
    const codeService = new SubscriptionCodeService();
    const code = await prisma.$transaction((tx) => codeService.next(tx, customerId));
    return prisma.subscription.create({
      data: {
        customerId,
        serviceTypeId: 'svc-hosting',
        subscriptionCode: code,
        name: `Hosting for ${customerId}`,
        startDate: new Date('2026-01-01'),
        renewalDate: new Date('2027-01-01'),
        billingFrequency: BillingFrequency.ANNUAL,
        sellingPrice: '100.000',
        currency: 'JOD',
        status: SubscriptionStatus.ACTIVE,
      },
    });
  }

  it('deleting an individual Subscription does not touch the sequence: the next code continues rather than reusing the deleted one', async () => {
    const customer = await createCustomer('FF0101');
    const sub1 = await createSubscription(customer.id);
    const sub2 = await createSubscription(customer.id);
    const sub3 = await createSubscription(customer.id);
    expect([sub1.subscriptionCode, sub2.subscriptionCode, sub3.subscriptionCode]).toEqual([
      'FF0101-S01',
      'FF0101-S02',
      'FF0101-S03',
    ]);

    await prisma.subscription.delete({ where: { id: sub3.id } });

    const sequenceAfterDelete = await prisma.subscriptionCodeSequence.findUniqueOrThrow({
      where: { customerId: customer.id },
    });
    expect(sequenceAfterDelete.lastValue).toBe(3);

    const nextCode = await createSubscription(customer.id);
    expect(nextCode.subscriptionCode).toBe('FF0101-S04');
  });

  it('deletes a Customer with a generated subscription-code sequence through the existing, unmodified CustomersService.deleteCustomer() workflow, cascading the sequence row', async () => {
    const customer = await createCustomer('FF0102');
    await createSubscription(customer.id);
    await createSubscription(customer.id);

    const sequenceBeforeDelete = await prisma.subscriptionCodeSequence.findUniqueOrThrow({
      where: { customerId: customer.id },
    });
    expect(sequenceBeforeDelete.lastValue).toBe(2);

    const audit = new AuditService(prisma as never);
    const customerCode = new CustomerCodeService();
    const customersService = new CustomersService(
      prisma as never,
      audit,
      customerCode,
      new CustomerEmailResolutionService(prisma as never),
    );

    // This is the real, unmodified deleteCustomer() flow — it never mentions
    // SubscriptionCodeSequence at all. With the FK still ON DELETE RESTRICT this would throw; the
    // fix under test is exactly what makes this resolve cleanly.
    await expect(
      customersService.deleteCustomer(customer.id, { actorId: 'actor-id' }),
    ).resolves.toEqual(expect.objectContaining({ id: customer.id, deleted: true }));

    await expect(prisma.customer.findUnique({ where: { id: customer.id } })).resolves.toBeNull();
    await expect(
      prisma.subscriptionCodeSequence.findUnique({ where: { customerId: customer.id } }),
    ).resolves.toBeNull();
  });
});
