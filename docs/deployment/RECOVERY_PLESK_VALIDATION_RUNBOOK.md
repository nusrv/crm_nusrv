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

## 2. Source checks before database changes

Use a clean shell and no reachable production services. Set only test values; review environment files for connection overrides before running commands.

```bash
set -e
export NODE_ENV=test SMTP_MODE=mock IMAP_MODE=mock AI_PROVIDER=mock
export P2_ACTION_QUEUE_ENABLED=false P2_DSN_REVIEW_CAPTURE_ENABLED=false
unset MARIADB_TEST_DATABASE_URL MARIADB_TEST_SUITE_URLS
unset MARIADB_PHASE4_TEST_DATABASE_URL MARIADB_BRANDING_TEST_DATABASE_URL
export DATABASE_URL='mysql://example:example@127.0.0.1:3306/unconnected_ci'
export JWT_ACCESS_SECRET='validation-only-access-not-a-production-secret'
export JWT_REFRESH_SECRET='validation-only-refresh-not-a-production-secret'
export ENCRYPTION_KEY_BASE64='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
npm ci --no-audit --no-fund
npm run db:generate
(cd apps/api && ../../node_modules/.bin/prisma validate)
npm run typecheck
npm run lint
npm run test -w @cp/api
npm run build
```

Run all explicit Node and renderer checks in `.github/workflows/p1-recovery-validation.yml`, including review capture, launcher isolation and invoice/receipt rendering. Both GitHub workflows remain manual-only; alternatively execute their documented commands on the isolated checkout. Preserve complete test output and compare actual pass/fail/skip counts. Any compile, schema, Jest, lint or build failure blocks further release acceptance. Standalone contracts do not replace these checks.

## 3. Fresh disposable MariaDB rehearsal

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

## 4. Twelve independent historical fixtures

Do NOT run the old combined legacy suite against one database. Each fixture owns an initially empty `nusrv_legacy_<suite>_test` schema with dedicated credentials restricted to it. Required suite IDs: core, phase2, phase21, subscription_backfill, subscription_sequence_delete, phase3a, phase3b, phase3c, phase3d, phase3e, phase4, branding.

For each suite set DATABASE_URL and MARIADB_TEST_DATABASE_URL to the identical approved URL, then run:
```bash
npm run test:db:mariadb -w @cp/api -- --suite phase3c
```
Replace phase3c with the intended suite ID. Launcher preflights schema emptiness; do not pre-migrate these legacy fixtures. Do not reuse a failed/timed-out schema until it has been explicitly disposed of and recreated by the test DB administrator. Previous combined run (8 passed / 98 failed) was not an acceptance result; twelve isolated executions remain mandatory.

## 5. Populated upgrade and application acceptance

Use a separate restored copy of the current deployed database on a controlled test server, with non-production grants and no running old workers, not the fresh/legacy fixture databases. Inventory applied migration IDs and schema drift; verify backup and restore, before/after record counts and financial balances. Apply checked-in pending migrations only to the copy using migrate deploy. Verify constraints, triggers, receipts, invoices, QR history, renewal transitions and audit retention. Never use migrate dev, migrate reset, db push or unconditional seed on a populated target.

Use isolated Redis and credentials for any subsequent app smoke test. Verify authenticated browser restart, logout, role changes, old-worker fencing and queues; disable all real outbound/inbound connectors until separate approval. Compare authenticated company invoice/receipt print to approved visual references. Keep both P2 gates off on the production environment until tests pass and the owner authorizes enabling them. User-facing resolution is ADMIN-only and never resends or changes renewal decisions.

## 6. Remaining provider/activation gates (not implemented by this runbook)

- A real provider adapter must independently verify mailbox/account and exact message/recipient/attempt evidence. IMAP or DSN headers, SMTP acceptance and Sent presence alone are insufficient. Do not manufacture attestation from these fields.
- Establish a verified provider binding generation and explicitly approved fresh folder baseline; old Sent cursor is not transferable after a mailbox repoint. Complete safe scheduling/polling and real provider-bound delivery-status transitions with duplicate/replay and old-worker fencing tests. The current DSN transaction/store is not registered as a provider polling worker.
- Review-only capture is bounded, gated, and not a complete MIME/provider assurance or a confirmed bounce. Confirm actual capture, cursor replay, configuration changes including ABA/repoint races, and rollback; never silently backfill or rewind a production cursor.
- Individual/personal invoice reference and historical invoice association remain separately owner-gated. No invented personal template or historical inference.
- Before any live deployment: report exact commit, source build/test results, fresh and populated upgrade results, each legacy suite, browser/print and provider evidence, backup/restore proof, worker fencing plan and owner approval. No live deployment is authorized here.

## Evidence available at handoff

56 isolated Node contracts passed in the local Node 22.16 environment (including synthetic transaction ports, static SQL, binding/session/DSN and report-shape capture), plus 5 isolated launcher contracts. The new full workspace checks and physical MariaDB fixtures are staged, not executed at this head. No real mail, production database mutation, worker activation or main merge occurred.
