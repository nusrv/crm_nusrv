-- Phase 3 Slice G — Safe Intent Routing. Purely additive: ONE new table (`ai_routing_decisions`).
-- No column dropped or renamed on any existing table, no existing enum value removed, no existing
-- row touched, no existing migration altered.
--
-- `ai_classification_id` is UNIQUE (not composite with routing_version) — an explicit, frozen owner
-- decision: there is EXACTLY ONE durable routing decision per AiClassification, ever.
-- `routing_version` is evidence/reproducibility metadata only, never part of the uniqueness
-- boundary — see the model-level comment on AiRoutingDecision in schema.prisma for the full
-- rationale, including why a historical AiClassification row (created before this migration) can
-- never automatically acquire a routing decision.
--
-- CreateTable
CREATE TABLE `ai_routing_decisions` (
    `id` VARCHAR(36) NOT NULL,
    `ai_classification_id` VARCHAR(36) NOT NULL,
    `renewal_case_id` VARCHAR(36) NULL,
    `routing_version` VARCHAR(50) NOT NULL,
    `action` ENUM('AUTO_ACCEPT', 'HUMAN_REVIEW') NOT NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'SUCCEEDED', 'SKIPPED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `result_code` VARCHAR(191) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `last_attempt_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ai_routing_decisions_ai_classification_id_key`(`ai_classification_id`),
    INDEX `ai_routing_decisions_status_created_at_idx`(`status`, `created_at`),
    INDEX `ai_routing_decisions_status_last_attempt_at_idx`(`status`, `last_attempt_at`),
    INDEX `ai_routing_decisions_renewal_case_id_idx`(`renewal_case_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ai_routing_decisions` ADD CONSTRAINT `ai_routing_decisions_ai_classification_id_fkey` FOREIGN KEY (`ai_classification_id`) REFERENCES `ai_classifications`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_routing_decisions` ADD CONSTRAINT `ai_routing_decisions_renewal_case_id_fkey` FOREIGN KEY (`renewal_case_id`) REFERENCES `renewal_cases`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
