import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import mariadb, { type Connection } from 'mariadb';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  ActorType,
  BillingFrequency,
  CustomerStatus,
  IntegrationEnvironment,
  LegacyCustomerResolution,
  LegacyImportRowStatus,
  LegacyValidationStatus,
  PaymentScope,
  SubscriptionStatus,
  TechnicalConnectionType,
} from '../src/generated/prisma/enums';
import { toMariaDbDriverUrl } from '../src/database/mariadb-url';

const databaseUrl = process.env.MARIADB_TEST_DATABASE_URL;
const liveDescribe = databaseUrl ? describe : describe.skip;
const migration = readFileSync(
  join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260823000000_mariadb_phase_0_1_foundation',
    'migration.sql',
  ),
  'utf8',
);

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

liveDescribe('MariaDB zero migration and Prisma integration', () => {
  let adminId: string;
  let billingEntityId: string;
  let prisma: PrismaClient;
  let setupConnection: Connection;

  beforeAll(async () => {
    const url = databaseUrl as string;
    setupConnection = await mariadb.createConnection(connectionOptions(url));
    await resetDatabase(setupConnection);
    await setupConnection.query(migration);
    prisma = new PrismaClient({ adapter: new PrismaMariaDb(toMariaDbDriverUrl(url)) });

    const admin = await prisma.user.create({
      data: {
        email: `mariadb-admin-${randomUUID()}@example.test`,
        displayName: 'MariaDB test admin',
        passwordHash: 'not-a-real-password-hash',
      },
    });
    adminId = admin.id;
    billingEntityId = (
      await prisma.billingEntity.create({
        data: {
          code: `BE-${randomUUID()}`,
          name: 'MariaDB Test Entity',
          legalName: 'MariaDB Test Entity LLC',
          paymentScope: PaymentScope.LOCAL,
        },
      })
    ).id;
  }, 30_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    if (setupConnection) {
      await resetDatabase(setupConnection);
      await setupConnection.end();
    }
  }, 30_000);

  it('supports UUID identities, JSON, Decimal, dates, relations, and Prisma CRUD', async () => {
    const customer = await prisma.customer.create({
      data: {
        billingEntityId,
        customerCode: `CUST-${randomUUID()}`,
        companyName: 'MariaDB Customer',
        primaryEmail: `customer-${randomUUID()}@example.test`,
        status: CustomerStatus.ACTIVE,
      },
    });
    expect(customer.id).toHaveLength(36);

    const serviceType = await prisma.serviceType.create({
      data: {
        code: `SVC-${randomUUID()}`,
        name: 'MariaDB JSON Service',
        defaultSuspendPolicy: { requiresApproval: true, graceHours: 24 },
      },
    });
    const subscription = await prisma.subscription.create({
      data: {
        customerId: customer.id,
        serviceTypeId: serviceType.id,
        subscriptionCode: `SUB-${randomUUID()}`,
        name: 'MariaDB Decimal Subscription',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        renewalDate: new Date('2027-01-01T00:00:00.000Z'),
        billingFrequency: BillingFrequency.ANNUAL,
        supplierCost: '10.125',
        sellingPrice: '19.875',
        currency: 'JOD',
        status: SubscriptionStatus.ACTIVE,
      },
    });
    expect(subscription.sellingPrice.toFixed(3)).toBe('19.875');
    expect(subscription.startDate.toISOString()).toContain('2026-01-01');

    const longEndpoint = `https://connection.example.test/${'segment-'.repeat(40)}`;
    expect(longEndpoint.length).toBeGreaterThan(191);
    expect(longEndpoint.length).toBeLessThanOrEqual(500);
    const first = await prisma.technicalConnection.create({
      data: {
        code: `CONN-${randomUUID()}`,
        name: 'MariaDB Connection 1',
        type: TechnicalConnectionType.PLESK,
        endpoint: longEndpoint,
        environment: IntegrationEnvironment.SANDBOX,
        capabilities: { suspend: true, reactivate: true },
        credentialsCiphertext: 'encrypted-test-value',
      },
    });
    const second = await prisma.technicalConnection.create({
      data: {
        code: `CONN-${randomUUID()}`,
        name: 'MariaDB Connection 2',
        type: TechnicalConnectionType.SMARTERMAIL,
        environment: IntegrationEnvironment.SANDBOX,
        capabilities: { mailbox: true },
      },
    });
    expect(
      await prisma.technicalConnection.findUnique({
        where: { id: first.id },
        select: { endpoint: true },
      }),
    ).toEqual({ endpoint: longEndpoint });
    await prisma.subscriptionConnection.createMany({
      data: [first, second].map((connection, index) => ({
        subscriptionId: subscription.id,
        technicalConnectionId: connection.id,
        remoteIdentifier: `example-${index}.test`,
        actionProfile: { mode: 'manual-test' },
      })),
    });
    expect(
      await prisma.subscriptionConnection.count({ where: { subscriptionId: subscription.id } }),
    ).toBe(2);
  });

  it('enforces foreign keys and uniqueness constraints', async () => {
    await expect(
      prisma.customer.create({
        data: {
          billingEntityId: randomUUID(),
          customerCode: `INVALID-${randomUUID()}`,
          companyName: 'Invalid relation',
          primaryEmail: 'invalid@example.test',
        },
      }),
    ).rejects.toThrow();

    const sourceFileHash = randomUUID().replaceAll('-', '');
    await prisma.legacyImportBatch.create({
      data: {
        sourceFileName: 'unique-source.xls',
        sourceFileHash,
        sourceFileSize: 1,
        uploadedById: adminId,
      },
    });
    await expect(
      prisma.legacyImportBatch.create({
        data: {
          sourceFileName: 'same-source.xls',
          sourceFileHash,
          sourceFileSize: 1,
          uploadedById: adminId,
        },
      }),
    ).rejects.toThrow();
  });

  it('prevents audit UPDATE and DELETE through normal SQL operations', async () => {
    const event = await prisma.auditEvent.create({
      data: {
        actorType: ActorType.USER,
        actorId: adminId,
        eventKey: 'MARIADB_AUDIT_IMMUTABILITY_TEST',
        subjectType: 'test',
        subjectId: randomUUID(),
        ipAddress: '2001:db8::1',
        metadata: { engine: 'mariadb' },
      },
    });
    await expect(
      prisma.$executeRawUnsafe(
        'UPDATE audit_events SET event_key = ? WHERE id = ?',
        'CHANGED',
        event.id,
      ),
    ).rejects.toThrow(/append-only/i);
    await expect(
      prisma.$executeRawUnsafe('DELETE FROM audit_events WHERE id = ?', event.id),
    ).rejects.toThrow(/append-only/i);
    expect(await prisma.auditEvent.findUnique({ where: { id: event.id } })).toMatchObject({
      eventKey: 'MARIADB_AUDIT_IMMUTABILITY_TEST',
      ipAddress: '2001:db8::1',
    });
  });

  it('preserves raw import data and approves it transactionally into live records', async () => {
    const batch = await prisma.legacyImportBatch.create({
      data: {
        sourceFileName: 'transactional-import.xls',
        sourceFileHash: randomUUID().replaceAll('-', ''),
        sourceFileSize: 2048,
        uploadedById: adminId,
        totalRows: 1,
      },
    });
    const row = await prisma.legacyImportRow.create({
      data: {
        batchId: batch.id,
        sheetName: 'Sheet1',
        sourceRowNumber: 2,
        sourceReference: 'Sheet1!2',
        rowFingerprint: randomUUID().replaceAll('-', ''),
        rawValuesCiphertext: 'encrypted-raw-source-values',
        rawPreview: { company: 'Imported Customer', amount: '42.500' },
        mappedCustomer: { companyName: 'Imported Customer' },
        mappedSubscriptions: [{ serviceType: 'Hosting' }],
        duplicateCandidates: [],
        validationIssues: [],
        validationStatus: LegacyValidationStatus.VALID,
        status: LegacyImportRowStatus.READY_FOR_APPROVAL,
        customerResolution: LegacyCustomerResolution.CREATE_NEW,
        billingEntityId,
      },
    });
    const serviceType = await prisma.serviceType.create({
      data: { code: `IMPORT-SVC-${randomUUID()}`, name: 'Import Service' },
    });

    const approved = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          billingEntityId,
          customerCode: `IMPORT-CUST-${randomUUID()}`,
          companyName: 'Imported Customer',
          primaryEmail: `import-${randomUUID()}@example.test`,
          sourceLegacyReference: row.sourceReference,
        },
      });
      const subscription = await tx.subscription.create({
        data: {
          customerId: customer.id,
          serviceTypeId: serviceType.id,
          subscriptionCode: `IMPORT-SUB-${randomUUID()}`,
          name: 'Imported Hosting',
          startDate: new Date('2026-01-01T00:00:00.000Z'),
          renewalDate: new Date('2027-01-01T00:00:00.000Z'),
          billingFrequency: BillingFrequency.ANNUAL,
          sellingPrice: '42.500',
          currency: 'JOD',
          sourceLegacyReference: row.sourceReference,
        },
      });
      await tx.legacyImportSubscriptionLink.create({
        data: { importRowId: row.id, subscriptionId: subscription.id },
      });
      await tx.legacyImportRow.update({
        where: { id: row.id },
        data: {
          status: LegacyImportRowStatus.APPROVED,
          approvedCustomerId: customer.id,
          approvedById: adminId,
          approvedAt: new Date(),
        },
      });
      return { customer, subscription };
    });

    const traced = await prisma.legacyImportRow.findUnique({
      where: { id: row.id },
      include: { subscriptionLinks: true },
    });
    expect(traced).toMatchObject({
      status: LegacyImportRowStatus.APPROVED,
      approvedCustomerId: approved.customer.id,
      rawValuesCiphertext: 'encrypted-raw-source-values',
      rawPreview: { company: 'Imported Customer', amount: '42.500' },
    });
    expect(traced?.subscriptionLinks[0]?.subscriptionId).toBe(approved.subscription.id);
  });
});
