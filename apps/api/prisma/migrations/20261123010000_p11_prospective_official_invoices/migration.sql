-- Existing records remain untouched. Only a new verified officialization reserves a case key.
ALTER TABLE `invoices`
  ADD COLUMN `renewal_official_key` VARCHAR(36) NULL,
  ADD UNIQUE INDEX `invoices_renewal_official_key` (`renewal_official_key`),
  MODIFY COLUMN `customer_id` VARCHAR(36) NULL,
  MODIFY COLUMN `source_subscription_id` VARCHAR(36) NULL;
