# Phase 4A hardening and Phase 4B verification

Date: 2026-11-17. Source repository actually available on this workstation:
G:\Projects\Customer_Renewal_CP_Codex_Pack_NODEJS.
The supplied G:\Other computers\... path was absent. Existing valid local work was preserved.
Base history: c1487949cab96133540d3d3fa71c17626e1454da (foundation), fe2f2176fbf9be39611ab96d255867d455af4597 (references).

## Final verification

All dependency-backed work ran in C:\sgv\phase4b_verify. No installation was run in the source
repository. Source/verification code comparison reported no differences after normalizing line endings.
Runtime: Node v26.13.0, npm 11.1.0. No production database or owner credentials were used.

- Prisma validation: PASS.
- Prisma generation: PASS.
- Workspace strict typecheck: PASS.
- Workspace lint: PASS, zero lint errors/warnings.
- Full regression: 1,181 passed, 120 skipped; 128 passed suites, 11 skipped suites; 1,301 total tests.
- Skipped tests are existing separately gated live-integration suites. They are not claimed as executed.
- Focused invoice coverage: 81 passing tests across 11 suites (included in full regression).
- New populated MariaDB phase-4 coverage: 4 passing tests (also included in full regression).
- Production builds: Nest API, Next web and shared workspace all PASS.
- Final CSS spacing correction was verified with a fresh Next production build and compiled-CSS browser/PDF checks.
- Git diff whitespace check: PASS.

The full regression preserves Phase 4A coverage and covers cancellation/reason/duplicate release,
provenance, manual graphical QR, exact mismatch/reconciliation/audit, independent device/default
selection, secret encryption/masking and non-exposure, issuer isolation, disabled/production-off/RBAC/
human-only gates, snapshot stability, mapper golden XML/base64/escaping, documented request headers,
HTTP-success rejection, acceptance/duplicate statuses, malformed/timeout/network safety, diagnostic
redaction, exact attempt identity, controlled uncertain recovery and official signed-value differences.
All JoFotara HTTP/gateway calls in tests were mocked. No real JoFotara request occurred.

## Disposable MariaDB

A temporary standalone MariaDB 11.4.7 instance ran only on 127.0.0.1:33317, with data under C:\sgv.
No system database service was installed. The vendor ZIP checksum matched the official SHA-256 list.

1. The populated upgrade test applies the original migration history, creates a synthetic accepted
   invoice, then applies the two new migrations. It proves UUID/counter/provenance backfills and
   discrepancy blocking preserve existing money; multiple devices/default CHECK/production-OFF;
   submission/invoice/device retention; cancelled-draft guard release; integer revision CAS behavior.
2. Prisma migrate deploy successfully applied all 15 migrations to a fresh phase4b_deploy_test DB.
3. Final database/schema comparison shows no invoice/JoFotara drift. Five unrelated older tables
   have pre-existing updated_at SQL-default differences (currencies, customer_code_sequences,
   customer_email_addresses, customer_phone_numbers, subscription_code_sequences). No unrelated
   migration was created to alter those defaults.

A real MariaDB compatibility failure was found and fixed before commit: the active-default CHECK
cannot reference an issuer FK that uses ON UPDATE CASCADE. That immutable issuer FK now uses
ON UPDATE RESTRICT in both schema and migration. No duplicate migration was introduced.

## Visual and print checks

All four supplied HTML/PDF references were inspected before renderer changes. Browser checks use
synthetic persisted-view fixtures and actual compiled Next CSS, not production invoice/customer data.
Chrome successfully loaded the reference-derived NUSRV logo and authoritative-payload fixture QR.
English/Arabic header, invoice identity, buyer, six-column table, totals and bank/footer were inspected.
Accepted and draft examples each export to one A4 page; the draft contains no official QR.
A 30-line example exports across five A4 pages without fixed-height clipping. Actual first-commercial-
invoice visual approval remains the owner's post-deployment step. QA HTML/PNG/PDF files and tools
remain outside the repository in C:\sgv and are not committed.

## Scope and remaining operator work

Implementation supports the documented income/general local/export cash/receivable profiles.
Special tax, other profiles, returns/credit notes, payment receipts/collection and Mail/AI invoice
integration remain deferred. Future receipt must omit the supplied source's stamp/seal.
Returned XML is parsed as official evidence over the authenticated HTTPS response; independent
cryptographic signature validation is not implemented. If signed totals are absent they are not
invented. Reconciled discrepancies remain explicitly disclosed on the final customer document.
Existing project dependency advisories were not addressed by unrelated upgrades/audit fixes.

Production prerequisites and the exact first-real-commercial-invoice procedure are in
PHASES/PHASE_04_FAWTARA.md. Credentials must be entered only through the encrypted ADMIN UI after
deployment; saving credentials sends nothing. Production submission is separately OFF by default.
The owner must perform deployment review, backup/migrations, issuer/device/tax review, permission
enablement and the first legitimate commercial submission. No dummy invoice may test credentials.

No push. No deployment. No real JoFotara submission. No Payment Receipt implementation.
