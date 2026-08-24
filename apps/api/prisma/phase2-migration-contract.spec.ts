import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const schema = readFileSync(join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8');
const migration = readFileSync(
  join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260824000000_phase_2_renewal_engine',
    'migration.sql',
  ),
  'utf8',
);

describe('Phase 2 MariaDB migration contract', () => {
  it('creates all renewal configuration, hold, outbox, and decision tables', () => {
    for (const table of [
      'renewal_templates',
      'reminder_rules',
      'notification_rules',
      'renewal_holds',
      'communication_outbox',
      'renewal_evaluation_decisions',
    ]) {
      expect(migration).toContain(`CREATE TABLE \`${table}\``);
    }
  });

  it('enforces renewal-cycle and communication idempotency in MariaDB', () => {
    expect(schema).toContain('@@unique([subscriptionId, dueDate])');
    expect(migration).toContain(
      'UNIQUE INDEX `reminder_rules_days_before_due_key`(`days_before_due`)',
    );
    expect(migration).toContain(
      'UNIQUE INDEX `communication_outbox_idempotency_key_key`(`idempotency_key`)',
    );
    expect(migration).toContain(
      'UNIQUE INDEX `renewal_evaluation_decisions_decision_key_key`(`decision_key`)',
    );
    expect(migration).toContain('`idempotency_key` VARCHAR(191) NOT NULL');
  });

  it('preserves MariaDB JSON, text, UUID-string, and foreign-key mappings', () => {
    expect(migration).toContain('`recipient_roles` JSON NOT NULL');
    expect(migration).toContain('`body` TEXT NOT NULL');
    expect(migration).toContain('`renewal_case_id` VARCHAR(36) NOT NULL');
    expect(migration).toContain('FOREIGN KEY (`audit_event_id`) REFERENCES `audit_events`(`id`)');
    expect(migration).not.toMatch(/\bJSONB\b|\bUUID\b|LANGUAGE plpgsql|CREATE TYPE|DO \$\$/i);
  });
});
