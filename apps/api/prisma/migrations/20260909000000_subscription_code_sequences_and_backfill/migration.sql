-- Subscription Code redesign: every Subscription Code becomes `<CUSTOMER_CODE>-S<SEQUENCE>`,
-- assigned by a per-Customer, concurrency-safe sequence (SubscriptionCodeService / this table),
-- replacing the old free-text-entered codes and the `LEG-S-<hash>` codes Legacy Import used to
-- generate. This migration updates existing Subscription rows IN PLACE — no subscription or
-- customer is deleted, recreated, or re-imported, and no id changes.

CREATE TABLE `subscription_code_sequences` (
  `customer_id` VARCHAR(36) NOT NULL,
  `last_value` INT NOT NULL DEFAULT 0,
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`customer_id`),
  CONSTRAINT `subscription_code_sequences_customer_id_fkey`
    FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ============================================================================================
-- Preflight (setup only — no `subscriptions` row is touched yet). Both temporary tables below use
-- `CREATE TEMPORARY TABLE`, which — like `CREATE TABLE` — is DDL and implicitly commits in
-- MariaDB, so they are deliberately outside the `START TRANSACTION` block further down; only the
-- actual data rewrite needs transactional protection. They live only for this session, matching
-- the single connection `prisma migrate deploy` uses to run this file, and are dropped explicitly
-- at the end for hygiene.
-- ============================================================================================

-- Materialize, once, the temporary code and final code every subscription will receive, and prove
-- two things with real DB constraints rather than a comment asserting them:
--   1. `final_code` is UNIQUE — no two subscriptions would be assigned the same final code.
--   2. CHECK(CHAR_LENGTH(final_code) <= 191) — every final code fits `subscription_code`'s actual
--      column type (VARCHAR(191), confirmed against the original CREATE TABLE), so a customer with
--      an unusually long prefix and a huge subscription count cannot silently truncate on write.
-- The minimum-2-digit, never-truncating padding is a plain CASE, not `LPAD`: `LPAD(str, 2, '0')`
-- TRUNCATES a longer source string to 2 characters (so subscription #100 would collide with #10)
-- — that footgun is why this does not use LPAD for the final digits at all.
CREATE TEMPORARY TABLE `_subscription_code_migration_map` (
  `subscription_id` VARCHAR(36) NOT NULL,
  `temp_code` VARCHAR(191) NOT NULL,
  `final_code` VARCHAR(191) NOT NULL,

  PRIMARY KEY (`subscription_id`),
  UNIQUE KEY `_scm_final_code_unique` (`final_code`),
  CONSTRAINT `_scm_final_code_length` CHECK (CHAR_LENGTH(`final_code`) <= 191)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `_subscription_code_migration_map` (`subscription_id`, `temp_code`, `final_code`)
SELECT
  ranked.`subscription_id`,
  CONCAT('__scode_migrating__', ranked.`subscription_id`),
  CONCAT(
    ranked.`customer_code`,
    '-S',
    CASE WHEN ranked.`rn` < 10 THEN CONCAT('0', ranked.`rn`) ELSE CAST(ranked.`rn` AS CHAR) END
  )
FROM (
  SELECT
    sub.`id` AS `subscription_id`,
    c.`customer_code` AS `customer_code`,
    ROW_NUMBER() OVER (
      PARTITION BY sub.`customer_id`
      ORDER BY sub.`created_at` ASC, sub.`id` ASC
    ) AS `rn`
  FROM `subscriptions` sub
  JOIN `customers` c ON c.`id` = sub.`customer_id`
) ranked;

-- Preflight guard: fail here, before any `subscriptions` row is modified, if any EXISTING
-- subscription_code already equals a `temp_code` computed above (for that same subscription, or —
-- checked just as strictly — for a different one). Historical codes were free text entered by
-- staff, so this cannot be ruled out by construction the way the final codes' uniqueness can; it is
-- checked against the real, current data instead. This table's collation matches
-- `subscriptions.subscription_code` exactly, so `=` here means exactly what the real UNIQUE index
-- on that column means.
CREATE TEMPORARY TABLE `_subscription_code_preflight_check` (
  `subscription_code` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`subscription_code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `_subscription_code_preflight_check` (`subscription_code`)
SELECT `subscription_code` FROM `subscriptions`;

-- If any `temp_code` already exists as some subscription's current code, this INSERT hits the
-- PRIMARY KEY above and the whole migration aborts right here — nothing in `subscriptions` has
-- been written yet.
INSERT INTO `_subscription_code_preflight_check` (`subscription_code`)
SELECT `temp_code` FROM `_subscription_code_migration_map`;

-- ============================================================================================
-- Data rewrite. Wrapped in an explicit transaction so that a failure partway through (phase 2, or
-- sequence seeding) rolls phase 1 back too — production must never be left with subscriptions on
-- temporary `__scode_migrating__...` codes.
-- ============================================================================================
START TRANSACTION;

-- Phase 1 of 2: move every subscription to its (already preflight-checked) temporary code. This
-- alone is what makes phase 2 collision-safe: MariaDB/InnoDB checks the `subscription_code` UNIQUE
-- constraint per row as an UPDATE executes, not deferred to end-of-statement, so renaming straight
-- to final codes in one pass is unsafe whenever an existing code already equals another
-- subscription's computed target (the preflight guard above only proves that can't happen against
-- a *temp* code; it remains possible against a final code, which free-text history cannot rule
-- out). Routing every row through `temp_code` first — unique by construction, since it is derived
-- from each row's own primary key — means no row holds a final-shaped value when phase 2 runs, so
-- phase 2 cannot collide with anything regardless of row processing order.
UPDATE `subscriptions` s
  JOIN `_subscription_code_migration_map` m ON m.`subscription_id` = s.`id`
  SET s.`subscription_code` = m.`temp_code`;

-- Phase 2 of 2: rename every subscription from its temporary code to its final, deterministic code
-- (ordered by createdAt ascending, then id ascending as the tie-breaker — computed once, above,
-- and unaffected by phase 1 since `created_at`/`id` are never touched). `ROW_NUMBER() OVER (...)`
-- is available on MariaDB 10.2+; this project's documented minimum supported server is 10.6 (see
-- ADR-003-MARIADB-RETARGET.md), so this is safe for `prisma migrate deploy` in production — no
-- shadow database or `migrate dev` semantics are involved.
UPDATE `subscriptions` s
  JOIN `_subscription_code_migration_map` m ON m.`subscription_id` = s.`id`
  SET s.`subscription_code` = m.`final_code`;

-- Seed each Customer's sequence to the count of subscriptions it now has, so the next Subscription
-- created for that Customer continues the numbering (…-S102 for a 102nd) instead of restarting at
-- S01. A Customer with zero subscriptions gets no row here; SubscriptionCodeService.next() lazily
-- upsert-creates one, starting at 1, on that Customer's first subscription.
INSERT INTO `subscription_code_sequences` (`customer_id`, `last_value`, `updated_at`)
SELECT `customer_id`, COUNT(*), CURRENT_TIMESTAMP(3)
FROM `subscriptions`
GROUP BY `customer_id`;

COMMIT;

DROP TEMPORARY TABLE IF EXISTS `_subscription_code_preflight_check`;
DROP TEMPORARY TABLE IF EXISTS `_subscription_code_migration_map`;
