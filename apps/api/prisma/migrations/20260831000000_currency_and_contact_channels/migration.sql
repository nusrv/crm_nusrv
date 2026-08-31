-- Phase 2.1: normalized contact channels and controlled currency conversion.
-- Exchange-rate direction is always: 1 unit of `code` = `rate_to_jod` JOD.

CREATE TABLE `currencies` (
  `code` VARCHAR(3) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `rate_to_jod` DECIMAL(18,9) NULL,
  `effective_date` DATE NULL,
  `active` BOOLEAN NOT NULL DEFAULT false,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`code`),
  INDEX `currencies_active_code_idx` (`active`, `code`),
  CONSTRAINT `currencies_rate_to_jod_positive_chk`
    CHECK (`rate_to_jod` IS NULL OR `rate_to_jod` > 0),
  CONSTRAINT `currencies_active_rate_chk`
    CHECK (`active` = false OR (`rate_to_jod` IS NOT NULL AND `effective_date` IS NOT NULL)),
  CONSTRAINT `currencies_jod_rate_chk`
    CHECK (`code` <> 'JOD' OR (`rate_to_jod` = 1 AND `active` = true))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `currencies`
  (`code`, `name`, `rate_to_jod`, `effective_date`, `active`, `created_at`, `updated_at`)
SELECT DISTINCT UPPER(`currency`), UPPER(`currency`), NULL, NULL, false,
  CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `subscriptions`
WHERE `currency` IS NOT NULL AND CHAR_LENGTH(TRIM(`currency`)) = 3;

INSERT IGNORE INTO `currencies`
  (`code`, `name`, `rate_to_jod`, `effective_date`, `active`, `created_at`, `updated_at`)
SELECT DISTINCT UPPER(`currency`), UPPER(`currency`), NULL, NULL, false,
  CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `service_package_terms`
WHERE `currency` IS NOT NULL AND CHAR_LENGTH(TRIM(`currency`)) = 3;

INSERT INTO `currencies`
  (`code`, `name`, `rate_to_jod`, `effective_date`, `active`, `created_at`, `updated_at`)
VALUES
  ('JOD', 'Jordanian Dinar', 1.000000000, CURRENT_DATE(), true,
   CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `rate_to_jod` = VALUES(`rate_to_jod`),
  `effective_date` = VALUES(`effective_date`),
  `active` = true,
  `updated_at` = CURRENT_TIMESTAMP(3);

ALTER TABLE `subscriptions`
  ADD COLUMN `exchange_rate_to_jod` DECIMAL(18,9) NULL,
  ADD COLUMN `selling_price_jod` DECIMAL(14,3) NULL,
  ADD COLUMN `exchange_rate_effective_date` DATE NULL;

UPDATE `subscriptions`
SET
  `exchange_rate_to_jod` = 1.000000000,
  `selling_price_jod` = ROUND(`selling_price`, 3),
  `exchange_rate_effective_date` = CURRENT_DATE()
WHERE UPPER(`currency`) = 'JOD';

ALTER TABLE `subscriptions`
  ADD CONSTRAINT `subscriptions_currency_fkey`
    FOREIGN KEY (`currency`) REFERENCES `currencies`(`code`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `customer_email_addresses` (
  `id` VARCHAR(36) NOT NULL,
  `customer_id` VARCHAR(36) NOT NULL,
  `email` VARCHAR(320) NOT NULL,
  `holder_name` VARCHAR(191) NULL,
  `role` ENUM('PRIMARY', 'BILLING', 'TECHNICAL', 'MANAGEMENT', 'OTHER') NOT NULL DEFAULT 'OTHER',
  `label` VARCHAR(100) NULL,
  `primary` BOOLEAN NOT NULL DEFAULT false,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `source_legacy_reference` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `customer_email_addresses_customer_email_key` (`customer_id`, `email`),
  INDEX `customer_email_addresses_customer_id_active_idx` (`customer_id`, `active`),
  INDEX `customer_email_addresses_email_idx` (`email`),
  CONSTRAINT `customer_email_addresses_customer_id_fkey`
    FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `customer_phone_numbers` (
  `id` VARCHAR(36) NOT NULL,
  `customer_id` VARCHAR(36) NOT NULL,
  `phone_number` VARCHAR(16) NOT NULL,
  `country_calling_code` VARCHAR(5) NOT NULL,
  `holder_name` VARCHAR(191) NULL,
  `role` ENUM('PRIMARY', 'BILLING', 'TECHNICAL', 'MANAGEMENT', 'OTHER') NOT NULL DEFAULT 'OTHER',
  `label` VARCHAR(100) NULL,
  `primary` BOOLEAN NOT NULL DEFAULT false,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `source_legacy_reference` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `customer_phone_numbers_customer_phone_key` (`customer_id`, `phone_number`),
  INDEX `customer_phone_numbers_customer_id_active_idx` (`customer_id`, `active`),
  INDEX `customer_phone_numbers_phone_number_idx` (`phone_number`),
  CONSTRAINT `customer_phone_numbers_phone_number_e164_chk`
    CHECK (`phone_number` REGEXP '^\\+[1-9][0-9]{7,14}$'),
  CONSTRAINT `customer_phone_numbers_country_calling_code_chk`
    CHECK (`country_calling_code` REGEXP '^\\+[1-9][0-9]{0,2}$'),
  CONSTRAINT `customer_phone_numbers_calling_code_prefix_chk`
    CHECK (`phone_number` LIKE CONCAT(`country_calling_code`, '%')),
  CONSTRAINT `customer_phone_numbers_customer_id_fkey`
    FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `customer_email_addresses`
  (`id`, `customer_id`, `email`, `holder_name`, `role`, `label`, `primary`, `active`,
   `source_legacy_reference`, `created_at`, `updated_at`)
SELECT UUID(), `id`, LOWER(TRIM(`primary_email`)), `contact_name`, 'PRIMARY', 'Primary', true, true,
  'customers.primary_email', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `customers`
WHERE `primary_email` IS NOT NULL AND TRIM(`primary_email`) <> '';

INSERT IGNORE INTO `customer_email_addresses`
  (`id`, `customer_id`, `email`, `holder_name`, `role`, `label`, `primary`, `active`,
   `source_legacy_reference`, `created_at`, `updated_at`)
SELECT UUID(), `id`, LOWER(TRIM(`secondary_email`)), `contact_name`, 'OTHER', 'Secondary', false, true,
  'customers.secondary_email', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `customers`
WHERE `secondary_email` IS NOT NULL AND TRIM(`secondary_email`) <> '';

INSERT IGNORE INTO `customer_email_addresses`
  (`id`, `customer_id`, `email`, `holder_name`, `role`, `label`, `primary`, `active`,
   `source_legacy_reference`, `created_at`, `updated_at`)
SELECT UUID(), `customer_id`, LOWER(TRIM(`email`)), `name`, `role`, NULL, `primary`, `active`,
  COALESCE(`source_legacy_reference`, 'customer_contacts.email'), `created_at`, `updated_at`
FROM `customer_contacts`
WHERE `email` IS NOT NULL AND TRIM(`email`) <> '';

-- Existing phone text is intentionally retained in its legacy columns. Only values already in
-- unambiguous E.164 form are copied; other numbers must be normalized by a human before messaging.
INSERT IGNORE INTO `customer_phone_numbers`
  (`id`, `customer_id`, `phone_number`, `country_calling_code`, `holder_name`, `role`, `label`,
   `primary`, `active`, `source_legacy_reference`, `created_at`, `updated_at`)
SELECT UUID(), `id`, TRIM(`phone`),
  CASE
    WHEN TRIM(`phone`) LIKE '+962%' THEN '+962'
    WHEN TRIM(`phone`) LIKE '+966%' THEN '+966'
    WHEN TRIM(`phone`) LIKE '+971%' THEN '+971'
    WHEN TRIM(`phone`) LIKE '+1%' THEN '+1'
    ELSE LEFT(TRIM(`phone`), 4)
  END,
  `contact_name`, 'PRIMARY', 'Primary', true, true, 'customers.phone',
  CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `customers`
WHERE TRIM(`phone`) REGEXP '^\\+(962|966|971)[0-9]{7,12}$' OR TRIM(`phone`) REGEXP '^\\+1[0-9]{10}$';
