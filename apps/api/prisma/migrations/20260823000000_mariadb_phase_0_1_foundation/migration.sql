-- CreateTable
CREATE TABLE `billing_entities` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `payment_scope` ENUM('LOCAL', 'INTERNATIONAL') NOT NULL,
    `legal_name` VARCHAR(191) NOT NULL,
    `tax_number` VARCHAR(191) NULL,
    `address` VARCHAR(191) NULL,
    `invoice_email` VARCHAR(191) NULL,
    `bank_details_ciphertext` TEXT NULL,
    `fawtara_config_reference` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `billing_entities_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customers` (
    `id` VARCHAR(36) NOT NULL,
    `billing_entity_id` VARCHAR(36) NOT NULL,
    `customer_code` VARCHAR(191) NOT NULL,
    `company_name` VARCHAR(191) NOT NULL,
    `contact_name` VARCHAR(191) NULL,
    `primary_email` VARCHAR(191) NOT NULL,
    `secondary_email` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `address` VARCHAR(191) NULL,
    `country` VARCHAR(191) NULL,
    `tax_number` VARCHAR(191) NULL,
    `preferred_language` VARCHAR(191) NOT NULL DEFAULT 'en',
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `source_legacy_reference` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `customers_customer_code_key`(`customer_code`),
    INDEX `customers_billing_entity_id_idx`(`billing_entity_id`),
    INDEX `customers_company_name_idx`(`company_name`),
    INDEX `customers_primary_email_idx`(`primary_email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_types` (
    `id` VARCHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `default_suspend_policy` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `service_types_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscriptions` (
    `id` VARCHAR(36) NOT NULL,
    `customer_id` VARCHAR(36) NOT NULL,
    `service_type_id` VARCHAR(36) NOT NULL,
    `subscription_code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `start_date` DATE NOT NULL,
    `renewal_date` DATE NOT NULL,
    `billing_frequency` ENUM('MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL', 'BIENNIAL', 'CUSTOM') NOT NULL,
    `supplier_cost` DECIMAL(14, 3) NULL,
    `selling_price` DECIMAL(14, 3) NOT NULL,
    `currency` VARCHAR(3) NOT NULL,
    `provider_auto_renews` BOOLEAN NOT NULL DEFAULT true,
    `status` ENUM('ACTIVE', 'SUSPENDED', 'CLOSED') NOT NULL DEFAULT 'ACTIVE',
    `grace_hours` INTEGER NOT NULL DEFAULT 24,
    `source_legacy_reference` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `subscriptions_subscription_code_key`(`subscription_code`),
    INDEX `subscriptions_customer_id_idx`(`customer_id`),
    INDEX `subscriptions_service_type_id_idx`(`service_type_id`),
    INDEX `subscriptions_renewal_date_status_idx`(`renewal_date`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `technical_connections` (
    `id` VARCHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` ENUM('PLESK', 'SMARTERMAIL', 'MANUAL', 'FUTURE_API') NOT NULL,
    `endpoint` VARCHAR(500) NULL,
    `credentials_ciphertext` TEXT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `environment` ENUM('SANDBOX', 'PRODUCTION') NOT NULL DEFAULT 'SANDBOX',
    `capabilities` JSON NULL,
    `last_health_status` ENUM('UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNAVAILABLE') NOT NULL DEFAULT 'UNKNOWN',
    `last_health_checked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `technical_connections_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscription_connections` (
    `id` VARCHAR(36) NOT NULL,
    `subscription_id` VARCHAR(36) NOT NULL,
    `technical_connection_id` VARCHAR(36) NOT NULL,
    `remote_identifier` VARCHAR(191) NOT NULL,
    `action_profile` JSON NULL,
    `metadata` JSON NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `subscription_connections_technical_connection_id_idx`(`technical_connection_id`),
    UNIQUE INDEX `subscription_connections_subscription_id_technical_connectio_key`(`subscription_id`, `technical_connection_id`, `remote_identifier`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `renewal_cases` (
    `id` VARCHAR(36) NOT NULL,
    `subscription_id` VARCHAR(36) NOT NULL,
    `cycle_start_date` DATE NOT NULL,
    `due_date` DATE NOT NULL,
    `status` ENUM('UPCOMING', 'REMINDER_CYCLE', 'AWAITING_CUSTOMER', 'HUMAN_REVIEW', 'ACCEPTED', 'INVOICE_DRAFT', 'INVOICE_PENDING_PUBLICATION', 'INVOICE_PUBLISHED', 'COLLECTING', 'PAYMENT_REPORTED', 'PAYMENT_CONFIRMED', 'FULFILLED', 'REJECTED', 'RETENTION', 'DO_NOT_RENEW', 'SUSPENSION_DUE', 'SUSPENSION_PENDING_APPROVAL', 'SUSPENSION_IN_PROGRESS', 'SUSPENDED', 'REACTIVATION_PENDING', 'CLOSED', 'ERROR') NOT NULL DEFAULT 'UPCOMING',
    `customer_decision` ENUM('ACCEPTED', 'REJECTED', 'UNDECIDED') NOT NULL DEFAULT 'UNDECIDED',
    `accepted_at` DATETIME(3) NULL,
    `rejected_at` DATETIME(3) NULL,
    `do_not_renew_at` DATETIME(3) NULL,
    `suspension_due_at` DATETIME(3) NULL,
    `fulfilled_at` DATETIME(3) NULL,
    `closed_at` DATETIME(3) NULL,
    `assigned_user_id` VARCHAR(36) NULL,
    `last_customer_contact_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `renewal_cases_status_due_date_idx`(`status`, `due_date`),
    INDEX `renewal_cases_assigned_user_id_idx`(`assigned_user_id`),
    UNIQUE INDEX `renewal_cases_subscription_id_due_date_key`(`subscription_id`, `due_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` VARCHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `permissions` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `roles_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(36) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `display_name` VARCHAR(191) NOT NULL,
    `password_hash` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `failed_attempts` INTEGER NOT NULL DEFAULT 0,
    `locked_until` DATETIME(3) NULL,
    `mfa_enabled` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_roles` (
    `user_id` VARCHAR(36) NOT NULL,
    `role_id` VARCHAR(36) NOT NULL,
    `assigned_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_roles_role_id_idx`(`role_id`),
    PRIMARY KEY (`user_id`, `role_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_sessions` (
    `id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `refresh_token_hash` VARCHAR(191) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `auth_sessions_user_id_expires_at_idx`(`user_id`, `expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_mfa_methods` (
    `id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `type` ENUM('TOTP', 'WEBAUTHN') NOT NULL,
    `label` VARCHAR(191) NULL,
    `secret_ciphertext` TEXT NULL,
    `credential_data` JSON NULL,
    `verified_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_mfa_methods_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_events` (
    `id` VARCHAR(36) NOT NULL,
    `actor_type` ENUM('USER', 'SYSTEM', 'AI', 'INTEGRATION') NOT NULL,
    `actor_id` VARCHAR(36) NULL,
    `event_key` VARCHAR(191) NOT NULL,
    `subject_type` VARCHAR(191) NOT NULL,
    `subject_id` VARCHAR(191) NOT NULL,
    `old_state` JSON NULL,
    `new_state` JSON NULL,
    `metadata` JSON NULL,
    `ip_address` VARCHAR(45) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_events_subject_type_subject_id_created_at_idx`(`subject_type`, `subject_id`, `created_at`),
    INDEX `audit_events_event_key_created_at_idx`(`event_key`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `legacy_import_batches` (
    `id` VARCHAR(36) NOT NULL,
    `source_file_name` VARCHAR(191) NOT NULL,
    `source_file_hash` VARCHAR(191) NOT NULL,
    `source_file_size` INTEGER NOT NULL,
    `status` ENUM('STAGED', 'IN_REVIEW', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED') NOT NULL DEFAULT 'STAGED',
    `uploaded_by_id` VARCHAR(36) NOT NULL,
    `total_rows` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `legacy_import_batches_source_file_hash_key`(`source_file_hash`),
    INDEX `legacy_import_batches_status_created_at_idx`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `legacy_import_rows` (
    `id` VARCHAR(36) NOT NULL,
    `batch_id` VARCHAR(36) NOT NULL,
    `sheet_name` VARCHAR(191) NOT NULL,
    `source_row_number` INTEGER NOT NULL,
    `source_reference` VARCHAR(191) NOT NULL,
    `row_fingerprint` VARCHAR(191) NOT NULL,
    `raw_values_ciphertext` TEXT NOT NULL,
    `raw_preview` JSON NOT NULL,
    `mapped_customer` JSON NULL,
    `mapped_subscriptions` JSON NULL,
    `duplicate_candidates` JSON NOT NULL,
    `validation_issues` JSON NOT NULL,
    `status` ENUM('STAGED', 'REQUIRES_MANUAL_REVIEW', 'READY_FOR_APPROVAL', 'APPROVED', 'FAILED', 'SKIPPED') NOT NULL DEFAULT 'STAGED',
    `validation_status` ENUM('PENDING', 'VALID', 'INVALID', 'AMBIGUOUS') NOT NULL DEFAULT 'PENDING',
    `customer_resolution` ENUM('CREATE_NEW', 'ATTACH_EXISTING', 'NOT_DUPLICATE') NULL,
    `candidate_customer_id` VARCHAR(36) NULL,
    `billing_entity_id` VARCHAR(36) NULL,
    `manual_review_reason` TEXT NULL,
    `resolution_notes` TEXT NULL,
    `approved_customer_id` VARCHAR(36) NULL,
    `approved_by_id` VARCHAR(36) NULL,
    `approved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `legacy_import_rows_batch_id_status_idx`(`batch_id`, `status`),
    INDEX `legacy_import_rows_candidate_customer_id_idx`(`candidate_customer_id`),
    INDEX `legacy_import_rows_approved_customer_id_idx`(`approved_customer_id`),
    UNIQUE INDEX `legacy_import_rows_batch_id_sheet_name_source_row_number_key`(`batch_id`, `sheet_name`, `source_row_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `legacy_import_subscription_links` (
    `id` VARCHAR(36) NOT NULL,
    `import_row_id` VARCHAR(36) NOT NULL,
    `subscription_id` VARCHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `legacy_import_subscription_links_subscription_id_key`(`subscription_id`),
    INDEX `legacy_import_subscription_links_import_row_id_idx`(`import_row_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `customers` ADD CONSTRAINT `customers_billing_entity_id_fkey` FOREIGN KEY (`billing_entity_id`) REFERENCES `billing_entities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_service_type_id_fkey` FOREIGN KEY (`service_type_id`) REFERENCES `service_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscription_connections` ADD CONSTRAINT `subscription_connections_subscription_id_fkey` FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscription_connections` ADD CONSTRAINT `subscription_connections_technical_connection_id_fkey` FOREIGN KEY (`technical_connection_id`) REFERENCES `technical_connections`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `renewal_cases` ADD CONSTRAINT `renewal_cases_subscription_id_fkey` FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `renewal_cases` ADD CONSTRAINT `renewal_cases_assigned_user_id_fkey` FOREIGN KEY (`assigned_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_sessions` ADD CONSTRAINT `auth_sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_mfa_methods` ADD CONSTRAINT `user_mfa_methods_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `legacy_import_batches` ADD CONSTRAINT `legacy_import_batches_uploaded_by_id_fkey` FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `legacy_import_rows` ADD CONSTRAINT `legacy_import_rows_batch_id_fkey` FOREIGN KEY (`batch_id`) REFERENCES `legacy_import_batches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `legacy_import_rows` ADD CONSTRAINT `legacy_import_rows_candidate_customer_id_fkey` FOREIGN KEY (`candidate_customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `legacy_import_rows` ADD CONSTRAINT `legacy_import_rows_billing_entity_id_fkey` FOREIGN KEY (`billing_entity_id`) REFERENCES `billing_entities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `legacy_import_rows` ADD CONSTRAINT `legacy_import_rows_approved_customer_id_fkey` FOREIGN KEY (`approved_customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `legacy_import_rows` ADD CONSTRAINT `legacy_import_rows_approved_by_id_fkey` FOREIGN KEY (`approved_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `legacy_import_subscription_links` ADD CONSTRAINT `legacy_import_subscription_links_import_row_id_fkey` FOREIGN KEY (`import_row_id`) REFERENCES `legacy_import_rows`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `legacy_import_subscription_links` ADD CONSTRAINT `legacy_import_subscription_links_subscription_id_fkey` FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Audit events are append-only. MariaDB SIGNAL aborts every attempted mutation.
CREATE TRIGGER `audit_events_prevent_update`
BEFORE UPDATE ON `audit_events`
FOR EACH ROW
SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'audit_events are append-only';

CREATE TRIGGER `audit_events_prevent_delete`
BEFORE DELETE ON `audit_events`
FOR EACH ROW
SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'audit_events are append-only';
