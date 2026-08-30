# Project Status

## Current status

- Phase 0: COMPLETE / OWNER APPROVED
- Phase 1: COMPLETE / OWNER APPROVED
- Phase 2: COMPLETE / OWNER APPROVED
- Phase 2.1 Operational Data Correction: IMPLEMENTED LOCALLY / awaiting human data decisions and staging verification
- Staging Runtime Gate: BLOCKED — awaiting deployment/access to `crm.nusrv.com`
- Phase 3: LOCKED
- Phase 4+: LOCKED

## Phase 2.1 operational data correction

The codebase now has a MariaDB package catalog and term model, subscription package/specification
snapshots, explicit renewal intervals, structured customer contacts and subscription identifiers,
deterministic legacy classification, and a structured import review UI. Catalog pricing is separate
from actual subscription selling prices. All classification evidence and original registration
values remain traceable.

The official seed contains 19 offers/add-ons taken from `Packages.docx` plus eight
service-specific Custom templates. Supported standard term choices are 12, 24, 36, and 60 months;
explicit custom intervals from 1 through 120 months are supported.

The non-mutating dry run reconciled all 214 `Active_Subscriptions` source rows:

- 85 suggested official-package matches
- 72 suggested Custom classifications
- 57 ambiguous/conflicting classifications
- 214 rows still require human approval
- 0 rows were written to live Customer/Subscription tables

The operational importer preserves all 604 source rows for traceability while limiting human review
to the 214 `Active_Subscriptions` rows. The 388 `Suspended_Subscriptions` rows and two
miscellaneous-sheet rows are marked `SKIPPED` as out of scope. Migration
`20260827010000_scope_legacy_import_active_sheet` repairs already-staged batches idempotently
without deleting raw data or touching approved rows.

Explicit `Start Date` and `End Date` workbook columns are now preserved as source evidence,
validated against the recorded term, and prefilled into untouched subscription-review drafts. Excel
calendar dates are parsed without an operating-system timezone shift. Missing, invalid, reversed, or
term-conflicting dates remain flagged for human correction. Re-importing the identical workbook
refreshes only untouched manual-review rows and preserves corrected, ready, and approved rows. The
source `Renewal / date (-15days)` value remains separate evidence. The 72 Custom and 57 conflicting
rows still require explicit package decisions; split/merge decisions are never automatic. Private
review artifacts are under the Git-ignored `dont_push_to_git/` directory.

Local verification passes Prisma generation, strict type checking, lint, formatting, the NestJS
production build, the Next.js production build, and 119 default automated tests across 38 suites.
Twelve guarded tests across three live MariaDB suites are skipped unless MARIADB_TEST_DATABASE_URL
targets a disposable test database. The 214-row workbook dry run was repeated with identical results
while the source workbook hash remained unchanged.

Open dependency advisory: a clean npm audit reports three high-severity findings in the Prisma CLI
configuration chain (@prisma/config to deepmerge-ts). Prisma 7.10.0 still uses the affected
dependency, while npm proposes a prohibited forced downgrade to Prisma 6. The lockfile was not
mutated; this upstream Prisma 7 advisory must be monitored before production promotion.

## Staging CAPTCHA deployment patch

The internal staff-only Control Panel supports `CAPTCHA_PROVIDER=none` in production. Login then
requires only email and password; credential validation, lockout, secure cookies, origin/CSRF
protection, RBAC, and audit behavior remain unchanged. Turnstile and reCAPTCHA retain credential
validation, and mock CAPTCHA remains prohibited in production.

## Phase 2 renewal behavior

The approved deterministic renewal engine remains unchanged except for additive support for an
explicit renewal interval. Existing frequency behavior remains the fallback. Reminder milestones,
outbox idempotency, BullMQ worker separation, business timezone, multi-hold aggregation, RBAC, and
audit behavior remain covered by the full test suite. No SMTP delivery or Phase 3 integration exists.

## Staging Runtime Gate blocker

The target is `crm.nusrv.com` on Plesk 18.0.80 with Node.js 22.23.2, MariaDB 11.4.7, and Redis
7.4.11. This environment has no authorized SSH/Plesk deployment access, staging database
credentials, or Redis runtime access. Therefore it cannot truthfully run or verify:

- the canonical three-migration MariaDB deployment and idempotent seed on staging;
- live MariaDB constraints and Phase 2.1 CRUD/import approval;
- Redis readiness, persistent worker, and registered scheduler;
- the deployed UI/API, role matrix, security checks, and renewal/outbox idempotency.

The staging gate remains BLOCKED, not failed.

## Required owner/operator actions

1. After deploying the explicit-date importer patch, re-upload
   `dont_push_to_git/Project20report20Filled_With_Start_End_Dates.xlsx`. The identical existing
   batch is reused and untouched rows receive the validated dates. Confirm the prefilled dates and
   complete every ambiguous/custom package decision in the structured review UI.
2. Provide authorized Plesk/SSH access (or have the server administrator execute the runbook),
   a dedicated staging MariaDB database/user, and private authenticated Redis access.
3. Run the live MariaDB suite, migrations/seed, Phase 2 renewal regression, RBAC/security smoke
   tests, and worker/scheduler verification on staging.

## Integration status

- MariaDB: Phase 2.1 schema/migration and guarded tests prepared; staging execution blocked
- Redis/BullMQ: approved Phase 2 scheduler/worker preserved; real staging runtime blocked
- Communication outbox: durable queue records only; no delivery transport
- Technical Connections: secure configuration/mapping only; no external provider calls
- Phase 3 integrations: LOCKED and not started

## Next allowed work

Only Phase 2.1 human data resolution and the Phase 02/2.1 staging runtime gate are allowed. Phase 3
remains locked until Phase 2.1 is fully completed, verified, and explicitly authorized by the owner.
