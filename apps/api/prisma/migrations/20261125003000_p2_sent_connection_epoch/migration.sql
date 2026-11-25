-- Preserve historical rows and legacy identities. No activation or cursor rewind.
CREATE TABLE `mail_sent_connection_epochs` (
  `mail_configuration_id` VARCHAR(36) NOT NULL,
  `generation` VARCHAR(36) NOT NULL,
  PRIMARY KEY (`mail_configuration_id`),
  CONSTRAINT `mail_sent_connection_epochs_config_fk` FOREIGN KEY (`mail_configuration_id`) REFERENCES `mail_configurations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `mail_evidence_folder_checkpoints`
  ADD COLUMN `connection_generation` VARCHAR(36) NOT NULL DEFAULT 'legacy',
  DROP INDEX `mail_evidence_folder_checkpoints_config_identity_uq`,
  ADD UNIQUE INDEX `mail_evidence_folder_checkpoints_config_identity_uq` (`mail_configuration_id`, `folder_identity_key`, `connection_generation`);
CREATE TRIGGER `mail_configurations_retire_sent_epoch`
AFTER UPDATE ON `mail_configurations`
FOR EACH ROW
DELETE FROM `mail_sent_connection_epochs`
WHERE `mail_configuration_id` = OLD.`id`
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
