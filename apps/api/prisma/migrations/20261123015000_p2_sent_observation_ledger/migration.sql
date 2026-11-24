-- P2.C: independently auditable Sent-folder observation metadata only.
-- No existing table is modified; no existing mailbox is seeded or activated.
-- Observing a Sent item is NOT SMTP recipient acceptance, final delivery,
-- a customer decision, a DSN determination, or permission to retransmit.
-- No message body, addresses, attachments, or credentials are persisted here.
CREATE TABLE `mail_sent_observations` (
    `id` VARCHAR(36) NOT NULL,
    `folder_checkpoint_id` VARCHAR(36) NOT NULL,
    `source_identity_key` VARCHAR(67) NOT NULL,
    `uid_validity` BIGINT NOT NULL,
    `uid` BIGINT NOT NULL,
    `internal_date` DATETIME(3) NULL,
    `message_id_header` VARCHAR(500) NULL,
    `parse_failed` BOOLEAN NOT NULL DEFAULT false,
    `delivery_status` VARCHAR(24) NOT NULL DEFAULT 'UNKNOWN',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `mail_sent_observations_source_key_uq`(`source_identity_key`),
    UNIQUE INDEX `mail_sent_observations_ckpt_uid_uq`(`folder_checkpoint_id`, `uid_validity`, `uid`),
    INDEX `mail_sent_observations_ckpt_created_idx`(`folder_checkpoint_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `mail_sent_observations`
    ADD CONSTRAINT `mail_sent_observations_checkpoint_fkey`
    FOREIGN KEY (`folder_checkpoint_id`)
    REFERENCES `mail_evidence_folder_checkpoints`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
