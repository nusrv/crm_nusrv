// Source-only P2.B guard: node --test apps/api/prisma/p2-folder-evidence-migration.test.mjs
// This test does NOT connect to MariaDB or activate any new mail worker.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ddl = readFileSync(
  new URL('./migrations/20261123014000_p2_folder_scoped_evidence_cursors/migration.sql', import.meta.url),
  'utf8',
);
const schema = readFileSync(new URL('./schema.prisma', import.meta.url), 'utf8');

test('P2.B migration is one purely additive table and does not modify existing IMAP cursors', () => {
  const statements = ddl
    .replace(/^\s*--[^\n]*/gm, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
  assert.equal(statements.length, 2);
  assert.match(statements[0], /^CREATE TABLE `mail_evidence_folder_checkpoints`/);
  assert.match(statements[1], /^ALTER TABLE `mail_evidence_folder_checkpoints`/);
  assert.doesNotMatch(ddl, /\b(?:INSERT|UPDATE|DELETE|DROP|TRUNCATE)\s+(?:INTO\s+|FROM\s+|TABLE\s+)?`?(?:mail_configurations|email_messages|communication_outbox)`?\b/mi);
  assert.doesNotMatch(ddl, /ALTER TABLE `mail_configurations`/);
  assert.doesNotMatch(ddl, /last_sync_uid|last_synced_at|inbound_sync_enabled/i);
});

test('P2.B new folder polling is disabled for every created checkpoint until explicit activation', () => {
  assert.match(ddl, /`sync_enabled` BOOLEAN NOT NULL DEFAULT false/);
  assert.match(ddl, /`uid_validity` BIGINT NULL/);
  assert.match(ddl, /`last_uid` BIGINT NULL/);
  assert.match(ddl, /`capability` VARCHAR\(24\) NOT NULL DEFAULT 'UNPROBED'/);
  assert.match(schema, /syncEnabled\s+Boolean\s+@default\(false\) @map\("sync_enabled"\)/);
  assert.match(schema, /model MailEvidenceFolderCheckpoint \{/);
  assert.match(schema, /evidenceFolderCheckpoints\s+MailEvidenceFolderCheckpoint\[\]/);
});

test('P2.B exact-folder uniqueness, index names and relationship agree in SQL and Prisma', () => {
  const names = [
    'mail_evidence_folder_checkpoints_config_identity_uq',
    'mail_evidence_folder_checkpoints_config_kind_idx',
    'mail_evidence_folder_checkpoints_sync_enabled_idx',
    'mail_evidence_folder_checkpoints_configuration_fkey',
  ];
  for (const name of names) {
    assert.ok(name.length <= 64, `${name} exceeds MariaDB identifier limit`);
    assert.ok(ddl.includes(name), `SQL missing ${name}`);
    assert.ok(schema.includes(name), `Prisma missing ${name}`);
  }
  assert.match(ddl, /ON DELETE RESTRICT ON UPDATE CASCADE/);
  assert.match(ddl, /UNIQUE INDEX `mail_evidence_folder_checkpoints_config_identity_uq`\(`mail_configuration_id`, `folder_identity_key`\)/);
});
