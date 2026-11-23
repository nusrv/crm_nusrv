-- Preserve scheduled_at. Deferral and bounded SMTP retry use their own eligibility clock.
ALTER TABLE `communication_outbox`
    ADD COLUMN `next_attempt_at` DATETIME(3) NULL,
    ADD INDEX `communication_outbox_attempt_due_idx` (`status`, `next_attempt_at`, `scheduled_at`);
