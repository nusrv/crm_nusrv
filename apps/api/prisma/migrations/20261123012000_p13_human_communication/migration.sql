ALTER TABLE `renewal_cases`
  ADD COLUMN `communication_revision` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `clarification_pending` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `communication_outbox`
  ADD COLUMN `purpose` VARCHAR(24) NULL,
  ADD COLUMN `case_revision` INTEGER NULL,
  ADD COLUMN `recipient_contact_id` VARCHAR(36) NULL,
  ADD COLUMN `resend_of_id` VARCHAR(36) NULL,
  ADD UNIQUE INDEX `communication_outbox_resend_of_id_key`(`resend_of_id`);

ALTER TABLE `operator_reply_outbox`
  ADD COLUMN `resend_of_id` VARCHAR(36) NULL,
  ADD UNIQUE INDEX `operator_reply_outbox_resend_of_id_key`(`resend_of_id`);
