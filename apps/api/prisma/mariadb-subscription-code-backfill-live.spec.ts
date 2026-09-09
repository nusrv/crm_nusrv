import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import mariadb, { type Connection } from 'mariadb';
import { toMariaDbDriverUrl } from '../src/database/mariadb-url';
import { PrismaClient } from '../src/generated/prisma/client';
import { SubscriptionCodeService } from '../src/modules/subscriptions/subscription-code.service';

// This test seeds PRE-migration data (raw SQL, bypassing Prisma so the rows look exactly like
// production rows from before the redesign) and then applies ONLY the
// `20260909000000_subscription_code_sequences_and_backfill` migration on top, to prove the backfill
// itself is correct end-to-end against a real MariaDB server — not just reasoned about. Covers:
//   - the collision/swap scenario (an existing free-text code already equals another
//     subscription's computed target)
//   - a deliberate temp-code collision (the preflight guard must abort before touching any row)
//   - 101 subscriptions for one customer, to prove the zero-padding never truncates past #99
//     (LPAD(str, 2, '0') would silently truncate "100" to "10" — this migration does not use LPAD)
//   - createdAt ties broken by id
//   - a failure injected between phase 1 and phase 2, to prove the transaction rolls phase 1's
//     temporary renames back rather than leaving production on `__scode_migrating__...` codes
const databaseUrl = process.env.MARIADB_TEST_DATABASE_URL;
const liveDescribe = databaseUrl ? describe : describe.skip;

const priorMigrationNames = [
  '20260823000000_mariadb_phase_0_1_foundation',
  '20260824000000_phase_2_renewal_engine',
  '20260827000000_phase_2_1_operational_data',
  '20260827010000_scope_legacy_import_active_sheet',
  '20260831000000_currency_and_contact_channels',
  '20260906000000_canonical_phone_contact_and_source_order',
  '20260908000000_customer_code_sequences_and_bilingual_names',
];
const priorMigrations = priorMigrationNames
  .map((directory) =>
    readFileSync(join(process.cwd(), 'prisma', 'migrations', directory, 'migration.sql'), 'utf8'),
  )
  .join('\n');

const backfillMigrationPath = join(
  process.cwd(),
  'prisma',
  'migrations',
  '20260909000000_subscription_code_sequences_and_backfill',
  'migration.sql',
);
const backfillMigration = readFileSync(backfillMigrationPath, 'utf8');

// Builds a variant of the real migration with the real phase-2 rename replaced by a statement that
// is guaranteed to fail — used only to prove the surrounding transaction rolls phase 1 back too.
// The rest of the file (preflight guard, phase 1, sequence seeding, transaction wrapper) is
// untouched, so this exercises the actual shipped SQL, not a reimplementation of it.
function migrationWithSabotagedPhase2(): string {
  const startMarker = '-- Phase 2 of 2: rename every subscription';
  const endMarker = "-- Seed each Customer's sequence";
  const startIndex = backfillMigration.indexOf(startMarker);
  const endIndex = backfillMigration.indexOf(endMarker);
  if (startIndex === -1 || endIndex === -1) {
    throw new Error('Phase 2 markers not found in migration.sql — update this test to match.');
  }
  return (
    backfillMigration.slice(0, startIndex) +
    '-- SABOTAGED FOR TEST ONLY: not part of the shipped migration.\n' +
    "UPDATE `subscriptions` SET `this_column_does_not_exist` = 1;\n\n" +
    backfillMigration.slice(endIndex)
  );
}

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

async function seedBaseCatalog(connection: Connection): Promise<void> {
  await connection.query(`
    INSERT INTO billing_entities (id, name, code, customer_code_prefix, payment_scope, legal_name, active, created_at, updated_at)
    VALUES
      ('be-1', 'Future Foresight', 'FUTURE_FORESIGHT_INTERNATIONAL', 'FF', 'INTERNATIONAL', 'Future Foresight Intl', 1, NOW(), NOW()),
      ('be-2', 'New Serve', 'NEW_SERVE_LOCAL', 'NS', 'LOCAL', 'New Serve Local', 1, NOW(), NOW()),
      ('be-3', 'Bulk Test Entity', 'BULK_TEST', 'BT', 'LOCAL', 'Bulk Test Entity', 1, NOW(), NOW());

    INSERT INTO customers (id, billing_entity_id, customer_code, name_en, primary_email, status, created_at, updated_at)
    VALUES
      ('cust-ff1', 'be-1', 'FF0001', 'FF Customer One', 'ff1@example.test', 'ACTIVE', NOW(), NOW()),
      ('cust-ns1', 'be-2', 'NS0001', 'NS Customer One', 'ns1@example.test', 'ACTIVE', NOW(), NOW()),
      ('cust-bulk', 'be-3', 'BT0001', 'Bulk Customer', 'bulk@example.test', 'ACTIVE', NOW(), NOW());

    INSERT INTO service_types (id, code, name, active, created_at, updated_at)
    VALUES ('svc-1', 'HOSTING', 'Hosting', 1, NOW(), NOW());
  `);
}

liveDescribe('Subscription Code backfill migration against real pre-existing data', () => {
  describe('successful backfill', () => {
    let connection: Connection;
    let prisma: PrismaClient;

    beforeAll(async () => {
      const url = databaseUrl as string;
      connection = await mariadb.createConnection(connectionOptions(url));
      await resetDatabase(connection);
      await connection.query(priorMigrations);
      await seedBaseCatalog(connection);

      await connection.query(`
        -- FF0001: the exact collision/swap scenario — Sub A has an old free-text code but is
        -- chronologically first (should become FF0001-S01); Sub B is chronologically second
        -- (should become FF0001-S02) but its EXISTING code already literally equals Sub A's target.
        INSERT INTO subscriptions (id, customer_id, service_type_id, subscription_code, name, start_date, renewal_date, billing_frequency, selling_price, currency, status, created_at, updated_at)
        VALUES
          ('sub-a', 'cust-ff1', 'svc-1', 'LEG-S-AAAAAAAAAAAAAAAA', 'Sub A (chronologically first)', '2026-01-01', '2027-01-01', 'ANNUAL', '100.000', 'JOD', 'ACTIVE', '2026-01-01 10:00:00', NOW()),
          ('sub-b', 'cust-ff1', 'svc-1', 'FF0001-S01',              'Sub B (already has A''s target code)', '2026-01-01', '2027-01-01', 'ANNUAL', '100.000', 'JOD', 'ACTIVE', '2026-01-02 10:00:00', NOW()),
          ('sub-c', 'cust-ff1', 'svc-1', 'MANUAL-XYZ',              'Sub C (free text, unrelated shape)',   '2026-01-01', '2027-01-01', 'ANNUAL', '100.000', 'JOD', 'ACTIVE', '2026-01-03 10:00:00', NOW());

        -- NS0001: two subscriptions sharing an identical created_at, to prove id is the
        -- deterministic tie-breaker.
        INSERT INTO subscriptions (id, customer_id, service_type_id, subscription_code, name, start_date, renewal_date, billing_frequency, selling_price, currency, status, created_at, updated_at)
        VALUES
          ('sub-ns-2', 'cust-ns1', 'svc-1', 'LEG-S-2222222222222222', 'NS Sub 2', '2026-01-01', '2027-01-01', 'ANNUAL', '100.000', 'JOD', 'ACTIVE', '2026-02-01 09:00:00', NOW()),
          ('sub-ns-1', 'cust-ns1', 'svc-1', 'LEG-S-1111111111111111', 'NS Sub 1', '2026-01-01', '2027-01-01', 'ANNUAL', '100.000', 'JOD', 'ACTIVE', '2026-02-01 09:00:00', NOW());

        -- BT0001: 101 subscriptions, to prove the padding survives the S99/S100 boundary without
        -- truncation or collision (a naive LPAD(str, 2, '0') truncates "100" to "10").
        INSERT INTO subscriptions (id, customer_id, service_type_id, subscription_code, name, start_date, renewal_date, billing_frequency, selling_price, currency, status, created_at, updated_at)
        WITH RECURSIVE seq (n) AS (
          SELECT 1
          UNION ALL
          SELECT n + 1 FROM seq WHERE n < 101
        )
        SELECT
          CONCAT('sub-bulk-', LPAD(n, 3, '0')),
          'cust-bulk',
          'svc-1',
          CONCAT('OLD-BULK-CODE-', n),
          CONCAT('Bulk Sub ', n),
          '2026-01-01',
          '2027-01-01',
          'ANNUAL',
          '100.000',
          'JOD',
          'ACTIVE',
          DATE_ADD('2026-01-01 00:00:00', INTERVAL n MINUTE),
          NOW()
        FROM seq;
      `);

      await connection.query(backfillMigration);
      prisma = new PrismaClient({ adapter: new PrismaMariaDb(toMariaDbDriverUrl(url)) });
    }, 60_000);

    afterAll(async () => {
      await prisma?.$disconnect();
      if (connection) {
        await resetDatabase(connection);
        await connection.end();
      }
    }, 30_000);

    it('resolves the collision/swap scenario without a duplicate-key error and preserves subscription ids', async () => {
      const rows: Array<{ id: string; subscription_code: string }> = await connection.query(
        "SELECT id, subscription_code FROM subscriptions WHERE customer_id = 'cust-ff1' ORDER BY created_at, id",
      );
      expect(rows).toEqual([
        { id: 'sub-a', subscription_code: 'FF0001-S01' },
        { id: 'sub-b', subscription_code: 'FF0001-S02' },
        { id: 'sub-c', subscription_code: 'FF0001-S03' },
      ]);
    });

    it('breaks ties by id when created_at is identical', async () => {
      const rows: Array<{ id: string; subscription_code: string }> = await connection.query(
        "SELECT id, subscription_code FROM subscriptions WHERE customer_id = 'cust-ns1' ORDER BY id",
      );
      expect(rows).toEqual([
        { id: 'sub-ns-1', subscription_code: 'NS0001-S01' },
        { id: 'sub-ns-2', subscription_code: 'NS0001-S02' },
      ]);
    });

    it('pads through the S99/S100/S101 boundary without truncation, for a customer with 101 subscriptions', async () => {
      const boundary: Array<{ id: string; subscription_code: string }> = await connection.query(
        "SELECT id, subscription_code FROM subscriptions WHERE id IN ('sub-bulk-009','sub-bulk-010','sub-bulk-011','sub-bulk-098','sub-bulk-099','sub-bulk-100','sub-bulk-101') ORDER BY created_at",
      );
      expect(boundary).toEqual([
        { id: 'sub-bulk-009', subscription_code: 'BT0001-S09' },
        { id: 'sub-bulk-010', subscription_code: 'BT0001-S10' },
        { id: 'sub-bulk-011', subscription_code: 'BT0001-S11' },
        { id: 'sub-bulk-098', subscription_code: 'BT0001-S98' },
        { id: 'sub-bulk-099', subscription_code: 'BT0001-S99' },
        { id: 'sub-bulk-100', subscription_code: 'BT0001-S100' },
        { id: 'sub-bulk-101', subscription_code: 'BT0001-S101' },
      ]);

      const duplicates: Array<{ subscription_code: string; c: number }> = await connection.query(
        'SELECT subscription_code, COUNT(*) c FROM subscriptions GROUP BY subscription_code HAVING c > 1',
      );
      expect(duplicates).toHaveLength(0);
    });

    it('seeds each Customer sequence to its post-backfill subscription count', async () => {
      const rows: Array<{ customer_id: string; last_value: number }> = await connection.query(
        'SELECT customer_id, last_value FROM subscription_code_sequences ORDER BY customer_id',
      );
      expect(rows).toEqual([
        { customer_id: 'cust-bulk', last_value: 101 },
        { customer_id: 'cust-ff1', last_value: 3 },
        { customer_id: 'cust-ns1', last_value: 2 },
      ]);
    });

    it('leaves no subscription on a temporary migration code', async () => {
      const stragglers: Array<{ id: string }> = await connection.query(
        "SELECT id FROM subscriptions WHERE subscription_code LIKE '__scode_migrating__%'",
      );
      expect(stragglers).toHaveLength(0);
    });

    it('the real SubscriptionCodeService continues the seeded sequence: the 102nd subscription for the 101-subscription customer gets S102', async () => {
      const service = new SubscriptionCodeService();
      const code = await prisma.$transaction((tx) => service.next(tx, 'cust-bulk'));
      expect(code).toBe('BT0001-S102');
    });
  });

  describe('preflight guard: an existing code already equals a computed temporary code', () => {
    let connection: Connection;

    beforeAll(async () => {
      const url = databaseUrl as string;
      connection = await mariadb.createConnection(connectionOptions(url));
      await resetDatabase(connection);
      await connection.query(priorMigrations);
      await seedBaseCatalog(connection);
      await connection.query(`
        -- sub-y's CURRENT code deliberately equals the TEMPORARY code phase 1 would assign sub-x
        -- (CONCAT('__scode_migrating__', 'sub-x')) — the preflight guard must catch this and abort
        -- before touching any subscriptions row.
        INSERT INTO subscriptions (id, customer_id, service_type_id, subscription_code, name, start_date, renewal_date, billing_frequency, selling_price, currency, status, created_at, updated_at)
        VALUES
          ('sub-x', 'cust-ff1', 'svc-1', 'LEG-S-XXXXXXXXXXXXXXXX',   'Sub X', '2026-01-01', '2027-01-01', 'ANNUAL', '100.000', 'JOD', 'ACTIVE', '2026-01-01 10:00:00', NOW()),
          ('sub-y', 'cust-ff1', 'svc-1', '__scode_migrating__sub-x', 'Sub Y', '2026-01-01', '2027-01-01', 'ANNUAL', '100.000', 'JOD', 'ACTIVE', '2026-01-02 10:00:00', NOW());
      `);
    }, 30_000);

    afterAll(async () => {
      if (connection) {
        await resetDatabase(connection);
        await connection.end();
      }
    }, 30_000);

    it('aborts before modifying any subscription row, and original codes remain exactly as they were', async () => {
      await expect(connection.query(backfillMigration)).rejects.toThrow(/Duplicate entry/i);

      const rows: Array<{ id: string; subscription_code: string }> = await connection.query(
        'SELECT id, subscription_code FROM subscriptions ORDER BY id',
      );
      expect(rows).toEqual([
        { id: 'sub-x', subscription_code: 'LEG-S-XXXXXXXXXXXXXXXX' },
        { id: 'sub-y', subscription_code: '__scode_migrating__sub-x' },
      ]);
    });
  });

  describe('transactional rollback when the data rewrite fails partway through', () => {
    let connection: Connection;

    beforeAll(async () => {
      const url = databaseUrl as string;
      connection = await mariadb.createConnection(connectionOptions(url));
      await resetDatabase(connection);
      await connection.query(priorMigrations);
      await seedBaseCatalog(connection);
      await connection.query(`
        INSERT INTO subscriptions (id, customer_id, service_type_id, subscription_code, name, start_date, renewal_date, billing_frequency, selling_price, currency, status, created_at, updated_at)
        VALUES
          ('sub-a', 'cust-ff1', 'svc-1', 'LEG-S-AAAAAAAAAAAAAAAA', 'Sub A', '2026-01-01', '2027-01-01', 'ANNUAL', '100.000', 'JOD', 'ACTIVE', '2026-01-01 10:00:00', NOW()),
          ('sub-b', 'cust-ff1', 'svc-1', 'LEG-S-BBBBBBBBBBBBBBBB', 'Sub B', '2026-01-01', '2027-01-01', 'ANNUAL', '100.000', 'JOD', 'ACTIVE', '2026-01-02 10:00:00', NOW());
      `);
    }, 30_000);

    afterAll(async () => {
      if (connection) {
        await resetDatabase(connection);
        await connection.end();
      }
    }, 30_000);

    it("rolls Phase 1's temporary renames back when a later statement in the same transaction fails, leaving the original codes untouched", async () => {
      await expect(connection.query(migrationWithSabotagedPhase2())).rejects.toThrow(
        /this_column_does_not_exist/i,
      );

      // Verify via a FRESH connection (a new session), not the one the failed transaction ran on.
      // MariaDB guarantees an uncommitted transaction is rolled back when its session disconnects,
      // exactly what happens in production when a failed `prisma migrate deploy` run exits — reading
      // this back on the SAME connection would only prove the failing session can see its own
      // (possibly still-open, uncommitted) writes, not that the data was genuinely rolled back.
      await connection.end();
      connection = await mariadb.createConnection(connectionOptions(databaseUrl as string));

      const rows: Array<{ id: string; subscription_code: string }> = await connection.query(
        'SELECT id, subscription_code FROM subscriptions ORDER BY id',
      );
      // Must be the ORIGINAL codes — not stuck on `__scode_migrating__...` from the rolled-back
      // Phase 1.
      expect(rows).toEqual([
        { id: 'sub-a', subscription_code: 'LEG-S-AAAAAAAAAAAAAAAA' },
        { id: 'sub-b', subscription_code: 'LEG-S-BBBBBBBBBBBBBBBB' },
      ]);
    });
  });
});
