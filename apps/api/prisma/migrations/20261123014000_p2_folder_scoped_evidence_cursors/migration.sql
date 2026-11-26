-- P2.B: purely additive, inactive IMAP evidence-folder checkpoint inventory.
-- Existing MailConfiguration inbound fields/cursors and active worker queries stay
-- untouched. No INSERT/UPDATE/backfill; zero new sync jobs are activated.
-- IMPORTANT: do not infer a Sent folder or treat the old INBOX cursor as a
-- safely transferable cursor until physical schema and folder identity are verified.
--
-- folder_identity_key is a versioned lowercase SHA-256 digest of the canonical
-- folder name computed by trusted application code. Only RFC 3501 INBOX gets
-- case-folded; all other names, including Sent vs sent, remain distinct.
-- It is paired with mail_configuration_id because a folder belongs to exactly
-- one configured mailbox. Folder name alone is NOT a deduplication key.
CREATE TABLE `mail_evidence_folder_checkpoints` (
    `id` VARCHAR(36) NOT NULL,
    `mail_configuration_id` VARCHAR(36) NOT NULL,
    `folder_name` VARCHAR(255) NOT NULL,
    `folder_identity_key` VARCHAR(67) NOT NULL,
    `source_kind` VARCHAR(24) NOT NULL,
    `sync_enabled` BOOLEAN NOT NULL DEFAULT false,
    `uid_validity` BIGINT NULL,
    `last_uid` BIGINT NULL,
    `capability` VARCHAR(24) NOT NULL DEFAULT 'UNPROBED',
    `last_probe_at` DATETIME(3) NULL,
    `last_observed_at` DATETIME(3) NULL,
    `last_error` VARCHAR(1000) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `mail_evidence_folder_checkpoints_config_identity_uq`(`mail_configuration_id`, `folder_identity_key`),
    INDEX `mail_evidence_folder_checkpoints_config_kind_idx`(`mail_configuration_id`, `source_kind`),
    INDEX `mail_evidence_folder_checkpoints_sync_enabled_idx`(`sync_enabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `mail_evidence_folder_checkpoints`
    ADD CONSTRAINT `mail_evidence_folder_checkpoints_configuration_fkey`
    FOREIGN KEY (`mail_configuration_id`)
    REFERENCES `mail_configurations`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
