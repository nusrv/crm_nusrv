-- Phase 3.1 — Administration & Integration Settings. Purely additive: three new nullable/defaulted
-- columns on `mail_configurations`, plus one new table (`ai_settings`). No column dropped or
-- renamed, no existing enum value removed, no existing row touched or reinterpreted.
--
-- FAIL CLOSED (non-negotiable): every new boolean column below defaults FALSE. After this migration
-- runs against a live production database, every existing MailConfiguration keeps sending/syncing
-- exactly as it already was gated (by the legacy MAIL_SEND_ENABLED/IMAP_SYNC_ENABLED env vars and
-- environment guard) — nothing new starts sending or syncing, and no AiSettings row exists at all,
-- which AiSettingsResolverService treats as AI fully disabled. See PHASES/PHASE_03_1_ADMIN_SETTINGS.md
-- for the full operational-vs-infrastructure settings boundary this migration implements.

-- AlterTable
ALTER TABLE `mail_configurations`
    ADD COLUMN `inbound_sync_enabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `outbound_send_enabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `outbound_send_cutover_at` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `ai_settings` (
    `id` VARCHAR(36) NOT NULL,
    `singleton` BOOLEAN NOT NULL DEFAULT true,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `provider` VARCHAR(50) NOT NULL DEFAULT 'OPENAI',
    `model` VARCHAR(191) NULL,
    `confidence_threshold` DECIMAL(4, 3) NULL,
    `api_key_ciphertext` TEXT NULL,
    `auto_route_accept` BOOLEAN NOT NULL DEFAULT false,
    `auto_route_accept_cutover_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ai_settings_singleton_key`(`singleton`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
