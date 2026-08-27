# Phase 2.1 — Operational Data Correction

## Scope

This owner-authorized correction adds a versioned package catalog and evidence-based migration
workflow for the 214 records in the untouched `Active_Subscriptions` legacy worksheet. It does not
start Phase 3.

## Implemented

- MariaDB models/migration for Service Packages, catalog terms, customer contacts, subscription
  identifiers, package/specification snapshots, classification evidence, and explicit 1–120 month
  renewal intervals.
- Idempotent seeds for the 19 official offers in `Packages.docx`, eight service-specific Custom
  templates, DNS Hosting, and App Subscription service types.
- Deterministic classification where technical Information outranks Registration Type; conflicts,
  bundles, altered specifications, custom offers, and incomplete data remain human decisions.
- Structured import review for customer resolution, package selection, dates, prices, identifiers,
  explicit subscription splits, and approval rationale. Raw mapping JSON inputs were removed.
- Package Catalog, subscription, and customer/contact operational screens with existing RBAC and
  audit patterns.
- Renewal cycle calculations accept an explicit interval while preserving prior Billing Frequency
  behavior when no interval is stored.

## Source safety

`dont_push_to_git/Project20report20Filled.xlsx` remains untouched and ignored by Git. The dry-run
tool creates separate ignored outputs:

- `dont_push_to_git/Phase_2_1_Dry_Run_Report.json`
- `dont_push_to_git/Phase_2_1_Human_Review.xlsx`

No dry-run row is inserted into a live Customer or Subscription table.

## 214-row reconciliation result

- Total active rows: 214
- Suggested official matches: 85
- Suggested custom packages: 72
- Conflicting/ambiguous classifications: 57
- Ready for live approval: 0
- Human approval required: 214

Every row still needs confirmed start/renewal dates because the legacy workbook does not safely
provide a start date and its `Renewal / date (-15days)` column is a reminder date, not a proven
renewal date. Custom and conflicting rows also require explicit package decisions. These values
must not be fabricated.

## Completion blockers

1. The owner/operator must complete the human-review decisions in the CP or the separate review
   workbook. Only then can all 214 rows be approved/reconciled.
2. Authorized Plesk/SSH access, staging MariaDB credentials, and Redis access are still unavailable,
   so the new migration, seed, UI, worker, and renewal regression cannot yet be run on
   `crm.nusrv.com`.

Phase 2.1 is implemented and locally verified but remains incomplete until both gates are cleared.
Phase 3 remains locked.
