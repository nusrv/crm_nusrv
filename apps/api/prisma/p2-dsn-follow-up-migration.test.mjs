import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('./migrations/20261125000000_p2_dsn_follow_up_storage/migration.sql', import.meta.url), 'utf8');
const commands = sql.replace(/^\s*--[^\n]*/gm, '').split(';').map(s => s.trim()).filter(Boolean);

test('migration only creates three new tables and two triggers on the new observation table', () => {
  assert.equal(commands.length, 5);
  assert.deepEqual(commands.slice(0, 3).map(s => /^CREATE TABLE `([^`]+)`/.exec(s)?.[1]), [
    'mail_provider_evidence_bindings', 'mail_dsn_follow_ups', 'mail_dsn_observations',
  ]);
  for (const command of commands.slice(3)) assert.match(command, /^CREATE TRIGGER `mail_dsn_observations_prevent_(update|delete)`\nBEFORE (UPDATE|DELETE) ON `mail_dsn_observations`/);
  assert.doesNotMatch(commands.join('\n'), /(?:^|\n)\s*(?:ALTER TABLE|INSERT INTO|UPDATE|DELETE FROM|DROP|TRUNCATE)\b/i);
});
test('current account generation is unique, historical binding cannot remain enabled', () => {
  assert.match(sql, /PRIMARY KEY \(`generation`\)/);
  assert.match(sql, /UNIQUE INDEX `mail_provider_bindings_current_uq`\(`current_mailbox_key`\)/);
  assert.match(sql, /`observation_enabled` BOOLEAN NOT NULL DEFAULT false/);
  assert.match(sql, /`current_mailbox_key` IS NULL AND `observation_enabled` = 0/);
  assert.match(sql, /BINARY `current_mailbox_key` = BINARY `mail_configuration_id`/);
});
test('task key is unique and resolution fields are coherent with status and revision', () => {
  assert.match(sql, /UNIQUE INDEX `mail_dsn_follow_ups_key_uq`\(`follow_up_key`\)/);
  assert.match(sql, /BINARY `subject_type` IN \(BINARY 'CommunicationOutbox', BINARY 'OperatorReplyOutbox'\)/);
  assert.match(sql, /BINARY `status` = BINARY 'OPEN' AND `revision` = 1 AND\s*`resolved_by_id` IS NULL AND `resolved_at` IS NULL AND `resolution_reason` IS NULL/);
  assert.match(sql, /BINARY `status` = BINARY 'RESOLVED' AND `revision` = 2 AND\s*`resolved_by_id` IS NOT NULL[^;]+`resolved_at` IS NOT NULL AND `resolution_reason` IS NOT NULL/);
});
test('unique events reference both matching account binding and task scopes, without cascade deletion', () => {
  assert.match(sql, /UNIQUE INDEX `mail_dsn_observations_key_uq`\(`observation_key`\)/);
  assert.match(sql, /CHECK \(BINARY `binding_mailbox_id` = BINARY `mail_configuration_id`\)/);
  assert.match(sql, /FOREIGN KEY \(`follow_up_key`, `mail_configuration_id`\)\s*REFERENCES `mail_dsn_follow_ups`\(`follow_up_key`, `mail_configuration_id`\) ON DELETE RESTRICT ON UPDATE RESTRICT/);
  assert.match(sql, /FOREIGN KEY \(`source_binding_key`, `binding_mailbox_id`\)\s*REFERENCES `mail_provider_evidence_bindings`\(`source_binding_key`, `mail_configuration_id`\) ON DELETE RESTRICT ON UPDATE RESTRICT/);
  assert.doesNotMatch(sql, /ON (DELETE|UPDATE) CASCADE/);
});
test('observations are append-only at SQL source level and storage has no send or delivery controls', () => {
  for (const action of ['UPDATE', 'DELETE']) assert.match(sql, new RegExp('BEFORE ' + action + " ON `mail_dsn_observations`\\s*FOR EACH ROW\\s*SIGNAL SQLSTATE '45000'"));
  assert.doesNotMatch(sql, /`(?:delivery_status|smtp_acceptance|send|resend|renewal_status|password|credentials_ciphertext|body_text|body_html|attachment)`/i);
  assert.match(sql, /CHECK \(`enhanced_status` REGEXP '\^5\[\.\]\[0-9\]\{1,3\}\[\.\]\[0-9\]\{1,3\}\$'\)/);
});
