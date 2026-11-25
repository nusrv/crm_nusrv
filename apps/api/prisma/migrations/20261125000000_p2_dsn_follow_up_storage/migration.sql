-- P2.D inactive storage for authenticated provider-account generations,
-- corroborated hard-failure follow-ups and their immutable observations.
-- New tables only. No existing data or cursor is backfilled, no source is enabled.
-- Provider authentication, current binding rotation, review-only persistence,
-- and actual migration/transaction rehearsal are separate release gates.
CREATE TABLE `mail_provider_evidence_bindings` (
    `generation` VARCHAR(36) NOT NULL,
    `mail_configuration_id` VARCHAR(36) NOT NULL,
    `current_mailbox_key` VARCHAR(36) NULL,
    `provider_namespace` VARCHAR(64) NOT NULL,
    `provider_account_id` VARCHAR(512) NOT NULL,
    `source_binding_key` VARCHAR(96) NOT NULL,
    `observation_enabled` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`generation`),
    UNIQUE INDEX `mail_provider_bindings_current_uq`(`current_mailbox_key`),
    UNIQUE INDEX `mail_provider_bindings_source_uq`(`source_binding_key`),
    UNIQUE INDEX `mail_provider_bindings_scope_uq`(`source_binding_key`, `mail_configuration_id`),
    INDEX `mail_provider_bindings_config_idx`(`mail_configuration_id`, `created_at`),
    CONSTRAINT `mail_provider_bindings_current_ck` CHECK (
        `observation_enabled` IN (0, 1) AND
        ((`current_mailbox_key` IS NULL AND `observation_enabled` = 0) OR
         (`current_mailbox_key` IS NOT NULL AND BINARY `current_mailbox_key` = BINARY `mail_configuration_id`))
    ),
    CONSTRAINT `mail_provider_bindings_config_fk` FOREIGN KEY (`mail_configuration_id`)
        REFERENCES `mail_configurations`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `mail_dsn_follow_ups` (
    `id` VARCHAR(36) NOT NULL,
    `follow_up_key` VARCHAR(80) NOT NULL,
    `mail_configuration_id` VARCHAR(36) NOT NULL,
    `subject_type` VARCHAR(32) NOT NULL,
    `subject_id` VARCHAR(36) NOT NULL,
    `attempt_id` VARCHAR(36) NOT NULL,
    `recipient` VARCHAR(320) NOT NULL,
    `original_message_id` VARCHAR(500) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    `revision` INTEGER NOT NULL DEFAULT 1,
    `resolved_by_id` VARCHAR(36) NULL,
    `resolved_at` DATETIME(3) NULL,
    `resolution_reason` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`),
    UNIQUE INDEX `mail_dsn_follow_ups_key_uq`(`follow_up_key`),
    UNIQUE INDEX `mail_dsn_follow_ups_scope_uq`(`follow_up_key`, `mail_configuration_id`),
    INDEX `mail_dsn_follow_ups_status_created_idx`(`status`, `created_at`),
    INDEX `mail_dsn_follow_ups_subject_idx`(`subject_type`, `subject_id`, `attempt_id`),
    CONSTRAINT `mail_dsn_follow_ups_subject_ck` CHECK (BINARY `subject_type` IN (BINARY 'CommunicationOutbox', BINARY 'OperatorReplyOutbox')),
    CONSTRAINT `mail_dsn_follow_ups_resolution_ck` CHECK (
        (BINARY `status` = BINARY 'OPEN' AND `revision` = 1 AND
         `resolved_by_id` IS NULL AND `resolved_at` IS NULL AND `resolution_reason` IS NULL) OR
        (BINARY `status` = BINARY 'RESOLVED' AND `revision` = 2 AND
         `resolved_by_id` IS NOT NULL AND CHAR_LENGTH(`resolved_by_id`) > 0 AND
         `resolved_at` IS NOT NULL AND `resolution_reason` IS NOT NULL AND CHAR_LENGTH(TRIM(`resolution_reason`)) > 0)
    ),
    CONSTRAINT `mail_dsn_follow_ups_config_fk` FOREIGN KEY (`mail_configuration_id`)
        REFERENCES `mail_configurations`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `mail_dsn_observations` (
    `id` VARCHAR(36) NOT NULL,
    `observation_key` VARCHAR(80) NOT NULL,
    `follow_up_key` VARCHAR(80) NOT NULL,
    `mail_configuration_id` VARCHAR(36) NOT NULL,
    `source_binding_key` VARCHAR(96) NOT NULL,
    `binding_mailbox_id` VARCHAR(36) NOT NULL,
    `source_object_id` VARCHAR(256) NOT NULL,
    `folder` VARCHAR(255) NOT NULL,
    `enhanced_status` VARCHAR(9) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`),
    UNIQUE INDEX `mail_dsn_observations_key_uq`(`observation_key`),
    INDEX `mail_dsn_observations_task_idx`(`follow_up_key`, `mail_configuration_id`),
    INDEX `mail_dsn_observations_binding_idx`(`source_binding_key`, `binding_mailbox_id`),
    CONSTRAINT `mail_dsn_observations_mailbox_ck` CHECK (BINARY `binding_mailbox_id` = BINARY `mail_configuration_id`),
    CONSTRAINT `mail_dsn_observations_hard_status_ck` CHECK (`enhanced_status` REGEXP '^5[.][0-9]{1,3}[.][0-9]{1,3}$'),
    CONSTRAINT `mail_dsn_observations_task_fk` FOREIGN KEY (`follow_up_key`, `mail_configuration_id`)
        REFERENCES `mail_dsn_follow_ups`(`follow_up_key`, `mail_configuration_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT `mail_dsn_observations_binding_fk` FOREIGN KEY (`source_binding_key`, `binding_mailbox_id`)
        REFERENCES `mail_provider_evidence_bindings`(`source_binding_key`, `mail_configuration_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TRIGGER `mail_dsn_observations_prevent_update`
BEFORE UPDATE ON `mail_dsn_observations`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'mail_dsn_observations are append-only';

CREATE TRIGGER `mail_dsn_observations_prevent_delete`
BEFORE DELETE ON `mail_dsn_observations`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'mail_dsn_observations are append-only';
