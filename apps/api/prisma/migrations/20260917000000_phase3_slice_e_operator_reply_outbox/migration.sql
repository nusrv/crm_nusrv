-- Phase 3 Slice E — Communication Center operator-reply outbound queue. Purely additive: ONE new
-- table (`operator_reply_outbox`). No column dropped or renamed on any existing table, no existing
-- enum value removed, no existing row touched.
--
-- Deliberately NOT the same table as `communication_outbox` (Phase 2's Reminder/Notification
-- outbox) — that table's `subscription_id`/`renewal_case_id`/`audience`/`days_before_due` columns
-- are all NOT NULL and its worker (MailOutboundService) embeds reminder-cycle business rules
-- (Customer/Subscription ACTIVE checks, isReminderEligible(), workflow-hold suppression) that must
-- never gate a human operator's deliberate reply, and a thread need not have a RenewalCase at all
-- for an operator to reply on it. See the model-level comment on OperatorReplyOutbox in
-- schema.prisma for the full rationale. Reuses the existing `CommunicationOutboxStatus` enum type
-- only as a plain shared data type (QUEUED/PROCESSING/DELIVERED/FAILED/CANCELLED) — no relation to
-- or dependency on `communication_outbox` itself.
--
-- CreateTable
CREATE TABLE `operator_reply_outbox` (
    `id` VARCHAR(36) NOT NULL,
    `thread_id` VARCHAR(36) NOT NULL,
    `mail_configuration_id` VARCHAR(36) NOT NULL,
    `email_message_id` VARCHAR(36) NOT NULL,
    `recipient` VARCHAR(320) NOT NULL,
    `status` ENUM('QUEUED', 'PROCESSING', 'DELIVERED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'QUEUED',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `last_attempt_at` DATETIME(3) NULL,
    `last_error` TEXT NULL,
    -- Contract-audit hardening §2: DB-backed retry-backoff scheduling. NULL = eligible immediately.
    `next_attempt_at` DATETIME(3) NULL,
    `idempotency_key` VARCHAR(191) NOT NULL,
    `actor_id` VARCHAR(36) NOT NULL,
    `queued_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `operator_reply_outbox_email_message_id_key`(`email_message_id`),
    -- Contract-audit correction: uniqueness is scoped to (actor_id, idempotency_key), never the
    -- bare key alone — see the model-level comment on OperatorReplyOutbox.idempotencyKey in
    -- schema.prisma for why a bare-key constraint would let two different operators collide.
    UNIQUE INDEX `operator_reply_outbox_actor_id_idempotency_key_key`(`actor_id`, `idempotency_key`),
    INDEX `operator_reply_outbox_status_queued_at_idx`(`status`, `queued_at`),
    INDEX `operator_reply_outbox_status_next_attempt_at_idx`(`status`, `next_attempt_at`),
    INDEX `operator_reply_outbox_thread_id_idx`(`thread_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `operator_reply_outbox` ADD CONSTRAINT `operator_reply_outbox_thread_id_fkey` FOREIGN KEY (`thread_id`) REFERENCES `communication_threads`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `operator_reply_outbox` ADD CONSTRAINT `operator_reply_outbox_mail_configuration_id_fkey` FOREIGN KEY (`mail_configuration_id`) REFERENCES `mail_configurations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `operator_reply_outbox` ADD CONSTRAINT `operator_reply_outbox_email_message_id_fkey` FOREIGN KEY (`email_message_id`) REFERENCES `email_messages`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `operator_reply_outbox` ADD CONSTRAINT `operator_reply_outbox_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
