-- Phase 2.2: canonical customer/subscription source ordering, and the phone/email channel
-- fields required to consume the approved multi-contact, multi-phone canonical import dataset.
-- Purely additive: no column is dropped, no existing data is destroyed, and every new column
-- is nullable or carries a safe default so already-approved rows keep working unchanged.

-- 1. Source ordering (Customer + Subscription). New rows created by manual entry or a future
--    canonical import always receive an explicit value; existing rows are backfilled below using
--    a stable, deterministic tiebreaker (creation order) so ORDER BY source_sequence never yields
--    an inconsistent result even before any canonical re-import runs.
ALTER TABLE `customers`
  ADD COLUMN `source_sequence` INT NULL;

ALTER TABLE `subscriptions`
  ADD COLUMN `source_sequence` INT NULL,
  ADD COLUMN `current_term_end_date` DATE NULL,
  ADD COLUMN `paid_label` VARCHAR(50) NULL;

UPDATE `customers` c
  JOIN (
    SELECT `id`, ROW_NUMBER() OVER (ORDER BY `created_at`, `id`) AS `seq`
    FROM `customers`
  ) ranked ON ranked.`id` = c.`id`
SET c.`source_sequence` = ranked.`seq`
WHERE c.`source_sequence` IS NULL;

UPDATE `subscriptions` s
  JOIN (
    SELECT `id`, ROW_NUMBER() OVER (ORDER BY `created_at`, `id`) AS `seq`
    FROM `subscriptions`
  ) ranked ON ranked.`id` = s.`id`
SET s.`source_sequence` = ranked.`seq`
WHERE s.`source_sequence` IS NULL;

-- Existing subscriptions have always used `renewal_date` to mean "current term end"; carry that
-- forward explicitly into the new field rather than leaving it null. `renewal_date` remains the
-- field the Phase 2 renewal engine reads; `current_term_end_date` is the new, unambiguous name for
-- future code. See PHASES/PHASE_02_2_CANONICAL_DATA_MIGRATION.md for the documented transitional
-- mapping.
UPDATE `subscriptions`
SET `current_term_end_date` = `renewal_date`
WHERE `current_term_end_date` IS NULL;

CREATE INDEX `customers_source_sequence_idx` ON `customers` (`source_sequence`);
CREATE INDEX `subscriptions_source_sequence_idx` ON `subscriptions` (`source_sequence`);

-- 2. Channel verification status, shared by both channel tables.
--    (No CREATE TYPE in MySQL/MariaDB — Prisma represents enums as inline ENUM columns.)

-- 3. Customer email addresses: optional link to a named contact, plus verification tracking.
ALTER TABLE `customer_email_addresses`
  ADD COLUMN `contact_id` VARCHAR(36) NULL,
  ADD COLUMN `verification_status` ENUM('UNVERIFIED', 'VERIFIED', 'INVALID') NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN `verified_at` DATETIME(3) NULL;

CREATE INDEX `customer_email_addresses_contact_id_idx` ON `customer_email_addresses` (`contact_id`);

ALTER TABLE `customer_email_addresses`
  ADD CONSTRAINT `customer_email_addresses_contact_id_fkey`
    FOREIGN KEY (`contact_id`) REFERENCES `customer_contacts`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. Customer phone numbers: the full canonical phone-channel shape (type, raw/normalized parts,
--    optional contact link, verification tracking, and a metadata bag for normalization evidence).
--    `phone_number` is widened from VARCHAR(16) to VARCHAR(20) purely for headroom; the existing
--    E.164 CHECK constraint (max 15 digits after `+`) is unaffected and still enforced below.
ALTER TABLE `customer_phone_numbers`
  MODIFY COLUMN `phone_number` VARCHAR(20) NOT NULL,
  ADD COLUMN `contact_id` VARCHAR(36) NULL,
  ADD COLUMN `phone_type` ENUM('MOBILE', 'LANDLINE', 'FAX', 'PHONE') NOT NULL DEFAULT 'PHONE',
  ADD COLUMN `raw_value` VARCHAR(100) NULL,
  ADD COLUMN `country` VARCHAR(100) NULL,
  ADD COLUMN `area_or_operator_code` VARCHAR(20) NULL,
  ADD COLUMN `subscriber_number` VARCHAR(40) NULL,
  ADD COLUMN `extension` VARCHAR(20) NULL,
  ADD COLUMN `verification_status` ENUM('UNVERIFIED', 'VERIFIED', 'INVALID') NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN `verified_at` DATETIME(3) NULL,
  ADD COLUMN `metadata` JSON NULL;

CREATE INDEX `customer_phone_numbers_contact_id_idx` ON `customer_phone_numbers` (`contact_id`);

ALTER TABLE `customer_phone_numbers`
  ADD CONSTRAINT `customer_phone_numbers_contact_id_fkey`
    FOREIGN KEY (`contact_id`) REFERENCES `customer_contacts`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
