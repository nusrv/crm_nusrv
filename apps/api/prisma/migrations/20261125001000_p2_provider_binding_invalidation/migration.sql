-- P2: retire the provider generation on any material mailbox setting change,
-- including writes through the provisioning CLI and direct ADMIN updates.
-- Preserve all prior observations. Routine health/cursor writes do not retire it.
-- New triggers only: no backfill, send, cursor reset, or activation.
CREATE TRIGGER `mail_configurations_retire_provider_binding`
AFTER UPDATE ON `mail_configurations`
FOR EACH ROW
UPDATE `mail_provider_evidence_bindings`
SET `current_mailbox_key` = NULL, `observation_enabled` = false, `updated_at` = CURRENT_TIMESTAMP(3)
WHERE `current_mailbox_key` = OLD.`id`
    AND NOT (
        (BINARY OLD.`scope_key` <=> BINARY NEW.`scope_key`)
        AND (BINARY OLD.`billing_entity_id` <=> BINARY NEW.`billing_entity_id`)
        AND (BINARY OLD.`environment` <=> BINARY NEW.`environment`)
        AND (BINARY OLD.`smtp_host` <=> BINARY NEW.`smtp_host`)
        AND (BINARY OLD.`smtp_username` <=> BINARY NEW.`smtp_username`)
        AND (BINARY OLD.`smtp_credentials_ciphertext` <=> BINARY NEW.`smtp_credentials_ciphertext`)
        AND (BINARY OLD.`imap_host` <=> BINARY NEW.`imap_host`)
        AND (BINARY OLD.`imap_username` <=> BINARY NEW.`imap_username`)
        AND (BINARY OLD.`imap_credentials_ciphertext` <=> BINARY NEW.`imap_credentials_ciphertext`)
        AND (BINARY OLD.`imap_folder` <=> BINARY NEW.`imap_folder`)
        AND (BINARY OLD.`from_address` <=> BINARY NEW.`from_address`)
        AND (OLD.`enabled` <=> NEW.`enabled`)
        AND (OLD.`inbound_sync_enabled` <=> NEW.`inbound_sync_enabled`)
        AND (OLD.`outbound_send_enabled` <=> NEW.`outbound_send_enabled`)
        AND (OLD.`smtp_port` <=> NEW.`smtp_port`)
        AND (OLD.`smtp_secure` <=> NEW.`smtp_secure`)
        AND (OLD.`imap_port` <=> NEW.`imap_port`)
        AND (OLD.`imap_secure` <=> NEW.`imap_secure`)
        AND (OLD.`outbound_send_cutover_at` <=> NEW.`outbound_send_cutover_at`)
    );

-- Sent checkpoint history stays intact. A future explicitly approved baseline
-- must be scoped to a verified new binding; never reuse the old cursor silently.
CREATE TRIGGER `mail_configurations_invalidate_sent_checkpoint`
AFTER UPDATE ON `mail_configurations`
FOR EACH ROW
UPDATE `mail_evidence_folder_checkpoints`
SET `sync_enabled` = false, `capability` = 'UNPROBED', `last_probe_at` = NULL,
    `last_error` = 'MAIL_CONFIGURATION_CHANGED_REVIEW_REQUIRED', `updated_at` = CURRENT_TIMESTAMP(3)
WHERE `mail_configuration_id` = OLD.`id` AND BINARY `source_kind` = BINARY 'SENT'
    AND NOT (
        (BINARY OLD.`scope_key` <=> BINARY NEW.`scope_key`)
        AND (BINARY OLD.`billing_entity_id` <=> BINARY NEW.`billing_entity_id`)
        AND (BINARY OLD.`environment` <=> BINARY NEW.`environment`)
        AND (BINARY OLD.`smtp_host` <=> BINARY NEW.`smtp_host`)
        AND (BINARY OLD.`smtp_username` <=> BINARY NEW.`smtp_username`)
        AND (BINARY OLD.`smtp_credentials_ciphertext` <=> BINARY NEW.`smtp_credentials_ciphertext`)
        AND (BINARY OLD.`imap_host` <=> BINARY NEW.`imap_host`)
        AND (BINARY OLD.`imap_username` <=> BINARY NEW.`imap_username`)
        AND (BINARY OLD.`imap_credentials_ciphertext` <=> BINARY NEW.`imap_credentials_ciphertext`)
        AND (BINARY OLD.`imap_folder` <=> BINARY NEW.`imap_folder`)
        AND (BINARY OLD.`from_address` <=> BINARY NEW.`from_address`)
        AND (OLD.`enabled` <=> NEW.`enabled`)
        AND (OLD.`inbound_sync_enabled` <=> NEW.`inbound_sync_enabled`)
        AND (OLD.`outbound_send_enabled` <=> NEW.`outbound_send_enabled`)
        AND (OLD.`smtp_port` <=> NEW.`smtp_port`)
        AND (OLD.`smtp_secure` <=> NEW.`smtp_secure`)
        AND (OLD.`imap_port` <=> NEW.`imap_port`)
        AND (OLD.`imap_secure` <=> NEW.`imap_secure`)
        AND (OLD.`outbound_send_cutover_at` <=> NEW.`outbound_send_cutover_at`)
    );
