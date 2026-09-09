import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import mariadb, { type Connection } from 'mariadb';

// This test seeds PRE-migration data (raw SQL, bypassing Prisma so the rows look exactly like
// production rows from before the redesign) and then applies ONLY the
// `20260909000000_subscription_code_sequences_and_backfill` migration on top, to prove the backfill
// itself is correct end-to-end against a real MariaDB server — not just reasoned about. In
// particular it reproduces the exact collision/swap scenario the owner asked to be covered: an
// existing subscription's OLD code (free text, entered before this redesign) coincidentally equals
// the NEW code another subscription is about to be assigned. See the migration's own comments for
// why a naive single-pass rename is unsafe here (MariaDB/InnoDB checks the UNIQUE constraint per row
// during an UPDATE, not deferred to end-of-statement) and how the two-phase rename avoids it.
const databaseUrl = process.env.MARIADB_TEST_DATABASE_URL;
const liveDescribe = databaseUrl ? describe : describe.skip;

const priorMigrations = [
  '20260823000000_mariadb_phase_0_1_foundation',
  '20260824000000_phase_2_renewal_engine',
  '20260827000000_phase_2_1_operational_data',
  '20260827010000_scope_legacy_import_active_sheet',
  '20260831000000_currency_and_contact_channels',
  '20260906000000_canonical_phone_contact_and_source_order',
  '20260908000000_customer_code_sequences_and_bilingual_names',
]
  .map((directory) =>
    readFileSync(join(process.cwd(), 'prisma', 'migrations', directory, 'migration.sql'), 'utf8'),
  )
  .join('\n');

const backfillMigration = readFileSync(
  join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260909000000_subscription_code_sequences_and_backfill',
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

liveDescribe('Subscription Code backfill migration against real pre-existing data', () => {
  let connection: Connection;

  beforeAll(async () => {
    const url = databaseUrl as string;
    connection = await mariadb.createConnection(connectionOptions(url));
    await resetDatabase(connection);
    await connection.query(priorMigrations);

    await connection.query(`
      INSERT INTO billing_entities (id, name, code, customer_code_prefix, payment_scope, legal_name, active, created_at, updated_at)
      VALUES
        ('be-1', 'Future Foresight', 'FUTURE_FORESIGHT_INTERNATIONAL', 'FF', 'INTERNATIONAL', 'Future Foresight Intl', 1, NOW(), NOW()),
        ('be-2', 'New Serve', 'NEW_SERVE_LOCAL', 'NS', 'LOCAL', 'New Serve Local', 1, NOW(), NOW());

      INSERT INTO customers (id, billing_entity_id, customer_code, name_en, primary_email, status, created_at, updated_at)
      VALUES
        ('cust-ff1', 'be-1', 'FF0001', 'FF Customer One', 'ff1@example.test', 'ACTIVE', NOW(), NOW()),
        ('cust-ns1', 'be-2', 'NS0001', 'NS Customer One', 'ns1@example.test', 'ACTIVE', NOW(), NOW());

      INSERT INTO service_types (id, code, name, active, created_at, updated_at)
      VALUES ('svc-1', 'HOSTING', 'Hosting', 1, NOW(), NOW());

      -- FF0001: the exact collision/swap scenario the owner specified — Sub A has an old free-text
      -- code but is chronologically first (should become FF0001-S01), while Sub B is chronologically
      -- second (should become FF0001-S02) but its EXISTING code already literally equals Sub A's
      -- target. A naive single-pass UPDATE can fail here depending on row processing order; this
      -- migration must not.
      INSERT INTO subscriptions (id, customer_id, service_type_id, subscription_code, name, start_date, renewal_date, billing_frequency, selling_price, currency, status, created_at, updated_at)
      VALUES
        ('sub-a', 'cust-ff1', 'svc-1', 'LEG-S-AAAAAAAAAAAAAAAA', 'Sub A (chronologically first)', '2026-01-01', '2027-01-01', 'ANNUAL', '100.000', 'JOD', 'ACTIVE', '2026-01-01 10:00:00', NOW()),
        ('sub-b', 'cust-ff1', 'svc-1', 'FF0001-S01',              'Sub B (already has A''s target code)', '2026-01-01', '2027-01-01', 'ANNUAL', '100.000', 'JOD', 'ACTIVE', '2026-01-02 10:00:00', NOW()),
        ('sub-c', 'cust-ff1', 'svc-1', 'MANUAL-XYZ',              'Sub C (free text, unrelated shape)',   '2026-01-01', '2027-01-01', 'ANNUAL', '100.000', 'JOD', 'ACTIVE', '2026-01-03 10:00:00', NOW());

      -- NS0001: two subscriptions sharing an identical created_at, to prove id is the deterministic
      -- tie-breaker.
      INSERT INTO subscriptions (id, customer_id, service_type_id, subscription_code, name, start_date, renewal_date, billing_frequency, selling_price, currency, status, created_at, updated_at)
      VALUES
        ('sub-ns-2', 'cust-ns1', 'svc-1', 'LEG-S-2222222222222222', 'NS Sub 2', '2026-01-01', '2027-01-01', 'ANNUAL', '100.000', 'JOD', 'ACTIVE', '2026-02-01 09:00:00', NOW()),
        ('sub-ns-1', 'cust-ns1', 'svc-1', 'LEG-S-1111111111111111', 'NS Sub 1', '2026-01-01', '2027-01-01', 'ANNUAL', '100.000', 'JOD', 'ACTIVE', '2026-02-01 09:00:00', NOW());
    `);

    // The migration under test — applied on top of real pre-existing data, exactly as
    // `prisma migrate deploy` would apply it in production.
    await connection.query(backfillMigration);
  }, 30_000);

  afterAll(async () => {
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

  it('seeds each Customer sequence to its post-backfill subscription count', async () => {
    const rows: Array<{ customer_id: string; last_value: number }> = await connection.query(
      'SELECT customer_id, last_value FROM subscription_code_sequences ORDER BY customer_id',
    );
    expect(rows).toEqual([
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
});
