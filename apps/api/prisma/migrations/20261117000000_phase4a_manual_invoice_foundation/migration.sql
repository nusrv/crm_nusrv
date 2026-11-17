-- Phase 4A — manual-first invoice foundation.
-- Additive financial/audit tables only. No existing row is rewritten and no external integration
-- is enabled. Source-record foreign keys are RESTRICT so Customer/Subscription deletion can never
-- cascade into invoice history. Invoice-owned lines may cascade only when their Invoice is deleted;
-- the application exposes no Invoice delete operation.

CREATE TABLE `invoice_sequences` (
    `billing_entity_id` VARCHAR(36) NOT NULL,
    `year` INTEGER NOT NULL,
    `last_value` INTEGER NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`billing_entity_id`, `year`),
    CONSTRAINT `invoice_sequences_billing_entity_fkey`
        FOREIGN KEY (`billing_entity_id`) REFERENCES `billing_entities`(`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `invoices` (
    `id` VARCHAR(36) NOT NULL,
    `customer_id` VARCHAR(36) NOT NULL,
    `billing_entity_id` VARCHAR(36) NOT NULL,
    `source_subscription_id` VARCHAR(36) NOT NULL,
    `status` ENUM('DRAFT', 'READY_FOR_FAWTARA', 'FAWTARA_ACCEPTED', 'FAWTARA_REJECTED') NOT NULL DEFAULT 'DRAFT',
    `internal_reference` VARCHAR(80) NOT NULL,
    `active_draft_key` VARCHAR(191) NULL,
    `invoice_date` DATE NOT NULL,
    `currency_code` VARCHAR(3) NOT NULL,
    `period_start` DATE NOT NULL,
    `period_end` DATE NOT NULL,

    `customer_code_snapshot` VARCHAR(191) NOT NULL,
    `customer_name_en_snapshot` VARCHAR(191) NULL,
    `customer_name_ar_snapshot` VARCHAR(191) NULL,
    `customer_address_snapshot` TEXT NULL,
    `customer_country_snapshot` VARCHAR(191) NULL,
    `customer_phone_snapshot` VARCHAR(80) NULL,
    `customer_tax_number_snapshot` VARCHAR(191) NULL,

    `issuer_code_snapshot` VARCHAR(191) NOT NULL,
    `issuer_legal_name_snapshot` VARCHAR(500) NOT NULL,
    `issuer_legal_name_ar_snapshot` VARCHAR(500) NULL,
    `issuer_tax_number_snapshot` VARCHAR(191) NULL,
    `issuer_address_snapshot` TEXT NULL,
    `issuer_invoice_email_snapshot` VARCHAR(320) NULL,
    `issuer_bank_details_snapshot` TEXT NULL,

    `subtotal` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `discount_total` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `tax_total` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `grand_total` DECIMAL(14, 3) NOT NULL DEFAULT 0,

    `fawtara_status` VARCHAR(50) NULL,
    `fawtara_invoice_number` VARCHAR(191) NULL,
    `fawtara_invoice_uuid` VARCHAR(191) NULL,
    `fawtara_qr_payload` TEXT NULL,
    `fawtara_qr_image_data_url` TEXT NULL,
    `fawtara_submitted_at` DATETIME(3) NULL,
    `fawtara_accepted_at` DATETIME(3) NULL,
    `latest_fawtara_message` TEXT NULL,
    `latest_fawtara_result_json` JSON NULL,
    `official_currency_code` VARCHAR(3) NULL,
    `official_subtotal` DECIMAL(14, 3) NULL,
    `official_discount_total` DECIMAL(14, 3) NULL,
    `official_tax_total` DECIMAL(14, 3) NULL,
    `official_grand_total` DECIMAL(14, 3) NULL,
    `officialization_note` TEXT NULL,

    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `invoices_internal_reference_key`(`internal_reference`),
    UNIQUE INDEX `invoices_active_draft_key_key`(`active_draft_key`),
    INDEX `invoices_status_invoice_date_idx`(`status`, `invoice_date`),
    INDEX `invoices_customer_invoice_date_idx`(`customer_id`, `invoice_date`),
    INDEX `invoices_entity_invoice_date_idx`(`billing_entity_id`, `invoice_date`),
    INDEX `invoices_subscription_period_idx`(`source_subscription_id`, `period_start`, `period_end`),
    UNIQUE INDEX `invoices_entity_fawtara_number_key`(`billing_entity_id`, `fawtara_invoice_number`),
    UNIQUE INDEX `invoices_fawtara_uuid_key`(`fawtara_invoice_uuid`),
    PRIMARY KEY (`id`),
    CONSTRAINT `invoices_customer_fkey`
        FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `invoices_billing_entity_fkey`
        FOREIGN KEY (`billing_entity_id`) REFERENCES `billing_entities`(`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `invoices_source_subscription_fkey`
        FOREIGN KEY (`source_subscription_id`) REFERENCES `subscriptions`(`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `invoice_lines` (
    `id` VARCHAR(36) NOT NULL,
    `invoice_id` VARCHAR(36) NOT NULL,
    `source_subscription_id` VARCHAR(36) NULL,
    `position` INTEGER NOT NULL,
    `description` TEXT NOT NULL,
    `quantity` DECIMAL(14, 3) NOT NULL,
    `unit_price` DECIMAL(14, 3) NOT NULL,
    `discount_amount` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `tax_category_code` VARCHAR(50) NULL,
    `tax_rate` DECIMAL(7, 4) NULL,
    `line_subtotal` DECIMAL(14, 3) NOT NULL,
    `tax_amount` DECIMAL(14, 3) NOT NULL,
    `line_total` DECIMAL(14, 3) NOT NULL,
    `service_type_snapshot` VARCHAR(191) NULL,
    `package_snapshot` VARCHAR(191) NULL,
    `service_snapshot_text` TEXT NULL,
    `identifiers_snapshot_json` JSON NULL,
    `period_start` DATE NULL,
    `period_end` DATE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `invoice_lines_invoice_position_key`(`invoice_id`, `position`),
    INDEX `invoice_lines_source_subscription_idx`(`source_subscription_id`),
    PRIMARY KEY (`id`),
    CONSTRAINT `invoice_lines_invoice_fkey`
        FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `invoice_lines_source_subscription_fkey`
        FOREIGN KEY (`source_subscription_id`) REFERENCES `subscriptions`(`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
