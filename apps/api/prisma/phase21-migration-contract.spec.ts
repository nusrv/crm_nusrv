import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Phase 2.1 MariaDB migration contract', () => {
  const schema = readFileSync(join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8');
  const migration = readFileSync(
    join(
      process.cwd(),
      'prisma',
      'migrations',
      '20260827000000_phase_2_1_operational_data',
      'migration.sql',
    ),
    'utf8',
  );

  it('adds package catalog, contacts, identifiers, snapshots, and custom interval storage', () => {
    expect(schema).toContain('model ServicePackage');
    expect(schema).toContain('model ServicePackageTerm');
    expect(schema).toContain('model CustomerContact');
    expect(schema).toContain('model SubscriptionIdentifier');
    expect(schema).toContain('renewalIntervalMonths');
    expect(schema).toContain('packageNameSnapshot');
    expect(schema).toContain('classificationEvidence');
    expect(migration).toContain('CREATE TABLE `service_packages`');
    expect(migration).toContain('CREATE TABLE `service_package_terms`');
    expect(migration).toContain('CREATE TABLE `customer_contacts`');
    expect(migration).toContain('CREATE TABLE `subscription_identifiers`');
    expect(migration).toContain('CHECK (`renewal_interval_months` IS NULL OR');
  });

  it('is additive and preserves MariaDB/UUID/JSON/Decimal conventions', () => {
    expect(schema).toContain('provider = "mysql"');
    expect(migration).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE/i);
    expect(migration).toContain('VARCHAR(36)');
    expect(migration).toContain('JSON NULL');
    expect(migration).toContain('DECIMAL(14, 3)');
    expect(migration).toContain('ON DELETE RESTRICT');
  });
});
