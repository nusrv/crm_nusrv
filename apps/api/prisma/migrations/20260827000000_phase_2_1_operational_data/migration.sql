-- Phase 2.1 operational data correction.
-- Additive only: existing subscriptions keep their business identity and prices.

CREATE TABLE `customer_contacts` (
    `id` VARCHAR(36) NOT NULL,
    `customer_id` VARCHAR(36) NOT NULL,
    `role` ENUM('PRIMARY', 'BILLING', 'TECHNICAL', 'MANAGEMENT', 'OTHER') NOT NULL DEFAULT 'OTHER',
    `name` VARCHAR(191) NULL,
    `email` VARCHAR(320) NULL,
    `phone` VARCHAR(80) NULL,
    `primary` BOOLEAN NOT NULL DEFAULT false,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `source_legacy_reference` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `customer_contacts_customer_id_active_idx`(`customer_id`, `active`),
    INDEX `customer_contacts_email_idx`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `service_packages` (
    `id` VARCHAR(36) NOT NULL,
    `service_type_id` VARCHAR(36) NOT NULL,
    `code` VARCHAR(100) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `kind` ENUM('STANDARD', 'ADD_ON', 'CUSTOM_TEMPLATE') NOT NULL DEFAULT 'STANDARD',
    `description` TEXT NULL,
    `specifications` JSON NULL,
    `source_reference` VARCHAR(500) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `service_packages_code_key`(`code`),
    INDEX `service_packages_service_type_id_active_idx`(`service_type_id`, `active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `service_package_terms` (
    `id` VARCHAR(36) NOT NULL,
    `service_package_id` VARCHAR(36) NOT NULL,
    `term_months` INTEGER NOT NULL,
    `currency` VARCHAR(3) NOT NULL,
    `standard_selling_price` DECIMAL(14, 3) NOT NULL,
    `standard_supplier_cost` DECIMAL(14, 3) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `service_package_terms_active_idx`(`active`),
    UNIQUE INDEX `service_package_terms_package_term_currency_key`(`service_package_id`, `term_months`, `currency`),
    CONSTRAINT `service_package_terms_term_months_check` CHECK (`term_months` BETWEEN 1 AND 120),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `subscriptions`
    ADD COLUMN `service_package_id` VARCHAR(36) NULL,
    ADD COLUMN `renewal_interval_months` INTEGER NULL,
    ADD COLUMN `contract_term_months` INTEGER NULL,
    ADD COLUMN `source_registration` VARCHAR(191) NULL,
    ADD COLUMN `package_name_snapshot` VARCHAR(191) NULL,
    ADD COLUMN `package_specifications_snapshot` JSON NULL,
    ADD COLUMN `custom_package` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `classification_status` ENUM('UNCLASSIFIED', 'MATCHED_OFFICIAL', 'CUSTOM', 'MANUAL_REVIEW') NOT NULL DEFAULT 'UNCLASSIFIED',
    ADD COLUMN `classification_evidence` JSON NULL,
    ADD COLUMN `price_override_reason` TEXT NULL,
    ADD CONSTRAINT `subscriptions_renewal_interval_months_check`
      CHECK (`renewal_interval_months` IS NULL OR `renewal_interval_months` BETWEEN 1 AND 120),
    ADD CONSTRAINT `subscriptions_contract_term_months_check`
      CHECK (`contract_term_months` IS NULL OR `contract_term_months` BETWEEN 1 AND 120);

CREATE INDEX `subscriptions_service_package_id_idx` ON `subscriptions`(`service_package_id`);

CREATE TABLE `subscription_identifiers` (
    `id` VARCHAR(36) NOT NULL,
    `subscription_id` VARCHAR(36) NOT NULL,
    `type` ENUM('DOMAIN', 'HOSTNAME', 'MAIL_DOMAIN', 'SERVER_ACCOUNT', 'OTHER') NOT NULL,
    `value` VARCHAR(500) NOT NULL,
    `label` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `subscription_identifiers_value_idx`(`value`),
    UNIQUE INDEX `subscription_identifiers_subscription_id_type_value_key`(`subscription_id`, `type`, `value`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `customer_contacts`
    ADD CONSTRAINT `customer_contacts_customer_id_fkey`
    FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `service_packages`
    ADD CONSTRAINT `service_packages_service_type_id_fkey`
    FOREIGN KEY (`service_type_id`) REFERENCES `service_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `service_package_terms`
    ADD CONSTRAINT `service_package_terms_service_package_id_fkey`
    FOREIGN KEY (`service_package_id`) REFERENCES `service_packages`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `subscriptions`
    ADD CONSTRAINT `subscriptions_service_package_id_fkey`
    FOREIGN KEY (`service_package_id`) REFERENCES `service_packages`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `subscription_identifiers`
    ADD CONSTRAINT `subscription_identifiers_subscription_id_fkey`
    FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
