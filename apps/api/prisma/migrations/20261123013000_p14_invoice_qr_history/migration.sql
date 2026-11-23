CREATE TABLE `invoice_qr_corrections` (
    `id` VARCHAR(36) NOT NULL,
    `invoice_id` VARCHAR(36) NOT NULL,
    `invoice_revision` INTEGER NOT NULL,
    `old_image_data_url` MEDIUMTEXT NULL,
    `new_image_data_url` MEDIUMTEXT NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `actor_id` VARCHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `invoice_qr_corrections_invoice_id_invoice_revision_key` (`invoice_id`, `invoice_revision`),
    CONSTRAINT `invoice_qr_corrections_invoice_id_fkey` FOREIGN KEY (`invoice_id`) REFERENCES `invoices` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
