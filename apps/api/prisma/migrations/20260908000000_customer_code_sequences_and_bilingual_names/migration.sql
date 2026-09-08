-- Bilingual customer names, and Billing-Entity-scoped, concurrency-safe customer code sequences.

ALTER TABLE `customers`
  ADD COLUMN `name_en` VARCHAR(191) NULL,
  ADD COLUMN `name_ar` VARCHAR(191) NULL;

-- Preserve existing data with a simple, unconditional copy (no language detection at the SQL
-- level — that only runs going forward, in the application, for Legacy Import). The owner is
-- deleting and re-importing all customers after this change lands anyway (see the delivered
-- report), so this is a safety-net fallback only, not a data-quality migration.
UPDATE `customers` SET `name_en` = `company_name` WHERE `company_name` IS NOT NULL;

DROP INDEX `customers_company_name_idx` ON `customers`;
ALTER TABLE `customers` DROP COLUMN `company_name`;
CREATE INDEX `customers_name_en_idx` ON `customers` (`name_en`);
CREATE INDEX `customers_name_ar_idx` ON `customers` (`name_ar`);

ALTER TABLE `billing_entities`
  ADD COLUMN `customer_code_prefix` VARCHAR(10) NULL;

UPDATE `billing_entities` SET `customer_code_prefix` = 'FF'
  WHERE `code` = 'FUTURE_FORESIGHT_INTERNATIONAL';
UPDATE `billing_entities` SET `customer_code_prefix` = 'NS'
  WHERE `code` = 'NEW_SERVE_LOCAL';
-- Fallback for any other Billing Entity that predates this migration: derive a prefix from its
-- own code. If two entities' codes happen to collide on their first 3 characters, the UNIQUE
-- index added below makes the migration fail loudly rather than silently duplicating a prefix,
-- which is the correct behavior for an identifier scheme.
UPDATE `billing_entities` SET `customer_code_prefix` = UPPER(LEFT(`code`, 3))
  WHERE `customer_code_prefix` IS NULL;

ALTER TABLE `billing_entities`
  MODIFY COLUMN `customer_code_prefix` VARCHAR(10) NOT NULL,
  ADD UNIQUE INDEX `billing_entities_customer_code_prefix_key` (`customer_code_prefix`);

CREATE TABLE `customer_code_sequences` (
  `billing_entity_id` VARCHAR(36) NOT NULL,
  `last_value` INT NOT NULL DEFAULT 0,
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`billing_entity_id`),
  CONSTRAINT `customer_code_sequences_billing_entity_id_fkey`
    FOREIGN KEY (`billing_entity_id`) REFERENCES `billing_entities`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- One sequence row per existing Billing Entity, starting at 0 (no customer codes issued yet).
-- Per the owner's explicit instruction, existing customers are being deleted and re-imported
-- after this change ships, so there is no historical `FFxxxx`/`NSxxxx` numbering to reconcile
-- against — starting every sequence at 0 is correct, not a shortcut.
INSERT INTO `customer_code_sequences` (`billing_entity_id`, `last_value`, `updated_at`)
SELECT `id`, 0, CURRENT_TIMESTAMP(3) FROM `billing_entities`;
