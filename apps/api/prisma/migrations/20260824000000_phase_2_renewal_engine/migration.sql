-- AlterTable
ALTER TABLE `renewal_cases` ADD COLUMN `last_evaluated_at` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `renewal_templates` (
    `id` VARCHAR(36) NOT NULL,
    `code` VARCHAR(80) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `subject_template` VARCHAR(500) NOT NULL,
    `body_template` TEXT NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `renewal_templates_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reminder_rules` (
    `id` VARCHAR(36) NOT NULL,
    `code` VARCHAR(80) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `days_before_due` INTEGER NOT NULL,
    `template_id` VARCHAR(36) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `reminder_rules_code_key`(`code`),
    INDEX `reminder_rules_days_before_due_enabled_idx`(`days_before_due`, `enabled`),
    INDEX `reminder_rules_template_id_idx`(`template_id`),
    UNIQUE INDEX `reminder_rules_days_before_due_key`(`days_before_due`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_rules` (
    `id` VARCHAR(36) NOT NULL,
    `code` VARCHAR(80) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `days_before_due` INTEGER NOT NULL,
    `recipient_roles` JSON NOT NULL,
    `recipient_emails` JSON NOT NULL,
    `subject_template` VARCHAR(500) NOT NULL,
    `body_template` TEXT NOT NULL,
    `suppress_on_workflow_hold` BOOLEAN NOT NULL DEFAULT true,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `notification_rules_code_key`(`code`),
    INDEX `notification_rules_days_before_due_enabled_idx`(`days_before_due`, `enabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `renewal_holds` (
    `id` VARCHAR(36) NOT NULL,
    `renewal_case_id` VARCHAR(36) NOT NULL,
    `reason` TEXT NOT NULL,
    `stops_customer_reminders` BOOLEAN NOT NULL DEFAULT true,
    `stops_internal_notifications` BOOLEAN NOT NULL DEFAULT true,
    `expires_at` DATETIME(3) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_by_id` VARCHAR(36) NOT NULL,
    `released_by_id` VARCHAR(36) NULL,
    `released_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `renewal_holds_renewal_case_id_active_expires_at_idx`(`renewal_case_id`, `active`, `expires_at`),
    INDEX `renewal_holds_created_by_id_idx`(`created_by_id`),
    INDEX `renewal_holds_released_by_id_idx`(`released_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `communication_outbox` (
    `id` VARCHAR(36) NOT NULL,
    `customer_id` VARCHAR(36) NOT NULL,
    `subscription_id` VARCHAR(36) NOT NULL,
    `renewal_case_id` VARCHAR(36) NOT NULL,
    `reminder_rule_id` VARCHAR(36) NULL,
    `notification_rule_id` VARCHAR(36) NULL,
    `audit_event_id` VARCHAR(36) NOT NULL,
    `audience` ENUM('CUSTOMER', 'INTERNAL') NOT NULL,
    `recipient` VARCHAR(320) NOT NULL,
    `subject` VARCHAR(500) NOT NULL,
    `body` TEXT NOT NULL,
    `days_before_due` INTEGER NOT NULL,
    `status` ENUM('QUEUED', 'PROCESSING', 'DELIVERED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'QUEUED',
    `scheduled_at` DATETIME(3) NOT NULL,
    `queued_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `last_attempt_at` DATETIME(3) NULL,
    `last_error` TEXT NULL,
    `idempotency_key` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `communication_outbox_audit_event_id_key`(`audit_event_id`),
    UNIQUE INDEX `communication_outbox_idempotency_key_key`(`idempotency_key`),
    INDEX `communication_outbox_renewal_case_id_status_idx`(`renewal_case_id`, `status`),
    INDEX `communication_outbox_status_scheduled_at_idx`(`status`, `scheduled_at`),
    INDEX `communication_outbox_customer_id_idx`(`customer_id`),
    INDEX `communication_outbox_subscription_id_idx`(`subscription_id`),
    INDEX `communication_outbox_reminder_rule_id_idx`(`reminder_rule_id`),
    INDEX `communication_outbox_notification_rule_id_idx`(`notification_rule_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `renewal_evaluation_decisions` (
    `id` VARCHAR(36) NOT NULL,
    `renewal_case_id` VARCHAR(36) NOT NULL,
    `decision_key` VARCHAR(191) NOT NULL,
    `outcome` ENUM('SKIPPED_HOLD', 'SKIPPED_INELIGIBLE', 'DUPLICATE_PREVENTED') NOT NULL,
    `days_before_due` INTEGER NULL,
    `reason` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `renewal_evaluation_decisions_decision_key_key`(`decision_key`),
    INDEX `renewal_evaluation_decisions_renewal_case_id_created_at_idx`(`renewal_case_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `reminder_rules` ADD CONSTRAINT `reminder_rules_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `renewal_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `renewal_holds` ADD CONSTRAINT `renewal_holds_renewal_case_id_fkey` FOREIGN KEY (`renewal_case_id`) REFERENCES `renewal_cases`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `renewal_holds` ADD CONSTRAINT `renewal_holds_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `renewal_holds` ADD CONSTRAINT `renewal_holds_released_by_id_fkey` FOREIGN KEY (`released_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `communication_outbox` ADD CONSTRAINT `communication_outbox_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `communication_outbox` ADD CONSTRAINT `communication_outbox_subscription_id_fkey` FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `communication_outbox` ADD CONSTRAINT `communication_outbox_renewal_case_id_fkey` FOREIGN KEY (`renewal_case_id`) REFERENCES `renewal_cases`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `communication_outbox` ADD CONSTRAINT `communication_outbox_reminder_rule_id_fkey` FOREIGN KEY (`reminder_rule_id`) REFERENCES `reminder_rules`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `communication_outbox` ADD CONSTRAINT `communication_outbox_notification_rule_id_fkey` FOREIGN KEY (`notification_rule_id`) REFERENCES `notification_rules`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `communication_outbox` ADD CONSTRAINT `communication_outbox_audit_event_id_fkey` FOREIGN KEY (`audit_event_id`) REFERENCES `audit_events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `renewal_evaluation_decisions` ADD CONSTRAINT `renewal_evaluation_decisions_renewal_case_id_fkey` FOREIGN KEY (`renewal_case_id`) REFERENCES `renewal_cases`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
