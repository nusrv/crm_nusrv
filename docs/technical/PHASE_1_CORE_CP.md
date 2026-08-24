# Phase 1 — Core Control Panel and Legacy Import

## Delivered scope

Phase 1 adds an authenticated internal Control Panel for Billing Entities, customers, configurable
Service Types, subscriptions, Technical Connections, subscription-to-connection mappings, a basic
data dashboard, and controlled migration staging for the supplied legacy Excel workbook.

No reminder engine, email processing, AI, invoicing, payment, retention, suspension, reactivation,
Plesk action, SmarterMail action, MCP, or customer portal functionality is present.

## API modules and RBAC

All routes are under `/api/v1` and remain protected by the Phase 0 cookie authentication, origin,
and role guards.

| Area                  | Read                                 | Manage                                         |
| --------------------- | ------------------------------------ | ---------------------------------------------- |
| Billing Entities      | authenticated operational roles      | Admin                                          |
| Customers             | authenticated operational roles      | Admin, Sales Development                       |
| Service Types         | authenticated operational roles      | Admin                                          |
| Subscriptions         | authenticated operational roles      | Admin, Accountant                              |
| Technical Connections | Admin, IT                            | Admin, IT                                      |
| Subscription mappings | authenticated operational roles      | Admin, IT                                      |
| Legacy batches/rows   | Admin, Accountant, Sales Development | review: Admin/Sales; upload and approve: Admin |
| Dashboard             | authenticated operational roles      | read-only                                      |

There are no permanent-delete endpoints for Phase 1 operational data. Customers, Service Types,
Billing Entities, Technical Connections, subscriptions, and mappings use controlled status fields.

## Technical Connection secrets

Credential objects are encrypted with the Phase 0 AES-256-GCM versioned envelope before Prisma
receives a create/update. API serializers remove `credentialsCiphertext` and expose only
`credentialsConfigured` plus the fixed mask `********`. Audit records receive only the safe
serialized object and a boolean indicating whether credentials changed.

Phase 1 stores connection inventory and mappings only. It does not connect to or act on external
systems.

## Legacy import pipeline

1. An Admin uploads `.xls` or `.xlsx` (maximum 10 MB).
2. The server computes SHA-256 before parsing. A unique batch hash makes an exact re-import return
   the existing batch instead of staging duplicates.
3. The maintained `@e965/xlsx` parser reads the binary XLS workbook without evaluating or executing
   formulas.
4. Each non-empty stageable row receives a sheet name, 1-based source row number, source reference,
   row fingerprint, encrypted raw values, redacted preview, conservative suggestions, validation
   issues, and duplicate candidates.
5. Raw values are AES-256-GCM encrypted because the supplied workbook contains a credential in a
   historical free-text cell. Only a redacted preview is returned by the API.
6. The importer maps only exact, reliable values. It does not infer start dates from prose or split
   combined service descriptions. Missing or ambiguous required values keep the row in
   `REQUIRES_MANUAL_REVIEW`.
7. Duplicate assistance uses exact email/phone/name/domain signals plus conservative name-token
   similarity. Candidates are suggestions; the operator must explicitly choose create-new,
   reject the duplicate suggestion, or attach an existing customer.
8. Admin approval is allowed only after validated review. It creates or attaches the customer,
   creates one or more subscriptions, writes source links, and emits audit events in one database
   transaction.
9. Approval is repeat-safe: an approved row returns its existing live links, and deterministic
   legacy record codes plus unique source-link constraints defend against concurrent or conflicting
   duplication.

The original workbook remains migration source material and is never treated as the operational
database.

## Database migration

`20260823000000_mariadb_phase_0_1_foundation` is the clean, canonical migration from an
empty MariaDB database. For Phase 1 it includes:

- customer notes and search indexes,
- legacy import batch, row, validation, and resolution enums,
- `legacy_import_batches`,
- `legacy_import_rows`,
- `legacy_import_subscription_links`,
- unique constraints for source-file idempotency and live subscription traceability,
- restricted foreign keys to users, Billing Entities, customers, and subscriptions.

The migration also installs MariaDB-native `BEFORE UPDATE` and `BEFORE DELETE` triggers that
keep Phase 0 audit rows append-only.

## Local verification note

This Google Drive-backed directory still cannot safely host `node_modules`. Clean install, Prisma
generation, tests, lint, format, typecheck, and production builds are run in a local temporary copy
using the repository lockfile. A real MariaDB and Redis environment remains required for staging
runtime verification; use the guarded `MARIADB_TEST_DATABASE_URL` live integration suite before
deployment.
