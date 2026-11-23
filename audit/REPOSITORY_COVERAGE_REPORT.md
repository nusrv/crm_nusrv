# Repository coverage verification

## Direct answer

**The original Phase 1 investigation inspected selected files. It did not read every relevant directory and source file.** It enumerated the repository, then read files or excerpts that supported a risk-focused assessment. Finding a path, hashing a file, reading a generated summary, or seeing a test name did not establish full content review. The original assessment is usable for the specific evidence-backed findings. It is not an exhaustive code, security, migration, test, or product audit.

The follow-up adds targeted content review, a reproducible file inventory, and the corrections below. No application files or prior reports were edited.

## Scope and counting rules

- Snapshot is the Windows working tree on `main` at `32013c24488b6ea68c7e886a779f0801727aae54`. Use `git ls-files -z --cached` and `git ls-files -z --others --exclude-standard`, union and deduplicate repository-relative paths. Count current working-tree paths, not duplicate copies of a file as it exists in HEAD, the index and the working tree. The inventory excludes this new report itself. Six earlier audit documents existed on entry and are individually listed as audit outputs.
- The first status column reconstructs original audit evidence conservatively. The second includes follow-up evidence. Earlier implementation-session reads, including PDF renderings and earlier versions of edited files, are not credited to the audit. If a truncated tool response does not display a whole file, it cannot qualify as full. When no visible original inspection can be tied to a file, classify it as discovered only. Classification records a defensible minimum from the retained evidence.
- **F** means the complete contents were available in a non-truncated inspection and considered. It does not mean the reader proved correctness of all branches or ran a test. **P** means only excerpts, selected fields, SQL statement samples, test names, or targeted parsed content were reviewed. **D** means enumerated without proven content inspection. **X** means intentionally excluded from this audit. **I** means a known inventory path was missing or inaccessible. A successful filesystem open without a content read was used only to distinguish accessibility from evidence of review.
- Git-reported ignored paths are checked separately. No ignored paths were returned. The inventory does not walk `.git` internals, external verification directories, generated output, dependency trees, credentials, local databases, or live services. An absent or out-of-scope system is not a file-access failure. The previous PDFs and the priority NUSRV reference were rendered in the earlier implementation session. They remain excluded from this audit's content counts, and the original visual work does not establish current PDF acceptance.
- Type is the extension or a descriptive suffix, with TS and TSX test files broken out from other TS/TSX. The full inventory groups every path by its immediate directory and records its type. Rollups show both snapshots. There are no tracked symlinks or submodules to expand.

## Follow-up to the initial findings

1. **A-01 and A-10 strengthened — confirmed source/test incompatibilities in the working tree.** At `apps/api/src/modules/renewal-cases/renewal-transition-policy.ts:26–27`, fulfillment now allows `ACCEPTED`, `INVOICE_DRAFT` and `COLLECTING`. The existing `renewal-transition-policy.spec.ts:31–51` expects those transitions to be rejected. `apps/api/src/identity/auth.service.spec.ts:346–365` builds the nominal refresh test session without `createdAt`, while `auth.service.ts:151` dereferences it. `apps/api/src/modules/mail/mail-outbound.service.spec.ts:25–49,361–379` builds a customer row without `manualApprovedBy` and tests deferral for a hold. `mail-outbound.service.ts:365–366` now cancels that unapproved row before it can reach the hold branch. These mismatches are visible directly without running Jest. Update fixtures to cover both sides of the new gates and preserve intentional baseline tests as historical evidence or revise them against the changed requirement. Do not cite historical green runs for this tree.
2. **A-10 clarified — the database test command has a narrower scope than the full regression.** The complete `apps/api/scripts/run-mariadb-integration.mjs` runner enumerates ten live suites. Its list omits Slice G, Phase 4, and branding. The omitted suites exist, and Phase 4 and branding use distinct opt-in environment variables. The root Jest invocation can discover additional files when the relevant gates are configured. Release acceptance needs explicit suite selection and outcomes. No test or migration was executed in this follow-up.
3. **A-06 and A-07 clarified.** A completed read of `manual-renewal.service.ts:36–49` confirms that the case preview and current recipient check run before the existing request can be found. Once the renewal moves out of the permitted reminder states or loses its recipient, retrying an already accepted logical command can fail before the idempotency lookup. This is a separate, static replay limitation from the untested concurrent unique-key race in A-07. Test same-payload replay after later state changes, and enforce case and actor scope before returning a prior result.
4. **A-02 through A-05 remain supported.** The QR helper and JWT/role strategy were reviewed end to end. The previous in-memory QR result remains the only executed defect demonstration. Worker entry-point review confirms scheduled work delegates to the same outbound batch method used in A-03. Tax field binding evidence remains at the JSX assignment, independent of visual acceptance. No production outcome or exploit was verified.
5. **A-10's readiness claim stays limited.** Complete reads of the worker startup and API health service show that API readiness queries MariaDB and pings Redis. It does not demonstrate active worker consumption. Staging service units, reverse proxy configuration, worker alarms, and restoration need separate confirmation.

## Gap decisions

Every F/P/D/X/I row below includes a review disposition. **R1** means further inspection is required before release sign-off of the current operational scope. **R2** means further inspection is required before certifying that subsystem or claiming a comprehensive repository audit, but did not block the presently bounded findings. **DONE** means no additional source read is needed merely to substantiate the finding under discussion. **EX** is an intentional audit exclusion. **ACCESS** would require resolving a missing or inaccessible inventory item.

| Gap | Required follow-up and effect on reliability |
| --- | --- |
| Prisma schema, migration chain, seed and live fixtures | Review every remaining statement and affected relation. Match schema changes and runtime writes to DDL, verify existing invoices and messages survive, and check indexes and seed idempotency. The follow-up sampled at least one DDL or DML statement in all 16 migrations and read two small Phase 4 migrations end to end. This supports inventory coverage and the missing-current-migration claim. It does not establish migration correctness. |
| Auth, API boot, roles, config, security and audit | Inspect remaining public routes, guards, decorators, cookie consumers, identity administration and tests. Compare all environment examples and deployment units. This is required before a security or release sign-off. It does not invalidate the stateless JWT finding. Test browser refresh/logout and access lifetime boundaries with fakes. |
| Mail, communications, renewals and worker | Read remaining transport, correlation, eligibility, sender matching and boot wiring. Follow historical jobs across a mixed-version rollout. Add fixture coverage for queued, accepted, escalated, deferred, and ambiguous outcomes. This is required to establish that the requested manual workflow works across entry points. |
| Finance, issuer branding, payments and receipts | Read remaining decimal validation, ownership, state transitions, immutable snapshots, official record handling, and UI gates. Check adapter tests without network and execute disposable upgrade and concurrency evidence separately. Review HTML/PDF references and print fixtures under approved synthetic conditions. Financial findings do not constitute invoice, payment or receipt sign-off. |
| Customers, subscriptions, contact channels and legacy import | Review deletion and code sequence integrity, create/edit validation, canonical channels, staged approval, importer isolation and regression cases. Read remaining workbook code using synthetic data. This matters before claiming data-retention or import correctness. Future review of `SOURCE/must answer2.txt` can resolve historical requirements ambiguities. It is not runtime source. |
| Web and shared contracts | Read remaining pages, hooks, nested dialogs, route gates and shared models as part of feature review. Test focus, history, role visibility and real print markup in a browser. Sampled modal code is sufficient to reject a universal modal-compliance claim, not to certify other pages. |
| Tests, scripts, non-runtime documentation | Review implementations and actual assertions, not names alone. Inspect tooling before running it. Deployment scripts and historical planning docs may be stale relative to the frozen scope. Preserve running procedures and boundaries while checking for contradictions. Stale procedure concerns are not a verified deployment failure. |
| Assets and external evidence | Binary assets do not affect the demonstrated source binding or synthetic QR result. They are required for print acceptance, which remains a separate check. Real workbook, production and ignored-data inspection are outside this audit. Use synthetic fixtures and redacted deployment evidence under separate authorization. |

## Inventory and cross-check

The following rollups and file list are generated from the same Git inventory. Counts are mutually exclusive in each snapshot.

Snapshot contains **551 files** (538 tracked and 13 non-ignored untracked). The six earlier audit reports contribute to X. Known inaccessible inventory paths: **0**.

### Repository totals

| Scope | Files | Original F / P / D / X / I | Cumulative F / P / D / X / I |
| --- | ---: | --- | --- |
| All inventoried paths | 551 | 15 / 66 / 457 / 13 / 0 | 42 / 88 / 408 / 13 / 0 |

### Directory rollup

| Directory | Files | Original F / P / D / X / I | Cumulative F / P / D / X / I |
| --- | ---: | --- | --- |
| (root) | 22 | 3 / 4 / 15 / 0 / 0 | 4 / 7 / 11 / 0 / 0 |
| PHASES | 13 | 0 / 0 / 13 / 0 / 0 | 0 / 0 / 13 / 0 / 0 |
| SOURCE | 2 | 0 / 0 / 1 / 1 / 0 | 1 / 0 / 0 / 1 / 0 |
| apps/api | 408 | 11 / 39 / 358 / 0 / 0 | 34 / 60 / 314 / 0 / 0 |
| apps/web | 73 | 1 / 19 / 51 / 2 / 0 | 3 / 17 / 51 / 2 / 0 |
| audit | 6 | 0 / 0 / 0 / 6 / 0 | 0 / 0 / 0 / 6 / 0 |
| deploy | 5 | 0 / 0 / 5 / 0 / 0 | 0 / 0 / 5 / 0 / 0 |
| docs | 18 | 0 / 4 / 10 / 4 / 0 | 0 / 4 / 10 / 4 / 0 |
| packages | 4 | 0 / 0 / 4 / 0 / 0 | 0 / 0 / 4 / 0 / 0 |

### File type rollup

| File type | Files | Original F / P / D / X / I | Cumulative F / P / D / X / I |
| --- | ---: | --- | --- |
| .cjs | 1 | 1 / 0 / 0 / 0 / 0 | 1 / 0 / 0 / 0 / 0 |
| .css | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| .html | 2 | 0 / 0 / 2 / 0 / 0 | 0 / 0 / 2 / 0 / 0 |
| .js | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 1 / 0 / 0 / 0 |
| .json | 13 | 3 / 1 / 9 / 0 / 0 | 3 / 1 / 9 / 0 / 0 |
| .md | 44 | 0 / 6 / 32 / 6 / 0 | 1 / 8 / 29 / 6 / 0 |
| .mjs | 5 | 0 / 0 / 5 / 0 / 0 | 1 / 0 / 4 / 0 / 0 |
| .pdf | 3 | 0 / 0 / 0 / 3 / 0 | 0 / 0 / 0 / 3 / 0 |
| .png | 3 | 0 / 0 / 0 / 3 / 0 | 0 / 0 / 0 / 3 / 0 |
| .prisma | 1 | 0 / 1 / 0 / 0 / 0 | 0 / 1 / 0 / 0 / 0 |
| .sh | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| .sql | 16 | 0 / 2 / 14 / 0 / 0 | 2 / 14 / 0 / 0 / 0 |
| .toml | 1 | 0 / 0 / 1 / 0 / 0 | 1 / 0 / 0 / 0 / 0 |
| .ts | 248 | 9 / 37 / 202 / 0 / 0 | 28 / 38 / 182 / 0 / 0 |
| .tsx | 55 | 0 / 17 / 38 / 0 / 0 | 1 / 16 / 38 / 0 / 0 |
| .txt | 1 | 0 / 0 / 0 / 1 / 0 | 0 / 0 / 0 / 1 / 0 |
| .xml | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| .yaml | 1 | 1 / 0 / 0 / 0 / 0 | 1 / 0 / 0 / 0 / 0 |
| TS test | 142 | 0 / 1 / 141 / 0 / 0 | 1 / 8 / 133 / 0 / 0 |
| TSX test | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| env example | 4 | 0 / 1 / 3 / 0 / 0 | 0 / 1 / 3 / 0 / 0 |
| ignore | 2 | 0 / 0 / 2 / 0 / 0 | 1 / 0 / 1 / 0 / 0 |
| runtime pin | 1 | 1 / 0 / 0 / 0 / 0 | 1 / 0 / 0 / 0 / 0 |
| systemd example | 3 | 0 / 0 / 3 / 0 / 0 | 0 / 0 / 3 / 0 / 0 |

### Directory and file type

| Immediate directory and type | Files | Original F / P / D / X / I | Cumulative F / P / D / X / I |
| --- | ---: | --- | --- |
| `.` / .js | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 1 / 0 / 0 / 0 |
| `.` / .json | 4 | 1 / 1 / 2 / 0 / 0 | 1 / 1 / 2 / 0 / 0 |
| `.` / .md | 12 | 0 / 2 / 10 / 0 / 0 | 0 / 4 / 8 / 0 / 0 |
| `.` / .yaml | 1 | 1 / 0 / 0 / 0 / 0 | 1 / 0 / 0 / 0 / 0 |
| `.` / env example | 1 | 0 / 1 / 0 / 0 / 0 | 0 / 1 / 0 / 0 / 0 |
| `.` / ignore | 2 | 0 / 0 / 2 / 0 / 0 | 1 / 0 / 1 / 0 / 0 |
| `.` / runtime pin | 1 | 1 / 0 / 0 / 0 / 0 | 1 / 0 / 0 / 0 / 0 |
| `PHASES` / .md | 13 | 0 / 0 / 13 / 0 / 0 | 0 / 0 / 13 / 0 / 0 |
| `SOURCE` / .md | 1 | 0 / 0 / 1 / 0 / 0 | 1 / 0 / 0 / 0 / 0 |
| `SOURCE` / .txt | 1 | 0 / 0 / 0 / 1 / 0 | 0 / 0 / 0 / 1 / 0 |
| `apps/api` / .cjs | 1 | 1 / 0 / 0 / 0 / 0 | 1 / 0 / 0 / 0 / 0 |
| `apps/api` / .json | 4 | 1 / 0 / 3 / 0 / 0 | 1 / 0 / 3 / 0 / 0 |
| `apps/api` / .mjs | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `apps/api` / .ts | 1 | 0 / 0 / 1 / 0 / 0 | 1 / 0 / 0 / 0 / 0 |
| `apps/api` / env example | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `apps/api/prisma` / .prisma | 1 | 0 / 1 / 0 / 0 / 0 | 0 / 1 / 0 / 0 / 0 |
| `apps/api/prisma` / .ts | 4 | 0 / 0 / 4 / 0 / 0 | 0 / 0 / 4 / 0 / 0 |
| `apps/api/prisma` / TS test | 20 | 0 / 0 / 20 / 0 / 0 | 0 / 3 / 17 / 0 / 0 |
| `apps/api/prisma/migrations` / .toml | 1 | 0 / 0 / 1 / 0 / 0 | 1 / 0 / 0 / 0 / 0 |
| `apps/api/prisma/migrations/20260823000000_mariadb_phase_0_1_foundation` / .sql | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 1 / 0 / 0 / 0 |
| `apps/api/prisma/migrations/20260824000000_phase_2_renewal_engine` / .sql | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 1 / 0 / 0 / 0 |
| `apps/api/prisma/migrations/20260827000000_phase_2_1_operational_data` / .sql | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 1 / 0 / 0 / 0 |
| `apps/api/prisma/migrations/20260827010000_scope_legacy_import_active_sheet` / .sql | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 1 / 0 / 0 / 0 |
| `apps/api/prisma/migrations/20260831000000_currency_and_contact_channels` / .sql | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 1 / 0 / 0 / 0 |
| `apps/api/prisma/migrations/20260906000000_canonical_phone_contact_and_source_order` / .sql | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 1 / 0 / 0 / 0 |
| `apps/api/prisma/migrations/20260908000000_customer_code_sequences_and_bilingual_names` / .sql | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 1 / 0 / 0 / 0 |
| `apps/api/prisma/migrations/20260909000000_subscription_code_sequences_and_backfill` / .sql | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 1 / 0 / 0 / 0 |
| `apps/api/prisma/migrations/20260910000000_phase3_slice_a_communication_domain` / .sql | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 1 / 0 / 0 / 0 |
| `apps/api/prisma/migrations/20260917000000_phase3_slice_e_operator_reply_outbox` / .sql | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 1 / 0 / 0 / 0 |
| `apps/api/prisma/migrations/20260921000000_phase3_slice_g_ai_routing_decision` / .sql | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 1 / 0 / 0 / 0 |
| `apps/api/prisma/migrations/20260923000000_phase3_1_admin_settings` / .sql | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 1 / 0 / 0 / 0 |
| `apps/api/prisma/migrations/20261117000000_phase4a_manual_invoice_foundation` / .sql | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 1 / 0 / 0 / 0 |
| `apps/api/prisma/migrations/20261118000000_phase4a_invoice_hardening` / .sql | 1 | 0 / 0 / 1 / 0 / 0 | 1 / 0 / 0 / 0 / 0 |
| `apps/api/prisma/migrations/20261118010000_phase4b_jofotara_connections_submissions` / .sql | 1 | 0 / 1 / 0 / 0 / 0 | 0 / 1 / 0 / 0 / 0 |
| `apps/api/prisma/migrations/20261118020000_multi_issuer_invoice_branding` / .sql | 1 | 0 / 1 / 0 / 0 / 0 | 1 / 0 / 0 / 0 / 0 |
| `apps/api/scripts` / .mjs | 1 | 0 / 0 / 1 / 0 / 0 | 1 / 0 / 0 / 0 / 0 |
| `apps/api/scripts` / .ts | 3 | 0 / 0 / 3 / 0 / 0 | 0 / 1 / 2 / 0 / 0 |
| `apps/api/scripts` / TS test | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `apps/api/src` / .ts | 5 | 1 / 2 / 2 / 0 / 0 | 2 / 2 / 1 / 0 / 0 |
| `apps/api/src/audit` / .ts | 3 | 0 / 1 / 2 / 0 / 0 | 1 / 0 / 2 / 0 / 0 |
| `apps/api/src/audit` / TS test | 1 | 0 / 1 / 0 / 0 / 0 | 0 / 1 / 0 / 0 / 0 |
| `apps/api/src/common` / .ts | 3 | 1 / 0 / 2 / 0 / 0 | 1 / 0 / 2 / 0 / 0 |
| `apps/api/src/common` / TS test | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `apps/api/src/config` / .ts | 1 | 0 / 1 / 0 / 0 / 0 | 0 / 1 / 0 / 0 / 0 |
| `apps/api/src/config` / TS test | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `apps/api/src/database` / .ts | 3 | 0 / 0 / 3 / 0 / 0 | 0 / 0 / 3 / 0 / 0 |
| `apps/api/src/database` / TS test | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `apps/api/src/health` / .ts | 3 | 1 / 1 / 1 / 0 / 0 | 2 / 0 / 1 / 0 / 0 |
| `apps/api/src/health` / TS test | 2 | 0 / 0 / 2 / 0 / 0 | 0 / 0 / 2 / 0 / 0 |
| `apps/api/src/identity` / .ts | 13 | 4 / 2 / 7 / 0 / 0 | 6 / 0 / 7 / 0 / 0 |
| `apps/api/src/identity` / TS test | 4 | 0 / 0 / 4 / 0 / 0 | 0 / 1 / 3 / 0 / 0 |
| `apps/api/src/modules` / TS test | 3 | 0 / 0 / 3 / 0 / 0 | 0 / 0 / 3 / 0 / 0 |
| `apps/api/src/modules/ai` / .ts | 42 | 0 / 6 / 36 / 0 / 0 | 0 / 6 / 36 / 0 / 0 |
| `apps/api/src/modules/ai` / TS test | 25 | 0 / 0 / 25 / 0 / 0 | 0 / 0 / 25 / 0 / 0 |
| `apps/api/src/modules/billing-entities` / .ts | 4 | 0 / 0 / 4 / 0 / 0 | 0 / 0 / 4 / 0 / 0 |
| `apps/api/src/modules/communications` / .ts | 13 | 0 / 2 / 11 / 0 / 0 | 0 / 2 / 11 / 0 / 0 |
| `apps/api/src/modules/communications` / TS test | 9 | 0 / 0 / 9 / 0 / 0 | 0 / 0 / 9 / 0 / 0 |
| `apps/api/src/modules/currencies` / .ts | 4 | 0 / 0 / 4 / 0 / 0 | 0 / 0 / 4 / 0 / 0 |
| `apps/api/src/modules/currencies` / TS test | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `apps/api/src/modules/customers` / .ts | 9 | 0 / 0 / 9 / 0 / 0 | 1 / 2 / 6 / 0 / 0 |
| `apps/api/src/modules/customers` / TS test | 6 | 0 / 0 / 6 / 0 / 0 | 0 / 0 / 6 / 0 / 0 |
| `apps/api/src/modules/dashboard` / .ts | 3 | 0 / 0 / 3 / 0 / 0 | 0 / 0 / 3 / 0 / 0 |
| `apps/api/src/modules/invoice-branding` / .ts | 4 | 0 / 1 / 3 / 0 / 0 | 0 / 1 / 3 / 0 / 0 |
| `apps/api/src/modules/invoice-branding` / TS test | 2 | 0 / 0 / 2 / 0 / 0 | 0 / 0 / 2 / 0 / 0 |
| `apps/api/src/modules/invoices` / .ts | 20 | 1 / 5 / 14 / 0 / 0 | 5 / 4 / 11 / 0 / 0 |
| `apps/api/src/modules/invoices` / TS test | 11 | 0 / 0 / 11 / 0 / 0 | 0 / 1 / 10 / 0 / 0 |
| `apps/api/src/modules/invoices/fixtures` / .xml | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `apps/api/src/modules/legacy-import` / .ts | 8 | 0 / 1 / 7 / 0 / 0 | 0 / 2 / 6 / 0 / 0 |
| `apps/api/src/modules/legacy-import` / TS test | 7 | 0 / 0 / 7 / 0 / 0 | 0 / 0 / 7 / 0 / 0 |
| `apps/api/src/modules/mail` / .ts | 44 | 0 / 7 / 37 / 0 / 0 | 1 / 10 / 33 / 0 / 0 |
| `apps/api/src/modules/mail` / TS test | 24 | 0 / 0 / 24 / 0 / 0 | 0 / 1 / 23 / 0 / 0 |
| `apps/api/src/modules/renewal-cases` / .ts | 18 | 0 / 5 / 13 / 0 / 0 | 5 / 5 / 8 / 0 / 0 |
| `apps/api/src/modules/renewal-cases` / TS test | 13 | 0 / 0 / 13 / 0 / 0 | 1 / 1 / 11 / 0 / 0 |
| `apps/api/src/modules/service-packages` / .ts | 4 | 0 / 0 / 4 / 0 / 0 | 0 / 0 / 4 / 0 / 0 |
| `apps/api/src/modules/service-packages` / TS test | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `apps/api/src/modules/service-types` / .ts | 4 | 0 / 0 / 4 / 0 / 0 | 0 / 0 / 4 / 0 / 0 |
| `apps/api/src/modules/service-types` / TS test | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `apps/api/src/modules/subscription-connections` / .ts | 4 | 0 / 0 / 4 / 0 / 0 | 0 / 0 / 4 / 0 / 0 |
| `apps/api/src/modules/subscriptions` / .ts | 5 | 0 / 0 / 5 / 0 / 0 | 0 / 1 / 4 / 0 / 0 |
| `apps/api/src/modules/subscriptions` / TS test | 4 | 0 / 0 / 4 / 0 / 0 | 0 / 0 / 4 / 0 / 0 |
| `apps/api/src/modules/technical-connections` / .ts | 4 | 1 / 0 / 3 / 0 / 0 | 1 / 0 / 3 / 0 / 0 |
| `apps/api/src/modules/technical-connections` / TS test | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `apps/api/src/queue` / .ts | 3 | 0 / 0 / 3 / 0 / 0 | 0 / 0 / 3 / 0 / 0 |
| `apps/api/src/queue` / TS test | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `apps/api/src/security` / .ts | 3 | 0 / 1 / 2 / 0 / 0 | 1 / 0 / 2 / 0 / 0 |
| `apps/api/src/security` / TS test | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `apps/api/src/time` / .ts | 3 | 0 / 0 / 3 / 0 / 0 | 0 / 0 / 3 / 0 / 0 |
| `apps/api/src/time` / TS test | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `apps/api/test/helpers` / .ts | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `apps/web` / .json | 3 | 1 / 0 / 2 / 0 / 0 | 1 / 0 / 2 / 0 / 0 |
| `apps/web` / .mjs | 2 | 0 / 0 / 2 / 0 / 0 | 0 / 0 / 2 / 0 / 0 |
| `apps/web` / .ts | 3 | 0 / 0 / 3 / 0 / 0 | 0 / 0 / 3 / 0 / 0 |
| `apps/web` / env example | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `apps/web/app` / .css | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `apps/web/app` / .tsx | 2 | 0 / 0 / 2 / 0 / 0 | 0 / 0 / 2 / 0 / 0 |
| `apps/web/app/dashboard` / .tsx | 2 | 0 / 0 / 2 / 0 / 0 | 0 / 0 / 2 / 0 / 0 |
| `apps/web/app/dashboard/access` / .tsx | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `apps/web/app/dashboard/billing-entities` / .tsx | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `apps/web/app/dashboard/communications` / .tsx | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `apps/web/app/dashboard/communications/[threadId]` / .tsx | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `apps/web/app/dashboard/currencies` / .tsx | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `apps/web/app/dashboard/customers` / .tsx | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `apps/web/app/dashboard/customers/[id]` / .tsx | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `apps/web/app/dashboard/invoices` / .tsx | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `apps/web/app/dashboard/invoices/[id]` / .tsx | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `apps/web/app/dashboard/legacy-import` / .tsx | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `apps/web/app/dashboard/packages` / .tsx | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `apps/web/app/dashboard/renewal-settings` / .tsx | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `apps/web/app/dashboard/renewals` / .tsx | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `apps/web/app/dashboard/service-types` / .tsx | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `apps/web/app/dashboard/settings` / .tsx | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `apps/web/app/dashboard/subscriptions` / .tsx | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `apps/web/app/dashboard/technical-connections` / .tsx | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `apps/web/app/login` / .tsx | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `apps/web/components` / .ts | 2 | 0 / 1 / 1 / 0 / 0 | 0 / 1 / 1 / 0 / 0 |
| `apps/web/components` / .tsx | 33 | 0 / 17 / 16 / 0 / 0 | 1 / 16 / 16 / 0 / 0 |
| `apps/web/lib` / .ts | 3 | 0 / 1 / 2 / 0 / 0 | 1 / 0 / 2 / 0 / 0 |
| `apps/web/public` / .png | 1 | 0 / 0 / 0 / 1 / 0 | 0 / 0 / 0 / 1 / 0 |
| `apps/web/public/invoice-branding-presets` / .png | 1 | 0 / 0 / 0 / 1 / 0 | 0 / 0 / 0 / 1 / 0 |
| `apps/web/tests` / TSX test | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `audit` / .md | 6 | 0 / 0 / 0 / 6 / 0 | 0 / 0 / 0 / 6 / 0 |
| `deploy/staging` / .sh | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `deploy/staging` / env example | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `deploy/staging/systemd` / systemd example | 3 | 0 / 0 / 3 / 0 / 0 | 0 / 0 / 3 / 0 / 0 |
| `docs` / .md | 3 | 0 / 3 / 0 / 0 / 0 | 0 / 3 / 0 / 0 / 0 |
| `docs/deployment` / .md | 1 | 0 / 1 / 0 / 0 / 0 | 0 / 1 / 0 / 0 / 0 |
| `docs/operations` / .md | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `docs/technical` / .md | 7 | 0 / 0 / 7 / 0 / 0 | 0 / 0 / 7 / 0 / 0 |
| `docs/templates` / .html | 2 | 0 / 0 / 2 / 0 / 0 | 0 / 0 / 2 / 0 / 0 |
| `docs/templates` / .pdf | 3 | 0 / 0 / 0 / 3 / 0 | 0 / 0 / 0 / 3 / 0 |
| `docs/templates/assets` / .png | 1 | 0 / 0 / 0 / 1 / 0 | 0 / 0 / 0 / 1 / 0 |
| `packages/shared` / .json | 2 | 0 / 0 / 2 / 0 / 0 | 0 / 0 / 2 / 0 / 0 |
| `packages/shared` / .mjs | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |
| `packages/shared/src` / .ts | 1 | 0 / 0 / 1 / 0 / 0 | 0 / 0 / 1 / 0 / 0 |

### Complete per-file inventory

Each filename is relative to its directory. Columns are filename, type, original status, cumulative status, review decision and evidence. R1 and R2 inherit the review steps for their domain from the gap table above.

#### `.`

```text
.env.example | env example | P | P | R1 | Targeted original excerpts or selected parsed content
.gitignore | ignore | D | F | DONE | Complete file read in follow-up
.nvmrc | runtime pin | F | F | DONE | Complete file read in original audit
.prettierignore | ignore | D | D | R2 | Inventory only
.prettierrc.json | .json | D | D | R1 | Inventory only
00_README_FIRST.md | .md | D | D | R2 | Inventory only
01_MASTER_PLAN.md | .md | D | P | R1 | Targeted excerpts in follow-up
02_ARCHITECTURE_AND_DATA_MODEL.md | .md | D | D | R2 | Inventory only
03_WORKFLOWS_AND_STATE_MACHINE.md | .md | D | P | R1 | Targeted excerpts in follow-up
04_INTEGRATIONS.md | .md | D | D | R2 | Inventory only
05_AI_LLM_MCP_STRATEGY.md | .md | D | D | R2 | Inventory only
06_SECURITY_RBAC_AUDIT.md | .md | D | D | R1 | Inventory only
07_ACCEPTANCE_AND_TESTING.md | .md | D | D | R2 | Inventory only
AGENTS.md | .md | P | P | R1 | Targeted original excerpts or selected parsed content
app.js | .js | D | P | R1 | Targeted excerpts in follow-up
compose.yaml | .yaml | F | F | DONE | Complete file read in original audit
package-lock.json | .json | P | P | R1 | Targeted original excerpts or selected parsed content
package.json | .json | F | F | DONE | Complete file read in original audit
PROJECT_STATUS.md | .md | P | P | R1 | Targeted original excerpts or selected parsed content
SESSION_HANDOFF_2026-08-29.md | .md | D | D | R2 | Inventory only
STACK_CHANGE_NODEJS.md | .md | D | D | R2 | Inventory only
tsconfig.base.json | .json | D | D | R1 | Inventory only
```

#### `apps/api`

```text
.env.example | env example | D | D | R1 | Inventory only
eslint.config.mjs | .mjs | D | D | R1 | Inventory only
jest.config.cjs | .cjs | F | F | DONE | Complete file read in original audit
nest-cli.json | .json | D | D | R1 | Inventory only
package.json | .json | F | F | DONE | Complete file read in original audit
prisma.config.ts | .ts | D | F | DONE | Complete file read in follow-up
tsconfig.build.json | .json | D | D | R1 | Inventory only
tsconfig.json | .json | D | D | R1 | Inventory only
```

#### `apps/api/prisma`

```text
legacy-import-scope-migration.spec.ts | TS test | D | D | R1 | Inventory only
mariadb-branding-live.spec.ts | TS test | D | P | R1 | Targeted excerpts in follow-up
mariadb-live.spec.ts | TS test | D | D | R1 | Inventory only
mariadb-migration-contract.spec.ts | TS test | D | D | R1 | Inventory only
mariadb-phase2-live.spec.ts | TS test | D | D | R1 | Inventory only
mariadb-phase21-live.spec.ts | TS test | D | D | R1 | Inventory only
mariadb-phase3-slice-a-live.spec.ts | TS test | D | D | R1 | Inventory only
mariadb-phase3-slice-b-live.spec.ts | TS test | D | D | R1 | Inventory only
mariadb-phase3-slice-c-live.spec.ts | TS test | D | D | R1 | Inventory only
mariadb-phase3-slice-d-live.spec.ts | TS test | D | D | R1 | Inventory only
mariadb-phase3-slice-e-live.spec.ts | TS test | D | D | R1 | Inventory only
mariadb-phase3-slice-g-live.spec.ts | TS test | D | P | R1 | Targeted excerpts in follow-up
mariadb-phase4-live.spec.ts | TS test | D | P | R1 | Targeted excerpts in follow-up
mariadb-subscription-code-backfill-live.spec.ts | TS test | D | D | R1 | Inventory only
mariadb-subscription-code-sequence-delete-live.spec.ts | TS test | D | D | R1 | Inventory only
package-catalog.seed-data.spec.ts | TS test | D | D | R1 | Inventory only
package-catalog.seed-data.ts | .ts | D | D | R1 | Inventory only
phase2-migration-contract.spec.ts | TS test | D | D | R1 | Inventory only
phase21-migration-contract.spec.ts | TS test | D | D | R1 | Inventory only
phase3-slice-a-migration-contract.spec.ts | TS test | D | D | R1 | Inventory only
read-all-migrations.ts | .ts | D | D | R1 | Inventory only
schema.prisma | .prisma | P | P | R1 | Targeted original excerpts or selected parsed content
seed-data.spec.ts | TS test | D | D | R1 | Inventory only
seed-data.ts | .ts | D | D | R1 | Inventory only
seed.ts | .ts | D | D | R1 | Inventory only
```

#### `apps/api/prisma/migrations`

```text
migration_lock.toml | .toml | D | F | DONE | Complete file read in follow-up
```

#### `apps/api/prisma/migrations/20260823000000_mariadb_phase_0_1_foundation`

```text
migration.sql | .sql | D | P | R1 | DDL/DML screen or targeted constraint excerpts in follow-up
```

#### `apps/api/prisma/migrations/20260824000000_phase_2_renewal_engine`

```text
migration.sql | .sql | D | P | R1 | DDL/DML screen or targeted constraint excerpts in follow-up
```

#### `apps/api/prisma/migrations/20260827000000_phase_2_1_operational_data`

```text
migration.sql | .sql | D | P | R1 | DDL/DML screen or targeted constraint excerpts in follow-up
```

#### `apps/api/prisma/migrations/20260827010000_scope_legacy_import_active_sheet`

```text
migration.sql | .sql | D | P | R1 | DDL/DML screen or targeted constraint excerpts in follow-up
```

#### `apps/api/prisma/migrations/20260831000000_currency_and_contact_channels`

```text
migration.sql | .sql | D | P | R1 | DDL/DML screen or targeted constraint excerpts in follow-up
```

#### `apps/api/prisma/migrations/20260906000000_canonical_phone_contact_and_source_order`

```text
migration.sql | .sql | D | P | R1 | DDL/DML screen or targeted constraint excerpts in follow-up
```

#### `apps/api/prisma/migrations/20260908000000_customer_code_sequences_and_bilingual_names`

```text
migration.sql | .sql | D | P | R1 | DDL/DML screen or targeted constraint excerpts in follow-up
```

#### `apps/api/prisma/migrations/20260909000000_subscription_code_sequences_and_backfill`

```text
migration.sql | .sql | D | P | R1 | DDL/DML screen or targeted constraint excerpts in follow-up
```

#### `apps/api/prisma/migrations/20260910000000_phase3_slice_a_communication_domain`

```text
migration.sql | .sql | D | P | R1 | DDL/DML screen or targeted constraint excerpts in follow-up
```

#### `apps/api/prisma/migrations/20260917000000_phase3_slice_e_operator_reply_outbox`

```text
migration.sql | .sql | D | P | R1 | DDL/DML screen or targeted constraint excerpts in follow-up
```

#### `apps/api/prisma/migrations/20260921000000_phase3_slice_g_ai_routing_decision`

```text
migration.sql | .sql | D | P | R1 | DDL/DML screen or targeted constraint excerpts in follow-up
```

#### `apps/api/prisma/migrations/20260923000000_phase3_1_admin_settings`

```text
migration.sql | .sql | D | P | R1 | DDL/DML screen or targeted constraint excerpts in follow-up
```

#### `apps/api/prisma/migrations/20261117000000_phase4a_manual_invoice_foundation`

```text
migration.sql | .sql | D | P | R1 | DDL/DML screen or targeted constraint excerpts in follow-up
```

#### `apps/api/prisma/migrations/20261118000000_phase4a_invoice_hardening`

```text
migration.sql | .sql | D | F | DONE | Complete file read in follow-up
```

#### `apps/api/prisma/migrations/20261118010000_phase4b_jofotara_connections_submissions`

```text
migration.sql | .sql | P | P | R1 | DDL/DML screen or targeted constraint excerpts in follow-up
```

#### `apps/api/prisma/migrations/20261118020000_multi_issuer_invoice_branding`

```text
migration.sql | .sql | P | F | DONE | Complete file read in follow-up
```

#### `apps/api/scripts`

```text
phase21-workbook-dry-run.ts | .ts | D | P | R1 | Targeted excerpts in follow-up
provision-mail-configuration.cli.ts | .ts | D | D | R1 | Inventory only
provision-mail-configuration.spec.ts | TS test | D | D | R1 | Inventory only
provision-mail-configuration.ts | .ts | D | D | R1 | Inventory only
run-mariadb-integration.mjs | .mjs | D | F | DONE | Complete file read in follow-up
```

#### `apps/api/src`

```text
app.controller.ts | .ts | D | D | R2 | Inventory only
app.module.ts | .ts | P | P | R1 | Targeted original excerpts or selected parsed content
main.ts | .ts | F | F | DONE | Complete file read in original audit
worker-app.module.ts | .ts | P | P | R1 | Targeted original excerpts or selected parsed content
worker-main.ts | .ts | D | F | DONE | Complete file read in follow-up
```

#### `apps/api/src/audit`

```text
audit.module.ts | .ts | D | D | R1 | Inventory only
audit.service.spec.ts | TS test | P | P | R1 | Targeted original excerpts or selected parsed content
audit.service.ts | .ts | P | F | DONE | Complete file read in follow-up
audit.types.ts | .ts | D | D | R1 | Inventory only
```

#### `apps/api/src/common`

```text
calendar-months.spec.ts | TS test | D | D | R1 | Inventory only
mutation-context.ts | .ts | D | D | R1 | Inventory only
page-query.dto.ts | .ts | D | D | R1 | Inventory only
prisma-errors.ts | .ts | F | F | DONE | Complete file read in original audit
```

#### `apps/api/src/config`

```text
environment.spec.ts | TS test | D | D | R1 | Inventory only
environment.ts | .ts | P | P | R1 | Targeted original excerpts or selected parsed content
```

#### `apps/api/src/database`

```text
database.module.ts | .ts | D | D | R1 | Inventory only
mariadb-url.spec.ts | TS test | D | D | R1 | Inventory only
mariadb-url.ts | .ts | D | D | R1 | Inventory only
prisma.service.ts | .ts | D | D | R1 | Inventory only
```

#### `apps/api/src/health`

```text
health.controller.spec.ts | TS test | D | D | R1 | Inventory only
health.controller.ts | .ts | F | F | DONE | Complete file read in original audit
health.module.ts | .ts | D | D | R1 | Inventory only
health.service.spec.ts | TS test | D | D | R1 | Inventory only
health.service.ts | .ts | P | F | DONE | Complete file read in follow-up
```

#### `apps/api/src/identity`

```text
auth-user.ts | .ts | D | D | R1 | Inventory only
auth.constants.ts | .ts | D | D | R1 | Inventory only
auth.controller.ts | .ts | P | F | DONE | Complete file read in follow-up
auth.service.spec.ts | TS test | D | P | R1 | Targeted excerpts in follow-up
auth.service.ts | .ts | P | F | DONE | Complete file read in follow-up
captcha.service.ts | .ts | D | D | R1 | Inventory only
identity.module.ts | .ts | D | D | R1 | Inventory only
jwt-auth.guard.ts | .ts | F | F | DONE | Complete file read in original audit
jwt.strategy.ts | .ts | F | F | DONE | Complete file read in original audit
login-ui.contract.spec.ts | TS test | D | D | R1 | Inventory only
login.dto.spec.ts | TS test | D | D | R1 | Inventory only
login.dto.ts | .ts | D | D | R1 | Inventory only
origin.guard.ts | .ts | F | F | DONE | Complete file read in original audit
public.decorator.ts | .ts | D | D | R1 | Inventory only
roles.decorator.ts | .ts | D | D | R1 | Inventory only
roles.guard.spec.ts | TS test | D | D | R1 | Inventory only
roles.guard.ts | .ts | F | F | DONE | Complete file read in original audit
```

#### `apps/api/src/modules`

```text
phase-1-rbac.spec.ts | TS test | D | D | R2 | Inventory only
phase-1-services.spec.ts | TS test | D | D | R2 | Inventory only
phase21-rbac.spec.ts | TS test | D | D | R2 | Inventory only
```

#### `apps/api/src/modules/ai`

```text
ai-classification-enqueue.service.spec.ts | TS test | D | D | R1 | Inventory only
ai-classification-enqueue.service.ts | .ts | D | D | R1 | Inventory only
ai-classification-schema.spec.ts | TS test | D | D | R1 | Inventory only
ai-classification-schema.ts | .ts | D | D | R1 | Inventory only
ai-classification.service.spec.ts | TS test | D | D | R1 | Inventory only
ai-classification.service.ts | .ts | D | D | R1 | Inventory only
ai-context.util.spec.ts | TS test | D | D | R1 | Inventory only
ai-context.util.ts | .ts | D | D | R1 | Inventory only
ai-draft-context.util.spec.ts | TS test | D | D | R1 | Inventory only
ai-draft-context.util.ts | .ts | D | D | R1 | Inventory only
ai-draft-prompt.spec.ts | TS test | D | D | R1 | Inventory only
ai-draft-prompt.ts | .ts | D | D | R1 | Inventory only
ai-draft-schema.ts | .ts | D | D | R1 | Inventory only
ai-events.constants.ts | .ts | D | D | R1 | Inventory only
ai-health.service.spec.ts | TS test | D | D | R1 | Inventory only
ai-health.service.ts | .ts | D | D | R1 | Inventory only
ai-model-discovery.constants.ts | .ts | D | D | R1 | Inventory only
ai-model-discovery.dto.ts | .ts | D | D | R1 | Inventory only
ai-model-discovery.service.spec.ts | TS test | D | D | R1 | Inventory only
ai-model-discovery.service.ts | .ts | D | D | R1 | Inventory only
ai-prompt.spec.ts | TS test | D | D | R1 | Inventory only
ai-prompt.ts | .ts | D | D | R1 | Inventory only
ai-queue.constants.ts | .ts | D | D | R1 | Inventory only
ai-queue.service.spec.ts | TS test | D | D | R1 | Inventory only
ai-queue.service.ts | .ts | P | P | R1 | Targeted original excerpts or selected parsed content
ai-routing-eligibility.util.spec.ts | TS test | D | D | R1 | Inventory only
ai-routing-eligibility.util.ts | .ts | D | D | R1 | Inventory only
ai-routing-enqueue.service.ts | .ts | D | D | R1 | Inventory only
ai-routing.constants.ts | .ts | D | D | R1 | Inventory only
ai-routing.service.spec.ts | TS test | D | D | R1 | Inventory only
ai-routing.service.ts | .ts | D | D | R1 | Inventory only
ai-settings-resolver.service.spec.ts | TS test | D | D | R1 | Inventory only
ai-settings-resolver.service.ts | .ts | P | P | R1 | Targeted original excerpts or selected parsed content
ai-settings.controller.ts | .ts | P | P | R1 | Targeted original excerpts or selected parsed content
ai-settings.dto.ts | .ts | D | D | R1 | Inventory only
ai-settings.service.spec.ts | TS test | D | D | R1 | Inventory only
ai-settings.service.ts | .ts | P | P | R1 | Targeted original excerpts or selected parsed content
ai-timing.constants.ts | .ts | D | D | R1 | Inventory only
ai.module.ts | .ts | D | D | R1 | Inventory only
ai.worker.spec.ts | TS test | D | D | R1 | Inventory only
ai.worker.ts | .ts | D | D | R1 | Inventory only
anthropic-provider-adapter.spec.ts | TS test | D | D | R1 | Inventory only
anthropic-provider-adapter.ts | .ts | D | D | R1 | Inventory only
classification-rbac.spec.ts | TS test | D | D | R1 | Inventory only
classification-review.dto.ts | .ts | D | D | R1 | Inventory only
classification-review.service.spec.ts | TS test | D | D | R1 | Inventory only
classification-review.service.ts | .ts | D | D | R1 | Inventory only
classification.controller.ts | .ts | P | P | R1 | Targeted original excerpts or selected parsed content
dynamic-llm-gateway.spec.ts | TS test | D | D | R1 | Inventory only
dynamic-llm-gateway.ts | .ts | P | P | R1 | Targeted original excerpts or selected parsed content
effective-classification.service.spec.ts | TS test | D | D | R1 | Inventory only
effective-classification.service.ts | .ts | D | D | R1 | Inventory only
google-gemini-provider-adapter.spec.ts | TS test | D | D | R1 | Inventory only
google-gemini-provider-adapter.ts | .ts | D | D | R1 | Inventory only
llm-errors.ts | .ts | D | D | R1 | Inventory only
llm-gateway.ts | .ts | D | D | R1 | Inventory only
llm-http-error.util.ts | .ts | D | D | R1 | Inventory only
llm-json-output.util.spec.ts | TS test | D | D | R1 | Inventory only
llm-json-output.util.ts | .ts | D | D | R1 | Inventory only
llm-provider-adapter.ts | .ts | D | D | R1 | Inventory only
llm-provider-registry.service.spec.ts | TS test | D | D | R1 | Inventory only
llm-provider-registry.service.ts | .ts | D | D | R1 | Inventory only
llm-provider.module.ts | .ts | D | D | R1 | Inventory only
mock-llm-gateway.spec.ts | TS test | D | D | R1 | Inventory only
mock-llm-gateway.ts | .ts | D | D | R1 | Inventory only
openai-provider-adapter.spec.ts | TS test | D | D | R1 | Inventory only
openai-provider-adapter.ts | .ts | D | D | R1 | Inventory only
```

#### `apps/api/src/modules/billing-entities`

```text
billing-entities.controller.ts | .ts | D | D | R1 | Inventory only
billing-entities.dto.ts | .ts | D | D | R1 | Inventory only
billing-entities.module.ts | .ts | D | D | R1 | Inventory only
billing-entities.service.ts | .ts | D | D | R1 | Inventory only
```

#### `apps/api/src/modules/communications`

```text
ai-reply-draft.service.spec.ts | TS test | D | D | R1 | Inventory only
ai-reply-draft.service.ts | .ts | D | D | R1 | Inventory only
communication-threads-rbac.spec.ts | TS test | D | D | R1 | Inventory only
communication-threads.controller.ts | .ts | P | P | R1 | Targeted original excerpts or selected parsed content
communication-threads.dto.spec.ts | TS test | D | D | R1 | Inventory only
communication-threads.dto.ts | .ts | D | D | R1 | Inventory only
communication-threads.service.spec.ts | TS test | D | D | R1 | Inventory only
communication-threads.service.ts | .ts | D | D | R1 | Inventory only
communications-events.constants.ts | .ts | D | D | R1 | Inventory only
communications.module.ts | .ts | D | D | R1 | Inventory only
operator-reply-outbound.service.spec.ts | TS test | D | D | R1 | Inventory only
operator-reply-outbound.service.ts | .ts | D | D | R1 | Inventory only
operator-reply-queue.constants.ts | .ts | D | D | R1 | Inventory only
operator-reply-queue.service.spec.ts | TS test | D | D | R1 | Inventory only
operator-reply-queue.service.ts | .ts | D | D | R1 | Inventory only
operator-reply-timing.constants.ts | .ts | D | D | R1 | Inventory only
operator-reply.service.spec.ts | TS test | D | D | R1 | Inventory only
operator-reply.service.ts | .ts | P | P | R1 | Targeted original excerpts or selected parsed content
operator-reply.worker.spec.ts | TS test | D | D | R1 | Inventory only
operator-reply.worker.ts | .ts | D | D | R1 | Inventory only
reply-threading.util.spec.ts | TS test | D | D | R1 | Inventory only
reply-threading.util.ts | .ts | D | D | R1 | Inventory only
```

#### `apps/api/src/modules/currencies`

```text
currencies.controller.ts | .ts | D | D | R2 | Inventory only
currencies.dto.ts | .ts | D | D | R2 | Inventory only
currencies.module.ts | .ts | D | D | R2 | Inventory only
currencies.service.spec.ts | TS test | D | D | R2 | Inventory only
currencies.service.ts | .ts | D | D | R2 | Inventory only
```

#### `apps/api/src/modules/customers`

```text
customer-channels.controller.ts | .ts | D | P | R1 | Targeted excerpts in follow-up
customer-channels.service.spec.ts | TS test | D | D | R1 | Inventory only
customer-channels.service.ts | .ts | D | D | R1 | Inventory only
customer-code.service.spec.ts | TS test | D | D | R1 | Inventory only
customer-code.service.ts | .ts | D | D | R1 | Inventory only
customer-email-resolution.service.spec.ts | TS test | D | D | R1 | Inventory only
customer-email-resolution.service.ts | .ts | D | F | DONE | Complete file read in follow-up
customer-name.util.ts | .ts | D | D | R1 | Inventory only
customers-rbac.spec.ts | TS test | D | D | R1 | Inventory only
customers.controller.ts | .ts | D | P | R1 | Targeted excerpts in follow-up
customers.dto.spec.ts | TS test | D | D | R1 | Inventory only
customers.dto.ts | .ts | D | D | R1 | Inventory only
customers.module.ts | .ts | D | D | R1 | Inventory only
customers.service.spec.ts | TS test | D | D | R1 | Inventory only
customers.service.ts | .ts | D | D | R1 | Inventory only
```

#### `apps/api/src/modules/dashboard`

```text
dashboard.controller.ts | .ts | D | D | R2 | Inventory only
dashboard.module.ts | .ts | D | D | R2 | Inventory only
dashboard.service.ts | .ts | D | D | R2 | Inventory only
```

#### `apps/api/src/modules/invoice-branding`

```text
invoice-branding-renderer.spec.ts | TS test | D | D | R1 | Inventory only
invoice-branding.controller.ts | .ts | D | D | R1 | Inventory only
invoice-branding.module.ts | .ts | D | D | R1 | Inventory only
invoice-branding.schema.ts | .ts | D | D | R1 | Inventory only
invoice-branding.service.ts | .ts | P | P | R1 | Targeted original excerpts or selected parsed content
invoice-branding.spec.ts | TS test | D | D | R1 | Inventory only
```

#### `apps/api/src/modules/invoices`

```text
fawtara-boundary.ts | .ts | D | D | R1 | Inventory only
fawtara-mapper.spec.ts | TS test | D | D | R1 | Inventory only
fawtara-mapper.ts | .ts | D | D | R1 | Inventory only
fawtara-submission.service.spec.ts | TS test | D | D | R1 | Inventory only
fawtara-submission.service.ts | .ts | P | P | R1 | Targeted original excerpts or selected parsed content
invoice-foundation.contract.spec.ts | TS test | D | D | R1 | Inventory only
invoice-money.spec.ts | TS test | D | D | R1 | Inventory only
invoice-money.ts | .ts | D | D | R1 | Inventory only
invoice-preflight.service.spec.ts | TS test | D | D | R1 | Inventory only
invoice-preflight.service.ts | .ts | D | D | R1 | Inventory only
invoice-retention.spec.ts | TS test | D | D | R1 | Inventory only
invoices-rbac.spec.ts | TS test | D | D | R1 | Inventory only
invoices.controller.ts | .ts | P | P | R1 | Targeted original excerpts or selected parsed content
invoices.dto.ts | .ts | D | D | R1 | Inventory only
invoices.module.ts | .ts | D | F | DONE | Complete file read in follow-up
invoices.service.spec.ts | TS test | D | P | R1 | Targeted excerpts in follow-up
invoices.service.ts | .ts | P | P | R1 | Targeted original excerpts or selected parsed content
jofotara-connections.controller.ts | .ts | D | D | R1 | Inventory only
jofotara-connections.dto.ts | .ts | D | D | R1 | Inventory only
jofotara-connections.service.ts | .ts | D | D | R1 | Inventory only
jofotara-connections.spec.ts | TS test | D | D | R1 | Inventory only
jofotara-security.contract.spec.ts | TS test | D | D | R1 | Inventory only
jofotara-test-fixture.ts | .ts | D | D | R1 | Inventory only
jofotara.gateway.spec.ts | TS test | D | D | R1 | Inventory only
jofotara.gateway.ts | .ts | P | P | R1 | Targeted original excerpts or selected parsed content
manual-qr.ts | .ts | F | F | DONE | Complete file read in original audit
official-qr.ts | .ts | D | D | R1 | Inventory only
official-values.ts | .ts | D | D | R1 | Inventory only
payment-money.ts | .ts | D | F | DONE | Complete file read in follow-up
payments.controller.ts | .ts | D | F | DONE | Complete file read in follow-up
payments.service.ts | .ts | P | F | DONE | Complete file read in follow-up
```

#### `apps/api/src/modules/invoices/fixtures`

```text
general-receivable.xml | .xml | D | D | R1 | Inventory only
```

#### `apps/api/src/modules/legacy-import`

```text
canonical-workbook.parser.spec.ts | TS test | D | D | R2 | Inventory only
canonical-workbook.parser.ts | .ts | D | D | R2 | Inventory only
legacy-import.controller.ts | .ts | D | P | R2 | Targeted excerpts in follow-up
legacy-import.dto.ts | .ts | D | D | R2 | Inventory only
legacy-import.module.ts | .ts | D | D | R2 | Inventory only
legacy-import.service.spec.ts | TS test | D | D | R2 | Inventory only
legacy-import.service.ts | .ts | P | P | R2 | Targeted original excerpts or selected parsed content
legacy-workbook.parser.spec.ts | TS test | D | D | R2 | Inventory only
legacy-workbook.parser.ts | .ts | D | D | R2 | Inventory only
name-language.util.spec.ts | TS test | D | D | R2 | Inventory only
name-language.util.ts | .ts | D | D | R2 | Inventory only
phase21-classification.spec.ts | TS test | D | D | R2 | Inventory only
phase21-review-ui.contract.spec.ts | TS test | D | D | R2 | Inventory only
phone-normalizer.spec.ts | TS test | D | D | R2 | Inventory only
phone-normalizer.ts | .ts | D | D | R2 | Inventory only
```

#### `apps/api/src/modules/mail`

```text
deployment-mail-capability.spec.ts | TS test | D | D | R1 | Inventory only
deployment-mail-capability.ts | .ts | D | D | R1 | Inventory only
imap-credentials.ts | .ts | D | D | R1 | Inventory only
imap-identity.util.spec.ts | TS test | D | D | R1 | Inventory only
imap-identity.util.ts | .ts | D | D | R1 | Inventory only
imap-mailbox-reader-factory.ts | .ts | D | D | R1 | Inventory only
imap-mailbox-reader.spec.ts | TS test | D | D | R1 | Inventory only
imap-mailbox-reader.ts | .ts | D | D | R1 | Inventory only
imap-timing.constants.ts | .ts | P | P | R1 | Targeted original excerpts or selected parsed content
integration-health.controller.ts | .ts | D | D | R1 | Inventory only
integration-health.service.spec.ts | TS test | D | D | R1 | Inventory only
integration-health.service.ts | .ts | D | D | R1 | Inventory only
mail-address.util.ts | .ts | D | D | R1 | Inventory only
mail-configuration-resolver.service.spec.ts | TS test | D | D | R1 | Inventory only
mail-configuration-resolver.service.ts | .ts | D | D | R1 | Inventory only
mail-environment-guard.spec.ts | TS test | D | D | R1 | Inventory only
mail-environment-guard.ts | .ts | D | D | R1 | Inventory only
mail-health.service.spec.ts | TS test | D | D | R1 | Inventory only
mail-health.service.ts | .ts | D | D | R1 | Inventory only
mail-imap-events.constants.ts | .ts | D | D | R1 | Inventory only
mail-imap-health.service.spec.ts | TS test | D | D | R1 | Inventory only
mail-imap-health.service.ts | .ts | D | D | R1 | Inventory only
mail-imap-queue.constants.ts | .ts | D | D | R1 | Inventory only
mail-imap-queue.service.spec.ts | TS test | D | D | R1 | Inventory only
mail-imap-queue.service.ts | .ts | D | P | R1 | Targeted excerpts in follow-up
mail-imap.worker.ts | .ts | D | P | R1 | Targeted excerpts in follow-up
mail-inbound-body.util.spec.ts | TS test | D | D | R1 | Inventory only
mail-inbound-body.util.ts | .ts | D | D | R1 | Inventory only
mail-inbound-correlation.service.ts | .ts | P | P | R1 | Targeted original excerpts or selected parsed content
mail-inbound-ingest.service.spec.ts | TS test | D | D | R1 | Inventory only
mail-inbound-ingest.service.ts | .ts | P | P | R1 | Targeted original excerpts or selected parsed content
mail-inbound-sender-resolution.service.spec.ts | TS test | D | D | R1 | Inventory only
mail-inbound-sender-resolution.service.ts | .ts | D | D | R1 | Inventory only
mail-message-correlation.util.spec.ts | TS test | D | D | R1 | Inventory only
mail-message-correlation.util.ts | .ts | D | D | R1 | Inventory only
mail-message-id.util.spec.ts | TS test | D | D | R1 | Inventory only
mail-message-id.util.ts | .ts | D | D | R1 | Inventory only
mail-outbound.service.spec.ts | TS test | D | P | R1 | Targeted excerpts in follow-up
mail-outbound.service.ts | .ts | P | P | R1 | Targeted original excerpts or selected parsed content
mail-queue.constants.ts | .ts | D | D | R1 | Inventory only
mail-queue.service.ts | .ts | D | P | R1 | Targeted excerpts in follow-up
mail-settings.controller.ts | .ts | D | D | R1 | Inventory only
mail-settings.dto.ts | .ts | D | D | R1 | Inventory only
mail-settings.service.spec.ts | TS test | D | D | R1 | Inventory only
mail-settings.service.ts | .ts | D | D | R1 | Inventory only
mail-thread-resolution.service.spec.ts | TS test | D | D | R1 | Inventory only
mail-thread-resolution.service.ts | .ts | D | D | R1 | Inventory only
mail-timing.constants.spec.ts | TS test | D | D | R1 | Inventory only
mail-timing.constants.ts | .ts | P | P | R1 | Targeted original excerpts or selected parsed content
mail-transport.ts | .ts | D | D | R1 | Inventory only
mail.module.ts | .ts | D | D | R1 | Inventory only
mail.worker.ts | .ts | D | F | DONE | Complete file read in follow-up
mailbox-reader.ts | .ts | D | D | R1 | Inventory only
microsoft-oauth-credentials.ts | .ts | D | D | R1 | Inventory only
microsoft-oauth-token-provider.spec.ts | TS test | D | D | R1 | Inventory only
microsoft-oauth-token-provider.ts | .ts | P | P | R1 | Targeted original excerpts or selected parsed content
microsoft-oauth.constants.ts | .ts | P | P | R1 | Targeted original excerpts or selected parsed content
mock-mail-transport.ts | .ts | D | D | R1 | Inventory only
mock-mailbox-reader-factory.spec.ts | TS test | D | D | R1 | Inventory only
mock-mailbox-reader-factory.ts | .ts | D | D | R1 | Inventory only
mock-mailbox-reader.spec.ts | TS test | D | D | R1 | Inventory only
mock-mailbox-reader.ts | .ts | D | D | R1 | Inventory only
settings-rbac.spec.ts | TS test | D | D | R1 | Inventory only
smtp-credentials.ts | .ts | D | D | R1 | Inventory only
smtp-error-classification.spec.ts | TS test | D | D | R1 | Inventory only
smtp-error-classification.ts | .ts | D | D | R1 | Inventory only
smtp-mail-transport.spec.ts | TS test | D | D | R1 | Inventory only
smtp-mail-transport.ts | .ts | D | D | R1 | Inventory only
```

#### `apps/api/src/modules/renewal-cases`

```text
communication-outbox.controller.ts | .ts | D | D | R1 | Inventory only
communication-outbox.service.ts | .ts | D | D | R1 | Inventory only
manual-renewal.service.ts | .ts | P | F | DONE | Complete file read in follow-up
phase-2-rbac.spec.ts | TS test | D | D | R1 | Inventory only
phase21-renewal-interval.spec.ts | TS test | D | D | R1 | Inventory only
renewal-cases.controller.ts | .ts | D | P | R1 | Targeted excerpts in follow-up
renewal-cases.dto.ts | .ts | P | P | R1 | Targeted original excerpts or selected parsed content
renewal-cases.module.ts | .ts | D | F | DONE | Complete file read in follow-up
renewal-cases.service.spec.ts | TS test | D | P | R1 | Targeted excerpts in follow-up
renewal-cases.service.ts | .ts | P | P | R1 | Targeted original excerpts or selected parsed content
renewal-configuration.controller.ts | .ts | D | D | R1 | Inventory only
renewal-configuration.service.spec.ts | TS test | D | D | R1 | Inventory only
renewal-configuration.service.ts | .ts | D | D | R1 | Inventory only
renewal-engine-recovery.spec.ts | TS test | D | D | R1 | Inventory only
renewal-engine.controller.ts | .ts | D | D | R1 | Inventory only
renewal-engine.service.spec.ts | TS test | D | D | R1 | Inventory only
renewal-engine.service.ts | .ts | P | P | R1 | Targeted original excerpts or selected parsed content
renewal-hold-aggregation.spec.ts | TS test | D | D | R1 | Inventory only
renewal-period.ts | .ts | D | F | DONE | Complete file read in follow-up
renewal-policy.spec.ts | TS test | D | D | R1 | Inventory only
renewal-policy.ts | .ts | D | D | R1 | Inventory only
renewal-queue.constants.ts | .ts | D | D | R1 | Inventory only
renewal-queue.service.spec.ts | TS test | D | D | R1 | Inventory only
renewal-queue.service.ts | .ts | D | P | R1 | Targeted excerpts in follow-up
renewal-template.renderer.spec.ts | TS test | D | D | R1 | Inventory only
renewal-template.renderer.ts | .ts | D | D | R1 | Inventory only
renewal-transition-policy.spec.ts | TS test | D | F | DONE | Complete file read in follow-up
renewal-transition-policy.ts | .ts | P | F | DONE | Complete file read in follow-up
renewal.worker.spec.ts | TS test | D | D | R1 | Inventory only
renewal.worker.ts | .ts | D | F | DONE | Complete file read in follow-up
resolve-applicable-customer-milestone.spec.ts | TS test | D | D | R1 | Inventory only
```

#### `apps/api/src/modules/service-packages`

```text
service-packages.controller.ts | .ts | D | D | R2 | Inventory only
service-packages.dto.ts | .ts | D | D | R2 | Inventory only
service-packages.module.ts | .ts | D | D | R2 | Inventory only
service-packages.service.spec.ts | TS test | D | D | R2 | Inventory only
service-packages.service.ts | .ts | D | D | R2 | Inventory only
```

#### `apps/api/src/modules/service-types`

```text
service-types.controller.ts | .ts | D | D | R2 | Inventory only
service-types.dto.ts | .ts | D | D | R2 | Inventory only
service-types.module.ts | .ts | D | D | R2 | Inventory only
service-types.service.spec.ts | TS test | D | D | R2 | Inventory only
service-types.service.ts | .ts | D | D | R2 | Inventory only
```

#### `apps/api/src/modules/subscription-connections`

```text
subscription-connections.controller.ts | .ts | D | D | R2 | Inventory only
subscription-connections.dto.ts | .ts | D | D | R2 | Inventory only
subscription-connections.module.ts | .ts | D | D | R2 | Inventory only
subscription-connections.service.ts | .ts | D | D | R2 | Inventory only
```

#### `apps/api/src/modules/subscriptions`

```text
phase21-subscriptions.service.spec.ts | TS test | D | D | R1 | Inventory only
subscription-code.service.spec.ts | TS test | D | D | R1 | Inventory only
subscription-code.service.ts | .ts | D | D | R1 | Inventory only
subscriptions.controller.ts | .ts | D | P | R1 | Targeted excerpts in follow-up
subscriptions.dto.spec.ts | TS test | D | D | R1 | Inventory only
subscriptions.dto.ts | .ts | D | D | R1 | Inventory only
subscriptions.module.ts | .ts | D | D | R1 | Inventory only
subscriptions.service.spec.ts | TS test | D | D | R1 | Inventory only
subscriptions.service.ts | .ts | D | D | R1 | Inventory only
```

#### `apps/api/src/modules/technical-connections`

```text
technical-connections.controller.ts | .ts | F | F | DONE | Complete file read in original audit
technical-connections.dto.ts | .ts | D | D | R2 | Inventory only
technical-connections.module.ts | .ts | D | D | R2 | Inventory only
technical-connections.service.spec.ts | TS test | D | D | R2 | Inventory only
technical-connections.service.ts | .ts | D | D | R2 | Inventory only
```

#### `apps/api/src/queue`

```text
queue-foundation.module.ts | .ts | D | D | R1 | Inventory only
redis-config.spec.ts | TS test | D | D | R1 | Inventory only
redis-config.ts | .ts | D | D | R1 | Inventory only
redis-connection.service.ts | .ts | D | D | R1 | Inventory only
```

#### `apps/api/src/security`

```text
secret-encryption.service.spec.ts | TS test | D | D | R1 | Inventory only
secret-encryption.service.ts | .ts | P | F | DONE | Complete file read in follow-up
security.module.ts | .ts | D | D | R1 | Inventory only
technical-connection-secret.service.ts | .ts | D | D | R1 | Inventory only
```

#### `apps/api/src/time`

```text
business-time.service.spec.ts | TS test | D | D | R2 | Inventory only
business-time.service.ts | .ts | D | D | R2 | Inventory only
clock.service.ts | .ts | D | D | R2 | Inventory only
time.module.ts | .ts | D | D | R2 | Inventory only
```

#### `apps/api/test/helpers`

```text
core-domain.factory.ts | .ts | D | D | R2 | Inventory only
```

#### `apps/web`

```text
.env.production.example | env example | D | D | R1 | Inventory only
eslint.config.mjs | .mjs | D | D | R1 | Inventory only
next-env.d.ts | .ts | D | D | R2 | Inventory only
next.config.ts | .ts | D | D | R1 | Inventory only
package.json | .json | F | F | DONE | Complete file read in original audit
postcss.config.mjs | .mjs | D | D | R1 | Inventory only
proxy.ts | .ts | D | D | R2 | Inventory only
render-test.tsconfig.json | .json | D | D | R1 | Inventory only
tsconfig.json | .json | D | D | R1 | Inventory only
```

#### `apps/web/app`

```text
globals.css | .css | D | D | R1 | Inventory only
layout.tsx | .tsx | D | D | R2 | Inventory only
page.tsx | .tsx | D | D | R2 | Inventory only
```

#### `apps/web/app/dashboard`

```text
layout.tsx | .tsx | D | D | R2 | Inventory only
page.tsx | .tsx | D | D | R2 | Inventory only
```

#### `apps/web/app/dashboard/access`

```text
page.tsx | .tsx | D | D | R2 | Inventory only
```

#### `apps/web/app/dashboard/billing-entities`

```text
page.tsx | .tsx | D | D | R2 | Inventory only
```

#### `apps/web/app/dashboard/communications`

```text
page.tsx | .tsx | D | D | R2 | Inventory only
```

#### `apps/web/app/dashboard/communications/[threadId]`

```text
page.tsx | .tsx | D | D | R2 | Inventory only
```

#### `apps/web/app/dashboard/currencies`

```text
page.tsx | .tsx | D | D | R2 | Inventory only
```

#### `apps/web/app/dashboard/customers`

```text
page.tsx | .tsx | D | D | R2 | Inventory only
```

#### `apps/web/app/dashboard/customers/[id]`

```text
page.tsx | .tsx | D | D | R2 | Inventory only
```

#### `apps/web/app/dashboard/invoices`

```text
page.tsx | .tsx | D | D | R1 | Inventory only
```

#### `apps/web/app/dashboard/invoices/[id]`

```text
page.tsx | .tsx | D | D | R1 | Inventory only
```

#### `apps/web/app/dashboard/legacy-import`

```text
page.tsx | .tsx | D | D | R2 | Inventory only
```

#### `apps/web/app/dashboard/packages`

```text
page.tsx | .tsx | D | D | R2 | Inventory only
```

#### `apps/web/app/dashboard/renewal-settings`

```text
page.tsx | .tsx | D | D | R2 | Inventory only
```

#### `apps/web/app/dashboard/renewals`

```text
page.tsx | .tsx | D | D | R1 | Inventory only
```

#### `apps/web/app/dashboard/service-types`

```text
page.tsx | .tsx | D | D | R2 | Inventory only
```

#### `apps/web/app/dashboard/settings`

```text
page.tsx | .tsx | D | D | R2 | Inventory only
```

#### `apps/web/app/dashboard/subscriptions`

```text
page.tsx | .tsx | D | D | R2 | Inventory only
```

#### `apps/web/app/dashboard/technical-connections`

```text
page.tsx | .tsx | D | D | R2 | Inventory only
```

#### `apps/web/app/login`

```text
page.tsx | .tsx | D | D | R1 | Inventory only
```

#### `apps/web/components`

```text
access-overview.tsx | .tsx | D | D | R2 | Inventory only
ai-model-combobox.tsx | .tsx | D | D | R2 | Inventory only
app-shell.tsx | .tsx | P | P | R1 | Targeted original excerpts or selected parsed content
billing-entities-manager.tsx | .tsx | P | P | R1 | Targeted original excerpts or selected parsed content
communication-thread-detail.tsx | .tsx | P | P | R1 | Targeted original excerpts or selected parsed content
communications-manager.tsx | .tsx | D | D | R1 | Inventory only
currencies-manager.tsx | .tsx | P | P | R2 | Targeted original excerpts or selected parsed content
customer-channels-manager.tsx | .tsx | D | D | R1 | Inventory only
customer-combobox.tsx | .tsx | D | D | R1 | Inventory only
customer-detail.tsx | .tsx | P | P | R1 | Targeted original excerpts or selected parsed content
customers-manager.tsx | .tsx | P | P | R1 | Targeted original excerpts or selected parsed content
dashboard-shell.tsx | .tsx | D | D | R2 | Inventory only
dashboard-summary.tsx | .tsx | D | D | R2 | Inventory only
invoice-branding-editor.tsx | .tsx | D | D | R1 | Inventory only
invoice-branding-presets.ts | .ts | D | D | R1 | Inventory only
invoice-detail.tsx | .tsx | P | P | R1 | Targeted original excerpts or selected parsed content
invoice-renderer.tsx | .tsx | P | P | R1 | Targeted original excerpts or selected parsed content
invoice-types.ts | .ts | P | P | R1 | Targeted original excerpts or selected parsed content
invoice-visibility-editor.tsx | .tsx | D | D | R1 | Inventory only
invoices-manager.tsx | .tsx | P | P | R1 | Targeted original excerpts or selected parsed content
jofotara-connections.tsx | .tsx | P | P | R2 | Targeted original excerpts or selected parsed content
legacy-import-manager.tsx | .tsx | P | P | R2 | Targeted original excerpts or selected parsed content
login-form.tsx | .tsx | D | D | R1 | Inventory only
modal.tsx | .tsx | P | F | DONE | Complete file read in follow-up
notice.tsx | .tsx | D | D | R1 | Inventory only
page-heading.tsx | .tsx | D | D | R2 | Inventory only
renewal-case-detail.tsx | .tsx | P | P | R1 | Targeted original excerpts or selected parsed content
renewal-cases-manager.tsx | .tsx | P | P | R1 | Targeted original excerpts or selected parsed content
renewal-settings-manager.tsx | .tsx | D | D | R1 | Inventory only
service-packages-manager.tsx | .tsx | P | P | R2 | Targeted original excerpts or selected parsed content
service-types-manager.tsx | .tsx | P | P | R2 | Targeted original excerpts or selected parsed content
settings-manager.tsx | .tsx | P | P | R1 | Targeted original excerpts or selected parsed content
subscription-modal.tsx | .tsx | D | D | R1 | Inventory only
subscriptions-manager.tsx | .tsx | D | D | R1 | Inventory only
technical-connections-manager.tsx | .tsx | D | D | R2 | Inventory only
```

#### `apps/web/lib`

```text
api.ts | .ts | P | F | DONE | Complete file read in follow-up
customer-name.ts | .ts | D | D | R2 | Inventory only
renewal-timing.ts | .ts | D | D | R2 | Inventory only
```

#### `apps/web/public`

```text
nusrv-invoice-logo.png | .png | X | X | EX | Binary asset, deferred to print or asset verification
```

#### `apps/web/public/invoice-branding-presets`

```text
future-foresight-logo.png | .png | X | X | EX | Binary asset, deferred to print or asset verification
```

#### `apps/web/tests`

```text
invoice-branding-renderer.check.tsx | TSX test | D | D | R1 | Inventory only
```

#### `audit`

```text
CODEX_CHALLENGE_READINESS.md | .md | X | X | EX | Prior audit output, not source evidence
CODEX_FUTURE_VISION.md | .md | X | X | EX | Prior audit output, not source evidence
CODEX_IMPLEMENTATION_PLAN.md | .md | X | X | EX | Prior audit output, not source evidence
CODEX_INITIAL_REPORT.md | .md | X | X | EX | Prior audit output, not source evidence
CODEX_SELF_CRITICISM.md | .md | X | X | EX | Prior audit output, not source evidence
PROJECT_BASELINE.md | .md | X | X | EX | Prior audit output, not source evidence
```

#### `deploy/staging`

```text
.env.staging.example | env example | D | D | R1 | Inventory only
inspect-plesk-host.sh | .sh | D | D | R1 | Inventory only
```

#### `deploy/staging/systemd`

```text
customer-cp-api.service.example | systemd example | D | D | R1 | Inventory only
customer-cp-web.service.example | systemd example | D | D | R1 | Inventory only
customer-cp-worker.service.example | systemd example | D | D | R1 | Inventory only
```

#### `docs`

```text
CURRENT_IMPLEMENTATION_SCOPE.md | .md | P | P | R1 | Targeted original excerpts or selected parsed content
multi-issuer-branding-verification.md | .md | P | P | R2 | Targeted original excerpts or selected parsed content
phase4-verification.md | .md | P | P | R2 | Targeted original excerpts or selected parsed content
```

#### `docs/deployment`

```text
PHASE_02_PLESK_STAGING_RUNBOOK.md | .md | P | P | R2 | Targeted original excerpts or selected parsed content
```

#### `docs/operations`

```text
PHASE_2_1_PACKAGE_CLASSIFICATION_RULES.md | .md | D | D | R2 | Inventory only
```

#### `docs/technical`

```text
ADR-001-TECHNOLOGY-STACK.md | .md | D | D | R2 | Inventory only
ADR-002-PHASE-0-FOUNDATION.md | .md | D | D | R2 | Inventory only
ADR-003-MARIADB-RETARGET.md | .md | D | D | R2 | Inventory only
ADR-004-PHASE-2-RENEWAL-ENGINE.md | .md | D | D | R2 | Inventory only
PHASE_0_FOUNDATION.md | .md | D | D | R2 | Inventory only
PHASE_1_CORE_CP.md | .md | D | D | R2 | Inventory only
PHASE_2_RENEWAL_ENGINE.md | .md | D | D | R2 | Inventory only
```

#### `docs/templates`

```text
invoice_original.pdf | .pdf | X | X | EX | Binary asset, deferred to print or asset verification
invoice_template.html | .html | D | D | R1 | Inventory only
nusrv_invoice_latest_reference.pdf | .pdf | X | X | EX | Binary asset, deferred to print or asset verification
payment_receipt_original.pdf | .pdf | X | X | EX | Binary asset, deferred to print or asset verification
payment_receipt_template.html | .html | D | D | R1 | Inventory only
```

#### `docs/templates/assets`

```text
future-foresight-logo-transparent.png | .png | X | X | EX | Binary asset, deferred to print or asset verification
```

#### `packages/shared`

```text
eslint.config.mjs | .mjs | D | D | R1 | Inventory only
package.json | .json | D | D | R1 | Inventory only
tsconfig.json | .json | D | D | R1 | Inventory only
```

#### `packages/shared/src`

```text
index.ts | .ts | D | D | R1 | Inventory only
```

#### `PHASES`

```text
00_PHASE_INDEX.md | .md | D | D | R1 | Inventory only
PHASE_00_FOUNDATION.md | .md | D | D | R1 | Inventory only
PHASE_01_CORE_CP.md | .md | D | D | R1 | Inventory only
PHASE_02_1_OPERATIONAL_DATA_CORRECTION.md | .md | D | D | R1 | Inventory only
PHASE_02_2_CANONICAL_DATA_MIGRATION.md | .md | D | D | R1 | Inventory only
PHASE_02_RENEWAL_ENGINE.md | .md | D | D | R1 | Inventory only
PHASE_03_1_ADMIN_SETTINGS.md | .md | D | D | R1 | Inventory only
PHASE_03_MAIL_AI.md | .md | D | D | R1 | Inventory only
PHASE_04_FAWTARA.md | .md | D | D | R1 | Inventory only
PHASE_05_COLLECTION.md | .md | D | D | R1 | Inventory only
PHASE_06_TECHNICAL_ACTIONS.md | .md | D | D | R1 | Inventory only
PHASE_07_REPORTING_HARDENING.md | .md | D | D | R1 | Inventory only
PHASE_08_OPTIONAL_MCP.md | .md | D | D | R1 | Inventory only
```

#### `SOURCE`

```text
must answer2.txt | .txt | X | X | EX | Historical business answers, separate from current scope
README.md | .md | D | F | DONE | Complete file read in follow-up
```
