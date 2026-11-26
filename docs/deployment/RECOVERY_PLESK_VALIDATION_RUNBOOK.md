# Recovery branch — Plesk isolated validation handoff

2026-11-25. This is a validation runbook, not production deployment authorization.
Source: `work/p1-chatgpt-recovery`, pull request #1 (draft). The source checkpoint preceding this runbook is `96ce6a28a0e4b3872ee3bea7d55fc1b9669096e9`; pin and record the final fetched commit including this runbook. Do not merge main, enable outbound mail, enable AI, reset live cursors, or run migrations against production during these steps.

## 1. Obtain a separate source checkout

Use SSH/terminal under the intended validation account, not the web application document root. Check Node >=22.12, npm >=10, available space and MariaDB version. Existing repository required; choose a new empty/nonexistent sibling worktree path. Preserve production processes, configuration and secrets.

```bash
git status --short
git fetch origin work/p1-chatgpt-recovery
git worktree add --detach ../nusrv-recovery-validation FETCH_HEAD
cd ../nusrv-recovery-validation
git rev-parse HEAD
git status --short
node --version
npm --version
```

Stop on a dirty checkout or unexpected SHA. Never copy production .env into this worktree. Do not register a Plesk deployment action or launch an API/worker yet. The operator must provide isolated credentials for fixtures, not customer secrets. Source validation can run without MariaDB or Redis.

## 2. Source checks before deployment (owner sequencing 2026-11-25)

Use the separate clean checkout from section 1, with Node >=22.12, npm >=10, access to locked npm packages and an installed Chrome/Chromium executable. Do not copy production environment files. Run:

```bash
bash scripts/validate-release-source.sh
```

This is also the single entry point of the manual-only recovery source workflow. It refuses a dirty checkout and dotenv files, uses a clean child environment with deliberately unreachable localhost dependency endpoints, installs locked packages, generates/validates Prisma offline, typechecks, lints, runs all non-live API Jest tests plus real Chrome profile restart/Next UI checks, runs tracked standalone Node contracts and renderer checks, and builds the production workspace. All live MariaDB test files are explicitly excluded. Failure of any of these source checks blocks production switch. Do not treat a historical CI run, a synthetic browser-only harness, or partial standalone tests as a pass for the current commit.

The owner directed actual database tests to follow deployment. Sections 3–5 describe those post-deployment rehearsals using separate disposable schemas and a restored copy, NEVER the live customer database. Before the deployed application starts, migration execution itself, verified backup/restore readiness, database identity, grants, migration status and stopping old processes remain mandatory safety preconditions; these are deployment steps, not destructive test fixtures. Deploy with MAIL_WORKERS_PAUSED=true and the three P2 release flags false, then perform the designated DB and acceptance checks before removing the maintenance freeze. This sequencing accepts the added risk of applying a not-yet-rehearsed migration; record the owner's decision and preserve an approved recovery path. Do not interpret it as authorization to omit migration steps or run destructive tests on production.

## 3. Post-deployment: fresh disposable MariaDB rehearsal

Have the DB administrator create an EMPTY dedicated `nusrv_rehearsal_test` schema on loopback port 3306 with a new non-privileged test account restricted to that schema (including permissions required to execute test migrations and triggers). Use a protected shell/environment mechanism to supply the actual URL; never print it or paste it into chat or a committed file. Test names alone do not prove a target is disposable. Verify the server, account grants, schema emptiness and owner approval independently. No production credentials, Redis queues or network-capable mail worker.

Set DATABASE_URL to the approved test URL and MARIADB_TEST_DATABASE_URL to its identical value. The following guard must pass before any migration or fixture:

```bash
node -e 'const a=new URL(process.env.DATABASE_URL),b=new URL(process.env.MARIADB_TEST_DATABASE_URL); if(a.protocol!=="mysql:"||a.hostname!=="127.0.0.1"||a.port!=="3306"||a.pathname!=="/nusrv_rehearsal_test"||a.href!==b.href||!a.username||!a.password||/^(root|admin)$/i.test(decodeURIComponent(a.username))||a.search||a.hash)throw Error("Unsafe rehearsal target"); console.log("Dedicated rehearsal URL validated")'
npm run db:migrate:deploy
(cd apps/api && ../../node_modules/.bin/prisma migrate status)
npm run test -w @cp/api -- --runTestsByPath prisma/p1-finance-mariadb-live.spec.ts
npm run test -w @cp/api -- --runTestsByPath prisma/p2-evidence-folder-mariadb-live.spec.ts
npm run test -w @cp/api -- --runTestsByPath prisma/p2-dsn-prisma-mariadb-live.spec.ts
```

The DSN fixture uses synthetic attestations, not real provider identity. Verify new review table/constraints/triggers on the disposable schema. Exercise insert, duplicate, immutable update/delete rejection, audit rollback and no customer EmailMessage or outbox/renewal changes. Exercise actual reader parsing with ordinary MIME, report MIME, malformed/duplicate headers, nested reports, truncated source and replay. Review-capture gate is false by default; enable only in a controlled disposable test process with test mailbox fixtures and no customer traffic. Keep original mailbox evidence; captured text is bounded, and digest is of fetched bytes, not necessarily full original message.

## 4. Post-deployment: twelve independent historical fixtures

Do NOT run the old combined legacy suite against one database. Each fixture owns an initially empty `nusrv_legacy_<suite>_test` schema with dedicated credentials restricted to it. Required suite IDs: core, phase2, phase21, subscription_backfill, subscription_sequence_delete, phase3a, phase3b, phase3c, phase3d, phase3e, phase4, branding.

For each suite set DATABASE_URL and MARIADB_TEST_DATABASE_URL to the identical approved URL, then run:
```bash
npm run test:db:mariadb -w @cp/api -- --suite phase3c
```
Replace phase3c with the intended suite ID. Launcher preflights schema emptiness; do not pre-migrate these legacy fixtures. Do not reuse a failed/timed-out schema until it has been explicitly disposed of and recreated by the test DB administrator. Previous combined run (8 passed / 98 failed) was not an acceptance result; twelve isolated executions remain mandatory.

## 5. Post-deployment: populated upgrade and application acceptance

Use a separate restored copy of the current deployed database on a controlled test server, with non-production grants and no running old workers, not the fresh/legacy fixture databases. Inventory applied migration IDs and schema drift; verify backup and restore, before/after record counts and financial balances. Apply checked-in pending migrations only to the copy using migrate deploy. Verify constraints, triggers, receipts, invoices, QR history, renewal transitions and audit retention. Never use migrate dev, migrate reset, db push or unconditional seed on a populated target.

Use isolated Redis and credentials for any subsequent app smoke test. Verify authenticated browser restart, logout, role changes, old-worker fencing and queues; disable all real outbound/inbound connectors until separate approval. Compare authenticated company invoice/receipt print to approved visual references. Keep all three P2 gates off on the production environment until tests pass and the owner authorizes enabling them. User-facing resolution is ADMIN-only and never resends or changes renewal decisions.

## 6. Remaining provider/activation gates (not implemented by this runbook)

- A real provider adapter must independently verify mailbox/account and exact message/recipient/attempt evidence. IMAP or DSN headers, SMTP acceptance and Sent presence alone are insufficient. Do not manufacture attestation from these fields.
- Sent observation has a separate local connection generation, future-only ADMIN baseline, bounded worker, explicit stop and history retention. The local generation is NOT a verified provider account binding. Test TLS IMAP discovery, bounded search, rollover/repoint and worker races before enabling P2_SENT_OBSERVATION_ENABLED. The independent provider-authenticated DSN transaction/store is still not registered as a real provider polling worker; do not promote unverified evidence.
- Review-only capture is bounded, gated, and not a complete MIME/provider assurance or a confirmed bounce. Confirm actual capture, cursor replay, configuration changes including ABA/repoint races, and rollback; never silently backfill or rewind a production cursor.
- Individual/personal invoice reference and historical invoice association remain separately owner-gated. No invented personal template or historical inference.
- Before any live deployment: report exact commit, source build/test results, fresh and populated upgrade results, each legacy suite, browser/print and provider evidence, backup/restore proof, worker fencing plan and owner approval. No live deployment is authorized here.

## Evidence available at handoff

56 isolated Node contracts passed in the local Node 22.16 environment (including synthetic transaction ports, static SQL, binding/session/DSN and report-shape capture), plus 5 isolated launcher contracts. The new full workspace checks and physical MariaDB fixtures are staged, not executed at this head. No real mail, production database mutation, worker activation or main merge occurred.


## 7. Owner-authorized release to crm.nusrv.com (only after source checks and production preflight)

The owner intends to validate on the Plesk host. Destructive fixtures must never use live customer data. Test schemas and a restored upgrade copy may be hosted on the same server with independently verified database names, credentials and isolation.

- Pin the exact recovery SHA in a separate release directory. Install locked packages, generate Prisma, validate schema, typecheck, test, lint and build before switching the live directory. No production credentials in source checks.
- Identify actual Plesk process manager, Node and Redis configuration. Record deployed SHA and applied migration history. Preserve encrypted configuration and secrets securely. Obtain independently verified restorable backups, approved maintenance window and recovery plan.
- Stop all old workers and scheduler producers, prevent supervisor restart, verify no active old consumers or SMTP operations, and stop writes before migration. Preserve queued, processing and uncertain mail metadata. Never purge queues or reset cursors.
- Check production database identity, grants, migration history and drift read-only. Per owner sequencing, rehearse on a populated restored copy after the deployment; record the elevated cutover risk and ensure a verified backup and recovery plan before the production migration. The Sent epoch migration creates a table, adds a column, replaces the composite unique index and adds an invalidation trigger; preserves existing rows. MariaDB DDL is not fully transactional: on partial failure inspect actual schema and recover, do not blindly re-run or mark migrations applied. Only approved `npm run db:migrate:deploy` is permitted on the verified production target. No seed, reset, schema push or destructive fixtures.
- Set MAIL_WORKERS_PAUSED=true in BOTH API and worker process environments and keep all three P2 release flags false initially. Restart only the new executable after the schema is ready. This freeze returns empty worker batches without claiming messages or advancing cursors; it does not stop old executables or in-flight sends. Old workers must already be stopped. Health displays the maintenance pause. Keep the freeze in effect until the post-deployment database and acceptance checks are verified and the owner approves unpausing. Start new API/web, verify authentication, RBAC, customer/subscription, renewal, official invoice and receipt. Start new workers only after isolation and queue checks. Use designated test customers and mailboxes for live smoke tests.
- Rollback requires pausing writers/consumers, checking migration effects, and restoring a verified compatible release or backup through the approved recovery plan. Never assume an old executable is schema compatible or replay mail automatically.
- On a designated test mailbox, enable Sent only after source, database and browser checks pass. ADMIN opens Settings > Mail > Inspect Sent observation, confirms future-only, and activates. Verify secure real IMAP, unique server-flagged Sent folder and ESEARCH/IMAP4rev2 support. Test empty/new polls, stop, concurrent polls, UIDVALIDITY rollover, A→B→A settings change and explicit new baseline. A Sent copy remains UNKNOWN delivery.
- Independent provider-confirmed delivery/hard-bounce integration remains open: an actual authorized provider source and account/attempt verification are needed. No authentication from MIME or IMAP login alone. The current Sent, review-only capture and action queue do not constitute that integration.

## 8. Additional programming-pass source evidence

At source checkpoint `ee87db500e70eba9eac959367099463e7e904279`, 16 independent Node 22.16 tests passed: invoice selection (5), navigation (4), status (4), Sent identity (3). Exact Git blob hashes matched. The local extension resolver was adjusted for the extensionless .util import before the final successful run; no production change. Strict isolated TypeScript checks passed for the three UI helpers. Full Jest, Prisma, MariaDB, browser and workspace checks remain unexecuted at this checkpoint. No actual provider access, mail send, database mutation or deployment occurred.


## 9. Release-blocker hardening checkpoint

2026-11-25: OAuth cache identity now includes the actual credential tuple via process-local HMAC; bounded in-memory cache, never logs secrets. The invoice create modal cannot be closed during the save. Environment examples use production-valid SMTP/IMAP modes and 24h refresh TTL. Deployment-only worker freeze reports truthful health and no invented send outcomes, preserves outbox/cursors and blocks Sent activation. Cutover is explicitly UTC; unchanged values are not rewritten and clearing is explicit. When P2 Sent or report capture is enabled, worker bootstrap checks their table projections before registering consumers. No database connection was made to verify these runtime guards here.

At d62752e, nine standalone tests passed (OAuth 3, maintenance 2, UTC cutover 4), exact Git blob hashes matched, strict isolated TypeScript passed. The pre-deployment shell script hash b842e9eeee0ae071f0d3ed1e67f6f0b0dd6e26ef was syntax-checked and rejected both a dirty checkout and a hidden production-style dotenv file in disposable Git fixtures. No dependency install, full Jest/Prisma/Next/ESLint or real browser run at the final head was possible in this environment (direct GitHub DNS unavailable, project dependencies absent; GitHub connector has no workflow dispatch action). Previous TypeScript failure from 2026-11-23 was in an old UUID fixture whose default argument is now explicitly typed string; this is source inspection, not a current passing CI result. The source validation remains mandatory before deployment.

The independent provider-authenticated delivery/DSN integration is still an open programming/integration requirement: no verified provider event API, authorized credentials and representative proof were supplied. The base CRM can be considered for a maintenance-mode deployment only after source validation and owner acceptance of this explicit limitation. Do not mark full OD-12 coverage complete. No real mail, production database mutation, main merge or deployment was performed.


## 10. Source handoff for Plesk-only build (owner instruction)

The owner explicitly requested that the full build take place on Plesk, not in the external assistant environment. Fetch the recovery branch in an isolated release/source checkout on Plesk, pin the reviewed commit, and execute section 2 there BEFORE switching the live application. The handoff means source ready to fetch for verification, not a certified production build. Do not merge main, change the existing deployment directory, apply a migration, restart services, or enable mail merely because source is available. Record the actual SHA and every command outcome. If a source check fails, stop and correct the source; do not bypass it.

Changes following b339e3e:

- Recognized transport reports and excessive uninspected header regions do not fall through into normal customer correlation. With P2_DSN_REVIEW_CAPTURE_ENABLED=false the worker retains the report UID and stops that mailbox's progress with a degraded health event. This is an intentional fail-closed behavior, not a successful ingest. With capture enabled it records separate review-only evidence, audit and source digest before advancing; an existing legacy ordinary message is retained and additionally flagged for review, not rewritten. This detector is bounded and does not claim to recognize or authenticate every report.
- A temporary unavailable/ambiguous Sent LIST result no longer retires the cursor; it reports review-required and preserves progress. A uniquely identified different folder still retires the old generation. No automatic rewind.
- Subscription-derived invoices and independent drafts now consistently reject inactive legal issuers; one-time drafts require a buyer name. Registered drafts use the active preferred phone where available. Individual issuers may create drafts, but the existing officialization block remains until their template is owner-approved.
- The outbound evidence views report actual SMTP acceptance only when the server-written start and matching single 2xx acceptance audit are corroborated. Mock, missing, duplicate and truncated histories are not represented as recipient delivery. Raw audit details are in Advanced. The resend backend remains authoritative.
- Verified at source commit 9c634a81: 10 isolated Node contracts passed (5 report capture, including the new header bound, and 5 SMTP audit summary). All four tested source/test blobs match Git exactly. New Nest and invoice regression fixtures remain unexecuted; no dependency install, workspace build, full Jest, physical DB check or actual provider access was performed. No additional migration in this pass.

### Before enabling operational mail

Keep MAIL_WORKERS_PAUSED=true in both API and worker during initial deployment and acceptance. Because disabled report capture deliberately stops a recognized report UID instead of classifying or skipping it, enable and verify P2_DSN_REVIEW_CAPTURE_ENABLED and P2_ACTION_QUEUE_ENABLED together on the designated mailbox after the schema and isolated DB/browser checks, before the owner authorizes normal mail processing. If these features remain disabled, keep mail paused or accept the documented per-mailbox review stop; never bypass this guard by advancing the cursor manually. P2_SENT_OBSERVATION_ENABLED remains independently gated. Review-only evidence is not authenticated DSN proof. The independently verified provider delivery/hard-bounce adapter remains an open requirement, and the personal official invoice template remains owner-dependent. A maintenance-mode release candidate can be fetched without resolving those external dependencies, but this does not waive their acceptance requirements.

No live deployment, main merge, provider calls, database access, migration execution, or SMTP send was performed by this programming pass.
