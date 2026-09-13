-- Phase 3 Slice A — Mail & AI communication domain (schema only). Purely additive: six new tables
-- (CommunicationThread, EmailMessage, AiClassification, ClassificationReview, MailConfiguration,
-- IntegrationHealthEvent) plus two new nullable columns on the existing `communication_outbox`
-- table. No column is dropped or renamed, no existing enum value is removed, no existing row is
-- rewritten, and this migration contains no UPDATE/SELECT against existing data at all — every
-- current production row in every existing table is completely unaffected.
--
-- No SMTP/IMAP/LLM adapter, worker, controller, or frontend code exists yet — this migration is
-- schema/persistence only, per the approved Slice A architecture review. See
-- PHASES/PHASE_03_MAIL_AI.md and the field-level comments in schema.prisma for the reasoning behind
-- every column/constraint/onDelete choice below; this file only calls out the DDL-specific points
-- that matter operationally.

-- ================================================================================================
-- 1. CommunicationOutbox additions — both nullable, both NULL for every existing row (no backfill
--    is required or desired: a historical row that predates this slice simply has no linked
--    EmailMessage and no known Message-ID header, which is exactly correct).
-- ================================================================================================
-- AlterTable
ALTER TABLE `communication_outbox` ADD COLUMN `email_message_id` VARCHAR(36) NULL,
    ADD COLUMN `message_id_header` VARCHAR(500) NULL;

-- ================================================================================================
-- 2. CommunicationThread — the real, first-class thread identity (own `id`, not a derived key).
--    `renewal_case_id` is nullable + UNIQUE: MariaDB permits multiple NULLs under a UNIQUE index,
--    so any number of unattributed/general threads may exist, while a given non-null RenewalCase
--    can never have more than one canonical thread — enforced here at the database level, which is
--    what makes this safe under concurrent thread creation (not merely a service-layer check).
-- ================================================================================================
-- CreateTable
CREATE TABLE `communication_threads` (
    `id` VARCHAR(36) NOT NULL,
    `customer_id` VARCHAR(36) NULL,
    `renewal_case_id` VARCHAR(36) NULL,
    `mail_configuration_id` VARCHAR(36) NOT NULL,
    `subject` VARCHAR(500) NOT NULL,
    `status` ENUM('OPEN', 'HUMAN_REVIEW', 'RESOLVED') NOT NULL DEFAULT 'OPEN',
    `last_message_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `communication_threads_renewal_case_id_key`(`renewal_case_id`),
    INDEX `communication_threads_customer_id_idx`(`customer_id`),
    INDEX `communication_threads_mail_configuration_id_idx`(`mail_configuration_id`),
    INDEX `communication_threads_status_idx`(`status`),
    INDEX `communication_threads_last_message_at_idx`(`last_message_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ================================================================================================
-- 3. EmailMessage — the single, unified, canonical communication-history record for BOTH inbound
--    and outbound mail. `external_message_id` is intentionally non-unique/indexed only (Message-ID
--    is a correlation aid, never the authoritative dedup key — see `imap_identity_key` instead,
--    which is the real inbound-dedup invariant and IS unique). `body_text` is required; `body_html`
--    is nullable and stored for completeness only — nothing in this slice renders it.
-- ================================================================================================
-- CreateTable
CREATE TABLE `email_messages` (
    `id` VARCHAR(36) NOT NULL,
    `thread_id` VARCHAR(36) NOT NULL,
    `customer_id` VARCHAR(36) NULL,
    `renewal_case_id` VARCHAR(36) NULL,
    `direction` ENUM('INBOUND', 'OUTBOUND') NOT NULL,
    `channel` ENUM('EMAIL') NOT NULL DEFAULT 'EMAIL',
    `external_message_id` VARCHAR(500) NULL,
    `in_reply_to` VARCHAR(500) NULL,
    `references` TEXT NULL,
    `subject` VARCHAR(500) NOT NULL,
    `from_address` VARCHAR(320) NOT NULL,
    `to_addresses_json` JSON NOT NULL,
    `body_text` TEXT NOT NULL,
    `body_html` TEXT NULL,
    `occurred_at` DATETIME(3) NOT NULL,
    `classification_status` ENUM('PENDING', 'CLASSIFIED', 'HUMAN_REVIEW', 'RESOLVED', 'FAILED') NULL,
    `mail_configuration_id` VARCHAR(36) NOT NULL,
    `imap_folder` VARCHAR(255) NULL,
    `imap_uid` BIGINT NULL,
    `imap_uid_validity` BIGINT NULL,
    -- Computed by Slice C, never client-supplied. NULL for every OUTBOUND row (multiple NULLs are
    -- permitted under this UNIQUE index), which is the entire mechanism that keeps outbound rows
    -- unaffected by inbound dedup. FROZEN format (see the full schema.prisma field comment for the
    -- exact algorithm and the frozen canonicalFolder rule): "v1:" + SHA256_hex(length-prefixed
    -- canonical encoding of [mailConfigurationId, canonicalFolder, uidValidity, uid]) = exactly 67
    -- characters, always well within this column's 191-character width.
    `imap_identity_key` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `email_messages_imap_identity_key_key`(`imap_identity_key`),
    INDEX `email_messages_thread_id_idx`(`thread_id`),
    INDEX `email_messages_customer_id_idx`(`customer_id`),
    INDEX `email_messages_renewal_case_id_idx`(`renewal_case_id`),
    INDEX `email_messages_occurred_at_idx`(`occurred_at`),
    INDEX `email_messages_classification_status_idx`(`classification_status`),
    INDEX `email_messages_external_message_id_idx`(`external_message_id`),
    INDEX `email_messages_mail_configuration_id_imap_folder_imap_uid_idx`(`mail_configuration_id`, `imap_folder`, `imap_uid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ================================================================================================
-- 4. AiClassification — immutable AI evidence. No `reviewed_by`/`reviewed_at`/`updated_at` column
--    exists on this table by design: a reviewer's correction is always a separate, new
--    ClassificationReview row (below), never a mutation of this one.
-- ================================================================================================
-- CreateTable
CREATE TABLE `ai_classifications` (
    `id` VARCHAR(36) NOT NULL,
    `email_message_id` VARCHAR(36) NOT NULL,
    `provider` VARCHAR(100) NOT NULL,
    `model` VARCHAR(150) NOT NULL,
    `prompt_version` VARCHAR(50) NOT NULL,
    `intent` ENUM('ACCEPT_RENEWAL', 'REJECT_RENEWAL', 'REQUEST_INVOICE', 'PAYMENT_REPORTED', 'REQUEST_UPGRADE', 'REQUEST_DOWNGRADE', 'REQUEST_CLARIFICATION', 'PRICE_DISPUTE', 'COMPLAINT', 'OTHER', 'UNCLEAR') NOT NULL,
    `confidence` DECIMAL(4, 3) NOT NULL,
    `structured_result_json` JSON NOT NULL,
    `requires_human_review` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_classifications_email_message_id_idx`(`email_message_id`),
    INDEX `ai_classifications_requires_human_review_idx`(`requires_human_review`),
    INDEX `ai_classifications_intent_idx`(`intent`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ================================================================================================
-- 5. ClassificationReview — separate, human-authored, append-only review evidence. Multiple rows
--    per classification are expected; there is deliberately no `is_current`/`current_review_id`
--    mutable flag. `corrected_result_json` is NOT NULL: every review stores the full corrected
--    structured result, never a partial patch.
--
--    FROZEN EFFECTIVE-REVIEW CONTRACT — two distinct queries, never conflated:
--      A. Latest review for ONE ai_classification_id:
--           WHERE ai_classification_id = ?  ORDER BY created_at DESC, id DESC  LIMIT 1
--         (ai_classification_id is a WHERE-equality filter here, never a sort key.) This is what
--         the `classification_reviews_ai_classification_id_created_at_id_idx` composite index
--         below serves.
--      B. Latest review for ONE email_message_id (a message may have multiple ai_classifications
--         rows, e.g. a retry with a newer prompt version, each with its own reviews):
--           JOIN classification_reviews -> ai_classifications
--           WHERE ai_classifications.email_message_id = ?
--           ORDER BY classification_reviews.created_at DESC, classification_reviews.id DESC
--           LIMIT 1
--         ai_classification_id must NEVER appear in this ORDER BY — sorting by it would not select
--         the actually-latest review across a message's possibly-several classifications. Rule B
--         is a Slice C query via the join above, reading through the existing
--         `ai_classifications_email_message_id_idx`; no additional index is added for it here.
--
--    Deliberately has NO `email_message_id` column. The authoritative chain is
--    classification_reviews -> ai_classifications -> email_messages only. An earlier draft of this
--    migration carried both `ai_classification_id` and `email_message_id` independently, which
--    permitted a logically-inconsistent row: both foreign keys individually valid, yet pointing at
--    two DIFFERENT messages (a review's classification for message A, while the review's own
--    email_message_id pointed at message B). Removing the redundant column removes that
--    possibility structurally — there is no column left through which it could happen — rather than
--    relying on service-layer discipline to keep two independent foreign keys in agreement.
-- ================================================================================================
-- CreateTable
CREATE TABLE `classification_reviews` (
    `id` VARCHAR(36) NOT NULL,
    `ai_classification_id` VARCHAR(36) NOT NULL,
    `reviewer_id` VARCHAR(36) NOT NULL,
    `corrected_intent` ENUM('ACCEPT_RENEWAL', 'REJECT_RENEWAL', 'REQUEST_INVOICE', 'PAYMENT_REPORTED', 'REQUEST_UPGRADE', 'REQUEST_DOWNGRADE', 'REQUEST_CLARIFICATION', 'PRICE_DISPUTE', 'COMPLAINT', 'OTHER', 'UNCLEAR') NOT NULL,
    `corrected_result_json` JSON NOT NULL,
    `notes` TEXT NULL,
    `resulting_action` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `classification_reviews_reviewer_id_idx`(`reviewer_id`),
    INDEX `classification_reviews_ai_classification_id_created_at_id_idx`(`ai_classification_id`, `created_at`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ================================================================================================
-- 6. MailConfiguration — one global/default row (`billing_entity_id` NULL) plus optional
--    BillingEntity-specific overrides. `scope_key` (canonical values: "GLOBAL" or
--    "BILLING_ENTITY:<billingEntityId>", computed by the application, never client-supplied) is the
--    UNIQUE constraint that actually prevents both two GLOBAL rows and two rows for the same
--    BillingEntity. No DB CHECK constraint enforces scope_key/billing_entity_id *consistency* (i.e.
--    that scope_key genuinely encodes the row's own billing_entity_id) — see the Slice A
--    implementation report for why that was deliberately left to Slice C service-layer validation
--    rather than added here. Only *ciphertext* credential columns exist; there is no plaintext
--    secret column anywhere on this table.
-- ================================================================================================
-- CreateTable
CREATE TABLE `mail_configurations` (
    `id` VARCHAR(36) NOT NULL,
    `billing_entity_id` VARCHAR(36) NULL,
    `scope_key` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `smtp_host` VARCHAR(255) NOT NULL,
    `smtp_port` INTEGER NOT NULL,
    `smtp_username` VARCHAR(255) NOT NULL,
    `smtp_credentials_ciphertext` TEXT NULL,
    `smtp_secure` BOOLEAN NOT NULL DEFAULT true,
    `imap_host` VARCHAR(255) NOT NULL,
    `imap_port` INTEGER NOT NULL,
    `imap_username` VARCHAR(255) NOT NULL,
    `imap_credentials_ciphertext` TEXT NULL,
    `imap_secure` BOOLEAN NOT NULL DEFAULT true,
    `imap_folder` VARCHAR(255) NOT NULL DEFAULT 'INBOX',
    `from_address` VARCHAR(320) NOT NULL,
    `from_name` VARCHAR(191) NOT NULL,
    `environment` ENUM('SANDBOX', 'PRODUCTION') NOT NULL DEFAULT 'SANDBOX',
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `last_synced_at` DATETIME(3) NULL,
    `last_sync_uid_validity` BIGINT NULL,
    `last_sync_uid` BIGINT NULL,
    `last_health_status` ENUM('UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNAVAILABLE') NOT NULL DEFAULT 'UNKNOWN',
    `last_health_checked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `mail_configurations_scope_key_key`(`scope_key`),
    INDEX `mail_configurations_billing_entity_id_idx`(`billing_entity_id`),
    INDEX `mail_configurations_environment_idx`(`environment`),
    INDEX `mail_configurations_enabled_idx`(`enabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ================================================================================================
-- 7. IntegrationHealthEvent — immutable event/signal log (Phase 3 scope: SMTP/IMAP/AI only). This
--    is NOT the future Phase 6/7 incident/action queue: there is no `resolved_at`, `assigned_to`,
--    `owner`, resolution-workflow column, or even `updated_at` here by design. Recovery is always
--    represented by inserting a new row (e.g. status HEALTHY after a prior UNAVAILABLE), never by
--    updating an old one.
-- ================================================================================================
-- CreateTable
CREATE TABLE `integration_health_events` (
    `id` VARCHAR(36) NOT NULL,
    `integration` ENUM('SMTP', 'IMAP', 'AI') NOT NULL,
    `status` ENUM('UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNAVAILABLE') NOT NULL,
    `message` TEXT NOT NULL,
    `context` JSON NULL,
    `mail_configuration_id` VARCHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `integration_health_events_created_at_idx`(`created_at`),
    INDEX `integration_health_events_integration_mailbox_created_idx`(`integration`, `mail_configuration_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ================================================================================================
-- 8. New unique index + foreign keys. All thirteen foreign keys below are either RESTRICT or
--    SET NULL on delete — never CASCADE (the universal ON UPDATE CASCADE is Prisma's standard
--    referential action for primary-key updates and is inert here in practice, since every primary
--    key in this schema is an immutable UUID; it is applied uniformly to every foreign key already
--    in this schema, not something newly introduced by this migration). Note there is no
--    `classification_reviews_email_message_id_fkey` here — see section 5 above for why that column
--    (and its FK) does not exist.
-- ================================================================================================
-- CreateIndex
CREATE UNIQUE INDEX `communication_outbox_email_message_id_key` ON `communication_outbox`(`email_message_id`);

-- AddForeignKey
ALTER TABLE `communication_outbox` ADD CONSTRAINT `communication_outbox_email_message_id_fkey` FOREIGN KEY (`email_message_id`) REFERENCES `email_messages`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `communication_threads` ADD CONSTRAINT `communication_threads_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `communication_threads` ADD CONSTRAINT `communication_threads_renewal_case_id_fkey` FOREIGN KEY (`renewal_case_id`) REFERENCES `renewal_cases`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `communication_threads` ADD CONSTRAINT `communication_threads_mail_configuration_id_fkey` FOREIGN KEY (`mail_configuration_id`) REFERENCES `mail_configurations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `email_messages` ADD CONSTRAINT `email_messages_thread_id_fkey` FOREIGN KEY (`thread_id`) REFERENCES `communication_threads`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `email_messages` ADD CONSTRAINT `email_messages_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `email_messages` ADD CONSTRAINT `email_messages_renewal_case_id_fkey` FOREIGN KEY (`renewal_case_id`) REFERENCES `renewal_cases`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `email_messages` ADD CONSTRAINT `email_messages_mail_configuration_id_fkey` FOREIGN KEY (`mail_configuration_id`) REFERENCES `mail_configurations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_classifications` ADD CONSTRAINT `ai_classifications_email_message_id_fkey` FOREIGN KEY (`email_message_id`) REFERENCES `email_messages`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `classification_reviews` ADD CONSTRAINT `classification_reviews_ai_classification_id_fkey` FOREIGN KEY (`ai_classification_id`) REFERENCES `ai_classifications`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `classification_reviews` ADD CONSTRAINT `classification_reviews_reviewer_id_fkey` FOREIGN KEY (`reviewer_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `mail_configurations` ADD CONSTRAINT `mail_configurations_billing_entity_id_fkey` FOREIGN KEY (`billing_entity_id`) REFERENCES `billing_entities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `integration_health_events` ADD CONSTRAINT `integration_health_events_mail_configuration_id_fkey` FOREIGN KEY (`mail_configuration_id`) REFERENCES `mail_configurations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
