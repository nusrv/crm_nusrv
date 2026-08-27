-- Phase 2.1 active-subscription import scope correction.
-- Preserve every source row, but remove non-active worksheets from the human review queue.

INSERT INTO `audit_events` (
    `id`,
    `actor_type`,
    `actor_id`,
    `event_key`,
    `subject_type`,
    `subject_id`,
    `old_state`,
    `new_state`,
    `metadata`,
    `ip_address`,
    `created_at`
)
SELECT
    UUID(),
    'SYSTEM',
    NULL,
    'legacy_import.scope_reconciled',
    'LegacyImportBatch',
    `batch_id`,
    JSON_OBJECT('manualReviewRowsBefore', COUNT(*)),
    JSON_OBJECT(
        'rowsSkipped', COUNT(*),
        'activeSheet', 'Active_Subscriptions'
    ),
    JSON_OBJECT(
        'reason', 'Preserved from the source workbook but excluded from the active-subscription migration scope.'
    ),
    NULL,
    CURRENT_TIMESTAMP(3)
FROM `legacy_import_rows`
WHERE `sheet_name` <> 'Active_Subscriptions'
  AND `status` IN ('STAGED', 'REQUIRES_MANUAL_REVIEW')
GROUP BY `batch_id`;

UPDATE `legacy_import_rows`
SET
    `status` = 'SKIPPED',
    `validation_status` = 'PENDING',
    `validation_issues` = JSON_ARRAY(
        'Preserved from the source workbook but excluded from the active-subscription migration scope.'
    ),
    `manual_review_reason` = NULL,
    `resolution_notes` = 'Preserved from the source workbook but excluded from the active-subscription migration scope.',
    `updated_at` = CURRENT_TIMESTAMP(3)
WHERE `sheet_name` <> 'Active_Subscriptions'
  AND `status` IN ('STAGED', 'REQUIRES_MANUAL_REVIEW');
