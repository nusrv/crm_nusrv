-- Existing rows retain unknown dates, no manual approval, and no recorded review.
ALTER TABLE `renewal_cases`
    ADD COLUMN `proposed_period_start` DATE NULL,
    ADD COLUMN `proposed_period_end` DATE NULL,
    ADD COLUMN `proposed_next_renewal_date` DATE NULL;

ALTER TABLE `communication_outbox`
    ADD COLUMN `manual_approved_by` VARCHAR(36) NULL;

ALTER TABLE `email_messages`
    ADD COLUMN `reviewed_at` DATETIME(3) NULL,
    ADD COLUMN `reviewed_by` VARCHAR(36) NULL;
