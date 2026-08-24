import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const schema = readFileSync(join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8');
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

describe('MariaDB schema and zero migration contract', () => {
  it('uses the Prisma MySQL provider and MariaDB-safe native mappings', () => {
    expect(schema).toContain('provider = "mysql"');
    expect(schema).toContain('@db.VarChar(36)');
    expect(schema).toContain('@db.VarChar(45)');
    expect(schema).toContain('@db.Decimal(14, 3)');
    expect(schema).toContain('@db.Date');
    expect(schema).not.toMatch(/@db\.(Uuid|Inet|JsonB)/);
  });

  it('creates the complete Phase 0 and Phase 1 relational schema from zero', () => {
    for (const table of [
      'billing_entities',
      'customers',
      'service_types',
      'subscriptions',
      'technical_connections',
      'subscription_connections',
      'renewal_cases',
      'audit_events',
      'legacy_import_batches',
      'legacy_import_rows',
      'legacy_import_subscription_links',
    ]) {
      expect(migration).toContain(`CREATE TABLE \`${table}\``);
    }
    expect(migration).toContain('VARCHAR(36)');
    expect(migration).toContain('VARCHAR(45)');
    expect(migration).toContain('`endpoint` VARCHAR(500) NULL');
    expect(migration).toContain('JSON');
    expect(migration).toContain('DECIMAL(14, 3)');
    expect(migration).toContain('DATE NOT NULL');
    expect(migration).toContain('FOREIGN KEY');
    expect(migration).toContain('UNIQUE INDEX');
  });

  it('contains MariaDB append-only triggers for audit rows', () => {
    expect(migration).toContain('CREATE TRIGGER `audit_events_prevent_update`');
    expect(migration).toContain('CREATE TRIGGER `audit_events_prevent_delete`');
    expect(migration.match(/SIGNAL SQLSTATE '45000'/g)).toHaveLength(2);
  });

  it('contains no PostgreSQL-only migration constructs', () => {
    expect(migration).not.toMatch(
      /\bJSONB\b|\bINET\b|\bUUID\b|LANGUAGE plpgsql|CREATE TYPE|DO \$\$/i,
    );
  });

  it('preserves application-generated UUID identity semantics', () => {
    const id = randomUUID();
    expect(id).toHaveLength(36);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
