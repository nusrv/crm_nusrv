-- The checked-in history has no payment tables. Compare target schema before deployment.
CREATE TABLE `payments` (
    `id` VARCHAR(36) NOT NULL,
    `invoice_id` VARCHAR(36) NOT NULL,
    `amount` DECIMAL(14, 3) NOT NULL,
    `currency` VARCHAR(3) NOT NULL,
    `payment_date` DATE NOT NULL,
    `method` VARCHAR(30) NOT NULL,
    `reference` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `recorded_by` VARCHAR(36) NOT NULL,
    `idempotency_key` VARCHAR(80) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `payments_idempotency_key_key` (`idempotency_key`),
    INDEX `payments_invoice_id_payment_date_idx` (`invoice_id`, `payment_date`),
    CONSTRAINT `payments_invoice_id_fkey` FOREIGN KEY (`invoice_id`) REFERENCES `invoices` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `payment_receipts` (
    `id` VARCHAR(36) NOT NULL,
    `payment_id` VARCHAR(36) NOT NULL,
    `snapshot` JSON NOT NULL,
    `created_by` VARCHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `payment_receipts_payment_id_key` (`payment_id`),
    CONSTRAINT `payment_receipts_payment_id_fkey` FOREIGN KEY (`payment_id`) REFERENCES `payments` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `payment_receipt_revisions` (
    `id` VARCHAR(36) NOT NULL,
    `receipt_id` VARCHAR(36) NOT NULL,
    `version` INTEGER NOT NULL,
    `amount` DECIMAL(14, 3) NOT NULL,
    `currency` VARCHAR(3) NOT NULL,
    `payment_date` DATE NOT NULL,
    `method` VARCHAR(30) NOT NULL,
    `reference` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `voided` BOOLEAN NOT NULL DEFAULT false,
    `reason` VARCHAR(500) NOT NULL,
    `actor_id` VARCHAR(36) NOT NULL,
    `request_key` VARCHAR(80) NULL,
    `request_hash` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `payment_receipt_revisions_request_key_key` (`request_key`),
    UNIQUE INDEX `payment_receipt_revisions_receipt_id_version_key` (`receipt_id`, `version`),
    CONSTRAINT `payment_receipt_revisions_receipt_id_fkey` FOREIGN KEY (`receipt_id`) REFERENCES `payment_receipts` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
