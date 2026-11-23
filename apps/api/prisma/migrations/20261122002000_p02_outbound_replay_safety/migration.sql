-- Legacy attempts carry no proof of nonacceptance and are ineligible for retry.
ALTER TABLE `communication_outbox`
    ADD COLUMN `smtp_retry_safe` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `smtp_uncertain` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `operator_reply_outbox`
    ADD COLUMN `smtp_retry_safe` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `smtp_uncertain` BOOLEAN NOT NULL DEFAULT false;
