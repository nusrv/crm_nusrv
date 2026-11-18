-- AlterTable
ALTER TABLE `billing_entities` ADD COLUMN `last_invoice_counter` BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `invoices` ADD COLUMN `buyer_country_code_snapshot` VARCHAR(2) NULL,
    ADD COLUMN `invoice_counter` BIGINT NULL,
    ADD COLUMN `invoice_type_name` VARCHAR(3) NULL,
    ADD COLUMN `issuer_country_code_snapshot` VARCHAR(2) NULL,
    ADD COLUMN `selected_connection_id` VARCHAR(36) NULL,
    ADD COLUMN `submission_lock` VARCHAR(36) NULL,
    ADD COLUMN `revision` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `submission_uuid` VARCHAR(36) NULL;
UPDATE invoices SET submission_uuid = UUID() WHERE submission_uuid IS NULL;
ALTER TABLE invoices MODIFY submission_uuid VARCHAR(36) NOT NULL;
CREATE TEMPORARY TABLE invoice_counter_backfill AS
 SELECT id, ROW_NUMBER() OVER (PARTITION BY billing_entity_id ORDER BY created_at, id) AS counter_value FROM invoices;
UPDATE invoices i JOIN invoice_counter_backfill b ON b.id=i.id SET i.invoice_counter=b.counter_value;
DROP TEMPORARY TABLE invoice_counter_backfill;
UPDATE billing_entities b SET last_invoice_counter=(SELECT COALESCE(MAX(i.invoice_counter),0) FROM invoices i WHERE i.billing_entity_id=b.id);

-- CreateTable
CREATE TABLE `jofotara_connections` (
    `id` VARCHAR(36) NOT NULL,
    `billing_entity_id` VARCHAR(36) NOT NULL,
    `display_name` VARCHAR(191) NOT NULL,
    `user_label` VARCHAR(191) NULL,
    `income_source_sequence` VARCHAR(80) NOT NULL,
    `client_id_ciphertext` TEXT NULL,
    `secret_key_ciphertext` TEXT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `production_submission_enabled` BOOLEAN NOT NULL DEFAULT false,
    `default_entity_key` VARCHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `last_used_at` DATETIME(3) NULL,
    `disabled_at` DATETIME(3) NULL,

    UNIQUE INDEX `jofotara_connections_default_entity_key_key`(`default_entity_key`),
    INDEX `jofotara_connections_billing_entity_id_enabled_idx`(`billing_entity_id`, `enabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fawtara_submissions` (
    `id` VARCHAR(36) NOT NULL,
    `invoice_id` VARCHAR(36) NOT NULL,
    `jofotara_connection_id` VARCHAR(36) NOT NULL,
    `attempt_number` INTEGER NOT NULL,
    `business_id` VARCHAR(80) NOT NULL,
    `business_uuid` VARCHAR(36) NOT NULL,
    `request_xml_hash` VARCHAR(64) NOT NULL,
    `request_xml` LONGTEXT NOT NULL,
    `connection_name_snapshot` VARCHAR(191) NOT NULL,
    `income_source_snapshot` VARCHAR(80) NOT NULL,
    `http_status` INTEGER NULL,
    `einv_status` VARCHAR(50) NULL,
    `results` JSON NULL,
    `message` TEXT NULL,
    `official_number` VARCHAR(191) NULL,
    `official_uuid` VARCHAR(191) NULL,
    `official_qr` TEXT NULL,
    `outcome` VARCHAR(30) NOT NULL,
    `error_classification` VARCHAR(50) NULL,
    `actor_id` VARCHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `submitted_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,

    INDEX `fawtara_submissions_jofotara_connection_id_created_at_idx`(`jofotara_connection_id`, `created_at`),
    UNIQUE INDEX `fawtara_submissions_invoice_id_attempt_number_key`(`invoice_id`, `attempt_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `invoices_submission_uuid_key` ON `invoices`(`submission_uuid`);

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_selected_connection_id_fkey` FOREIGN KEY (`selected_connection_id`) REFERENCES `jofotara_connections`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `jofotara_connections` ADD CONSTRAINT `jofotara_connections_billing_entity_id_fkey` FOREIGN KEY (`billing_entity_id`) REFERENCES `billing_entities`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `fawtara_submissions` ADD CONSTRAINT `fawtara_submissions_invoice_id_fkey` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fawtara_submissions` ADD CONSTRAINT `fawtara_submissions_jofotara_connection_id_fkey` FOREIGN KEY (`jofotara_connection_id`) REFERENCES `jofotara_connections`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Unique nullable key + CHECK enforce default-active semantics at database level.
ALTER TABLE jofotara_connections ADD CONSTRAINT jofotara_active_default_check
 CHECK (default_entity_key IS NULL OR (enabled = true AND default_entity_key = billing_entity_id));
