// Run from the repository root: node --test apps/api/prisma/p01-additive-migrations.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migrations = new URL('./migrations/', import.meta.url);
const metadata = '20261122000000_p01_nullable_renewal_and_communication_metadata';
const invoiceSource = '20261122001000_p01_optional_invoice_renewal_source';
const schema = readFileSync(new URL('./schema.prisma', import.meta.url), 'utf8');

function migrationSql(name) {
  return readFileSync(new URL(`${name}/migration.sql`, migrations), 'utf8');
}

function statements(name) {
  return migrationSql(name)
    .replace(/^\s*--[^\r\n]*/gm, '')
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

test('P0.1 migrations follow the checked-in table and foreign-key prerequisites', () => {
  const names = readdirSync(migrations, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const prerequisites = [
    ['20260823000000_mariadb_phase_0_1_foundation', 'renewal_cases', metadata],
    ['20260824000000_phase_2_renewal_engine', 'communication_outbox', metadata],
    ['20260910000000_phase3_slice_a_communication_domain', 'email_messages', metadata],
    ['20261117000000_phase4a_manual_invoice_foundation', 'invoices', invoiceSource],
  ];
  for (const [name, table, consumer] of prerequisites) {
    assert.ok(names.includes(name) && names.includes(consumer) && name < consumer);
    assert.ok(migrationSql(name).includes(`CREATE TABLE \`${table}\``));
  }

  for (const [name, table] of [prerequisites[0], prerequisites[3]]) {
    const definition = migrationSql(name).split(`CREATE TABLE \`${table}\``)[1].split(';')[0];
    assert.match(definition, /`id` VARCHAR\(36\) NOT NULL/);
    assert.match(definition, /PRIMARY KEY \(`id`\)/);
    assert.match(definition, /CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci/);
  }
});

test('metadata DDL only adds nullable state without updating legacy rows', () => {
  assert.deepEqual(statements(metadata), [
    'ALTER TABLE `renewal_cases` ADD COLUMN `proposed_period_start` DATE NULL, ADD COLUMN `proposed_period_end` DATE NULL, ADD COLUMN `proposed_next_renewal_date` DATE NULL',
    'ALTER TABLE `communication_outbox` ADD COLUMN `manual_approved_by` VARCHAR(36) NULL',
    'ALTER TABLE `email_messages` ADD COLUMN `reviewed_at` DATETIME(3) NULL, ADD COLUMN `reviewed_by` VARCHAR(36) NULL',
  ]);
});

test('invoice DDL adds an optional indexed reference and protects linked renewals', () => {
  assert.deepEqual(statements(invoiceSource), [
    'ALTER TABLE `invoices` ADD COLUMN `source_renewal_case_id` VARCHAR(36) NULL, ' +
      'ADD INDEX `invoices_source_renewal_case_id_idx` (`source_renewal_case_id`), ' +
      'ADD CONSTRAINT `invoices_source_renewal_case_id_fkey` FOREIGN KEY (`source_renewal_case_id`) ' +
      'REFERENCES `renewal_cases` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  ]);
});

test('P0.1 columns match the existing optional Prisma mappings', () => {
  const mappings = {
    RenewalCase: [
      /proposedPeriodStart\s+DateTime\? @map\("proposed_period_start"\) @db.Date/,
      /proposedPeriodEnd\s+DateTime\? @map\("proposed_period_end"\) @db.Date/,
      /proposedNextRenewalDate\s+DateTime\? @map\("proposed_next_renewal_date"\) @db.Date/,
    ],
    CommunicationOutbox: [/manualApprovedBy\s+String\? @map\("manual_approved_by"\) @db.VarChar\(36\)/],
    EmailMessage: [
      /reviewedAt\s+DateTime\? @map\("reviewed_at"\)/,
      /reviewedBy\s+String\? @map\("reviewed_by"\) @db.VarChar\(36\)/,
    ],
    Invoice: [
      /sourceRenewalCaseId\s+String\? @map\("source_renewal_case_id"\) @db.VarChar\(36\)/,
      /sourceRenewalCase\s+RenewalCase\? @relation\(fields: \[sourceRenewalCaseId\], references: \[id\], onDelete: Restrict\)/,
      /@@index\(\[sourceRenewalCaseId\]\)/,
    ],
  };

  for (const [name, fields] of Object.entries(mappings)) {
    const model = schema.match(new RegExp(`^model ${name} \\{([\\s\\S]*?)^\\}`, 'm'));
    assert.ok(model, `Missing Prisma model ${name}`);
    for (const field of fields) {
      assert.match(model[1], field);
    }
  }
});
