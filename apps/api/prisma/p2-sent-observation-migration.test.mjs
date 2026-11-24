import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Static source contract only. This does not start a mailbox, connect to a
// database, run a migration or change any operational mailbox state.
const migration = readFileSync(
  new URL('./migrations/20261123015000_p2_sent_observation_ledger/migration.sql', import.meta.url),
  'utf8',
);
const schema = readFileSync(new URL('./schema.prisma', import.meta.url), 'utf8');

test('P2.C introduces a ledger only; no preexisting table or cursor can be mutated', () => {
  const commands = migration
    .replace(/^\s*--[^\n]*/gm, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
  assert.equal(commands.length, 2);
  assert.match(commands[0], /^CREATE TABLE `mail_sent_observations`/);
  assert.match(commands[1], /^ALTER TABLE `mail_sent_observations`/);
  assert.doesNotMatch(migration, /\b(?:INSERT|UPDATE|DELETE|DROP|TRUNCATE)\s+(?:INTO\s+|FROM\s+|TABLE\s+)?`?(?:mail_configurations|email_messages|mail_evidence_folder_checkpoints)`?\b/mi);
  assert.doesNotMatch(migration, /ALTER TABLE `mail_configurations`/);
  assert.doesNotMatch(migration, /ALTER TABLE `mail_evidence_folder_checkpoints`/);
});

test('P2.C evidence storage has no body, recipients, credentials, delivery assertion or activation flag', () => {
  assert.match(schema, /model MailSentObservation \{/);
  assert.match(schema, /sentObservations\s+MailSentObservation\[\]/);
  assert.match(schema, /@@map\("mail_sent_observations"\)/);
  assert.match(migration, /\`delivery_status\` VARCHAR\(24\) NOT NULL DEFAULT 'UNKNOWN'/);
  assert.match(migration, /CHECK \(\`delivery_status\` = 'UNKNOWN'\)/);
  assert.match(migration, /CHECK \(\`uid_validity\` > 0 AND \`uid\` > 0\)/);
  assert.doesNotMatch(migration, /\`(?:body_text|body_html|to_addresses_json|envelope_recipient|password|credentials_ciphertext|sync_enabled)\`/);
  assert.doesNotMatch(migration, /(?:INSERT INTO|ALTER TABLE) \`email_messages\`/);
});

test('P2.C DB uniqueness and FK names are deterministic and within MariaDB limits', () => {
  const names = [
    'mail_sent_observations_source_key_uq',
    'mail_sent_observations_ckpt_uid_uq',
    'mail_sent_observations_ckpt_created_idx',
    'mail_sent_observations_checkpoint_fkey',
    'mail_sent_observations_unknown_delivery_ck',
    'mail_sent_observations_positive_uid_ck',
  ];
  for (const name of names) {
    assert.ok(name.length <= 64, `${name} exceeds MariaDB 64-character name limit`);
    assert.ok(migration.includes(name), `Migration does not contain ${name}`);
  }
  for (const name of names.slice(0, 4)) {
    assert.ok(schema.includes(name), `Prisma schema does not contain ${name}`);
  }
  assert.match(migration, /FOREIGN KEY \(\`folder_checkpoint_id\`\)/);
  assert.match(migration, /ON DELETE RESTRICT ON UPDATE CASCADE/);
});
