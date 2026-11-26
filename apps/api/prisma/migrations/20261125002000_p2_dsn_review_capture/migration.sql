-- Separate review-only intake. No change to email, renewal or outbox status.
CREATE TABLE `mail_dsn_reviews` (
  `id` VARCHAR(36) NOT NULL,
  `identity_key` VARCHAR(80) NOT NULL,
  `mail_configuration_id` VARCHAR(36) NOT NULL,
  `folder` VARCHAR(255) NOT NULL,
  `uid_validity` BIGINT NOT NULL,
  `uid` BIGINT NOT NULL,
  `reason` VARCHAR(32) NOT NULL,
  `source_sha256` VARCHAR(64) NOT NULL,
  `subject` VARCHAR(500) NOT NULL,
  `from_address` VARCHAR(320) NOT NULL,
  `body_text` TEXT NOT NULL,
  `occurred_at` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `mail_dsn_reviews_identity_uq` (`identity_key`),
  KEY `mail_dsn_reviews_created_idx` (`created_at`, `id`),
  CONSTRAINT `mail_dsn_reviews_config_fk` FOREIGN KEY (`mail_configuration_id`) REFERENCES `mail_configurations` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `mail_dsn_reviews_reason_ck` CHECK (BINARY `reason` IN ('REPORT_SHAPED','REPORT_PART_PRESENT'))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TRIGGER `mail_dsn_reviews_no_update` BEFORE UPDATE ON `mail_dsn_reviews`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Review evidence is append-only';
CREATE TRIGGER `mail_dsn_reviews_no_delete` BEFORE DELETE ON `mail_dsn_reviews`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Review evidence is append-only';
