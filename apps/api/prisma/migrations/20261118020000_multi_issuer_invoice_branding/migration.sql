-- Additive presentation metadata. No issuer identity/tax data is overwritten.
-- AlterTable
ALTER TABLE `billing_entities` ADD COLUMN `country_code` VARCHAR(2) NULL,
    ADD COLUMN `issuer_type` ENUM('COMPANY', 'INDIVIDUAL') NOT NULL DEFAULT 'COMPANY',
    ADD COLUMN `legal_name_ar` VARCHAR(500) NULL;

-- AlterTable
ALTER TABLE `invoices` ADD COLUMN `issuer_logo_asset_id` VARCHAR(36) NULL,
    ADD COLUMN `issuer_presentation_snapshot` JSON NULL;

-- CreateTable
CREATE TABLE `invoice_branding_profiles` (
    `billing_entity_id` VARCHAR(36) NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `details` JSON NOT NULL,
    `visibility` JSON NOT NULL,
    `logo_asset_id` VARCHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`billing_entity_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoice_branding_assets` (
    `id` VARCHAR(36) NOT NULL,
    `billing_entity_id` VARCHAR(36) NOT NULL,
    `sha256` VARCHAR(64) NOT NULL,
    `mime_type` VARCHAR(30) NOT NULL,
    `bytes` MEDIUMBLOB NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `invoice_branding_assets_billing_entity_id_sha256_key`(`billing_entity_id`, `sha256`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_issuer_logo_asset_id_fkey` FOREIGN KEY (`issuer_logo_asset_id`) REFERENCES `invoice_branding_assets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoice_branding_profiles` ADD CONSTRAINT `invoice_branding_profiles_billing_entity_id_fkey` FOREIGN KEY (`billing_entity_id`) REFERENCES `billing_entities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoice_branding_profiles` ADD CONSTRAINT `invoice_branding_profiles_logo_asset_id_fkey` FOREIGN KEY (`logo_asset_id`) REFERENCES `invoice_branding_assets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoice_branding_assets` ADD CONSTRAINT `invoice_branding_assets_billing_entity_id_fkey` FOREIGN KEY (`billing_entity_id`) REFERENCES `billing_entities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
