import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('./migrations/20261125001000_p2_provider_binding_invalidation/migration.sql', import.meta.url), 'utf8');
const commands = sql.replace(/^\s*--[^\n]*/gm, '').split(';').map(s => s.trim()).filter(Boolean);
test('invalidation installs only two AFTER UPDATE triggers, with no immediate data writes', () => {
  assert.equal(commands.length, 2);
  for (const s of commands) assert.match(s, /^CREATE TRIGGER `mail_configurations_\w+`\s+AFTER UPDATE ON `mail_configurations`\s+FOR EACH ROW\s+UPDATE /);
  assert.match(commands[0], /UPDATE `mail_provider_evidence_bindings`\s+SET `current_mailbox_key` = NULL, `observation_enabled` = false/);
  assert.match(commands[1], /UPDATE `mail_evidence_folder_checkpoints`\s+SET `sync_enabled` = false, `capability` = 'UNPROBED'/);
});
test('both triggers cover exact connection, credentials, scope and operational toggle changes including NULL transitions', () => {
  for (const s of commands) {
    for (const c of ['scope_key','billing_entity_id','environment','smtp_host','smtp_username','smtp_credentials_ciphertext','imap_host','imap_username','imap_credentials_ciphertext','imap_folder','from_address']) {
      assert.ok(s.includes('(BINARY OLD.`'+c+'` <=> BINARY NEW.`'+c+'`)'), c);
    }
    for (const c of ['enabled','inbound_sync_enabled','outbound_send_enabled','smtp_port','smtp_secure','imap_port','imap_secure','outbound_send_cutover_at']) {
      assert.ok(s.includes('(OLD.`'+c+'` <=> NEW.`'+c+'`)'), c);
    }
    assert.doesNotMatch(s, /(?:OLD|NEW)\.`(?:updated_at|last_health_status|last_health_checked_at|last_synced_at|last_sync_uid|last_sync_uid_validity)`/);
  }
});
test('retirement preserves generations and old cursors; only exact SENT checkpoint capability is invalidated', () => {
  assert.match(commands[0], /WHERE `current_mailbox_key` = OLD\.`id`/);
  assert.match(commands[1], /WHERE `mail_configuration_id` = OLD\.`id` AND BINARY `source_kind` = BINARY 'SENT'/);
  assert.doesNotMatch(sql, /`(?:uid_validity|last_uid|last_sync_uid|last_sync_uid_validity|generation|source_binding_key|delivery_status)`\s*=/i);
  assert.doesNotMatch(sql, /\b(?:DELETE FROM|INSERT INTO|DROP TABLE|TRUNCATE TABLE)\b/i);
});
