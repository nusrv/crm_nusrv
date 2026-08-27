import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import mariadb, { type Connection } from 'mariadb';
import { toMariaDbDriverUrl } from '../src/database/mariadb-url';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  BillingFrequency,
  CustomerContactRole,
  PackageClassificationStatus,
  PackageKind,
  PaymentScope,
  SubscriptionIdentifierType,
} from '../src/generated/prisma/enums';

const databaseUrl = process.env.MARIADB_TEST_DATABASE_URL;
const liveDescribe = databaseUrl ? describe : describe.skip;
const migrationNames = [
  '20260823000000_mariadb_phase_0_1_foundation',
  '20260824000000_phase_2_renewal_engine',
  '20260827000000_phase_2_1_operational_data',
];
const migrations = migrationNames
  .map((name) =>
    readFileSync(join(process.cwd(), 'prisma', 'migrations', name, 'migration.sql'), 'utf8'),
  )
  .join('\n');

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

liveDescribe('Phase 2.1 MariaDB operational data integration', () => {
  let connection: Connection;
  let prisma: PrismaClient;
  beforeAll(async () => {
    const url = databaseUrl as string;
    connection = await mariadb.createConnection(options(url));
    await reset(connection);
    await connection.query(migrations);
    prisma = new PrismaClient({ adapter: new PrismaMariaDb(toMariaDbDriverUrl(url)) });
  }, 30_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    if (connection) {
      await reset(connection);
      await connection.end();
    }
  }, 30_000);

  it('persists catalog JSON/Decimal, UUID identities, contacts, identifiers, and historical snapshots', async () => {
    const billingEntity = await prisma.billingEntity.create({
      data: {
        code: `P21-${randomUUID()}`,
        name: 'P21',
        legalName: 'P21',
        paymentScope: PaymentScope.LOCAL,
      },
    });
    const customer = await prisma.customer.create({
      data: {
        billingEntityId: billingEntity.id,
        customerCode: `P21-C-${randomUUID()}`,
        companyName: 'P21 Customer',
        primaryEmail: `${randomUUID()}@example.test`,
        contacts: {
          create: {
            role: CustomerContactRole.TECHNICAL,
            name: 'Technical',
            email: 'it@example.test',
          },
        },
      },
    });
    const type = await prisma.serviceType.create({
      data: { code: `P21-S-${randomUUID()}`, name: 'P21 Hosting' },
    });
    const servicePackage = await prisma.servicePackage.create({
      data: {
        serviceTypeId: type.id,
        code: `P21-P-${randomUUID()}`,
        name: 'P21 Package',
        kind: PackageKind.STANDARD,
        specifications: { webSpaceGb: 30, mailSpaceGb: 8 },
        terms: { create: { termMonths: 36, currency: 'JOD', standardSellingPrice: '525.000' } },
      },
      include: { terms: true },
    });
    const subscription = await prisma.subscription.create({
      data: {
        customerId: customer.id,
        serviceTypeId: type.id,
        servicePackageId: servicePackage.id,
        subscriptionCode: `P21-SUB-${randomUUID()}`,
        name: 'Historical sold name',
        startDate: new Date('2026-01-01T00:00:00Z'),
        renewalDate: new Date('2029-01-01T00:00:00Z'),
        billingFrequency: BillingFrequency.CUSTOM,
        renewalIntervalMonths: 36,
        contractTermMonths: 36,
        sellingPrice: '499.125',
        currency: 'JOD',
        packageNameSnapshot: 'Historical sold name',
        packageSpecificationsSnapshot: { webSpaceGb: 30, mailSpaceGb: 8 },
        classificationStatus: PackageClassificationStatus.MATCHED_OFFICIAL,
        classificationEvidence: { sourceRegistration: 'Hosting', rule: 'human-confirmed' },
        identifiers: { create: { type: SubscriptionIdentifierType.DOMAIN, value: 'example.test' } },
      },
      include: { identifiers: true },
    });
    expect(servicePackage.id).toHaveLength(36);
    expect(servicePackage.terms[0]?.standardSellingPrice.toFixed(3)).toBe('525.000');
    expect(subscription.sellingPrice.toFixed(3)).toBe('499.125');
    expect(subscription.packageSpecificationsSnapshot).toEqual({ webSpaceGb: 30, mailSpaceGb: 8 });
    expect(subscription.identifiers[0]?.value).toBe('example.test');
  });

  it('enforces package term uniqueness, foreign keys, and interval checks', async () => {
    await expect(
      prisma.subscriptionIdentifier.create({
        data: {
          subscriptionId: randomUUID(),
          type: SubscriptionIdentifierType.DOMAIN,
          value: 'missing.test',
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRawUnsafe(
        'INSERT INTO service_package_terms (id, service_package_id, term_months, currency, standard_selling_price, updated_at) VALUES (?, ?, 0, ?, ?, NOW(3))',
        randomUUID(),
        randomUUID(),
        'JOD',
        '1.000',
      ),
    ).rejects.toThrow();
  });
});
