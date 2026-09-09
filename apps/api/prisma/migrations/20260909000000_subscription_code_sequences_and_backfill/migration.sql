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

-- Phase 1 of 2: move EVERY existing subscription to a temporary, collision-proof code first.
--
-- Subscription codes were previously free text entered by staff (or the retired `LEG-S-<hash>`
-- generator), so an existing code can already coincidentally equal the *target* code some other row
-- is about to be assigned in phase 2 below — e.g. a subscription manually coded "FF0001-S01" that
-- isn't actually that customer's chronologically-first subscription. A direct single-pass rename to
-- final codes is not safe against this: MariaDB/InnoDB checks the `subscription_code` UNIQUE
-- constraint per row as an UPDATE executes, not deferred to end-of-statement, so if one row's new
-- target equals another row's *current, not-yet-updated* value, the statement can fail with a
-- duplicate-key error — and whether it actually does depends on the storage engine's internal row
-- processing order for that statement, which is not something this migration controls or may rely
-- on. Routing every row through a temporary value derived from its own `id` (the primary key, so
-- guaranteed unique) first means no row holds a final-shaped value when phase 2 runs, so phase 2
-- cannot collide with anything regardless of row processing order.
UPDATE `subscriptions` SET `subscription_code` = CONCAT('__scode_migrating__', `id`);

-- Phase 2 of 2: deterministic backfill. For each Customer, order its existing subscriptions by
-- createdAt ascending then id ascending (tie-breaker), and assign CUSTOMERCODE-S01, -S02, -S03, ...
-- in that order — unaffected by phase 1, since `created_at`/`id` were never touched.
-- `ROW_NUMBER() OVER (...)` is available on MariaDB 10.2+ (this project's minimum supported server
-- is 10.6, per ADR-003), so this runs safely via `prisma migrate deploy` in production — no shadow
-- database or `migrate dev` semantics are involved.
UPDATE `subscriptions` s
  JOIN (
    SELECT
      sub.`id` AS `subscription_id`,
      CONCAT(c.`customer_code`, '-S', LPAD(
        CAST(ROW_NUMBER() OVER (
          PARTITION BY sub.`customer_id`
          ORDER BY sub.`created_at` ASC, sub.`id` ASC
        ) AS CHAR),
        2, '0'
      )) AS `new_code`
    FROM `subscriptions` sub
    JOIN `customers` c ON c.`id` = sub.`customer_id`
  ) ranked ON ranked.`subscription_id` = s.`id`
  SET s.`subscription_code` = ranked.`new_code`;

-- Seed each Customer's sequence to the count of subscriptions it now has, so the next Subscription
-- created for that Customer continues the numbering (…-S08 for an 8th) instead of restarting at S01.
-- A Customer with zero subscriptions gets no row here; SubscriptionCodeService.next() lazily
-- upsert-creates one, starting at 1, on that Customer's first subscription.
INSERT INTO `subscription_code_sequences` (`customer_id`, `last_value`, `updated_at`)
SELECT `customer_id`, COUNT(*), CURRENT_TIMESTAMP(3)
FROM `subscriptions`
GROUP BY `customer_id`;
