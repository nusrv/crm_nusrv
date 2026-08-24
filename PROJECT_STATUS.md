# Project Status

## Current status

- Phase 0: COMPLETE / APPROVED
- Phase 1: COMPLETE / APPROVED
- Phase 2: COMPLETE / APPROVED (2026-08-24)
- Staging Runtime Gate: BLOCKED - awaiting deployment/access to crm.nusrv.com
- Phase 3: LOCKED / awaiting owner authorization after the staging gate
- Phase 4+: LOCKED

## Staging CAPTCHA deployment patch

The internal staff-only Control Panel supports `CAPTCHA_PROVIDER=none` in production. Login then
requires only email and password; credential validation, lockout, secure cookies, origin/CSRF
protection, RBAC, and audit behavior remain unchanged. Turnstile and reCAPTCHA retain credential
validation, and mock CAPTCHA remains prohibited in production.

Verification on Node.js 22.23.2 passed: 93 automated tests across 29 suites, lint, formatting,
strict typecheck, NestJS production build, and Next.js production build. The 10 guarded live
MariaDB tests remain excluded from the default suite and were not rerun for this schema-neutral
patch.

## Phase 2 final workflow-hold correction

The renewal engine evaluates every active, unexpired hold for a Renewal Case. Customer reminder
suppression and internal notification suppression are aggregated independently with `some(...)`.
Released and expired holds are ignored. Deduplicated hold decisions use sorted category-relevant
hold IDs and include those IDs in sanitized audit metadata.

Verification passed:

- Focused hold/policy tests: 21/21
- Guarded MariaDB 11.7.2 suites: 10/10
- Default automated suite: 83/83 across 27 suites; the 10 guarded live tests are skipped by default
- Prisma generation, lint, formatting, strict typecheck, NestJS build, and Next.js build: passed

Phase 2 is approved. No Phase 3 code or integration was started.

## Staging readiness prepared

- Staging configuration validates `APP_URL`, web/API URLs, MariaDB, business timezone, secrets,
  optional CAPTCHA (disabled for the internal staging CP), and either Redis URL or granular
  host/port/username/password/database/TLS settings.
- The renewal worker has a separate non-HTTP NestJS entry point and no longer runs inside the API
  process. The API registers the daily scheduler and accepts the Admin manual trigger; the
  independently supervised worker consumes the same BullMQ queue.
- Staging environment, host-inspection, systemd API/web/worker examples, and a Plesk deployment
  runbook are provided under `deploy/staging/` and `docs/deployment/`.
- SMTP, IMAP, SmarterMail synchronization, LLM, Fawtara, collection, retention, suspension,
  reactivation, technical provider actions, MCP, and customer reply handling remain absent/locked.

## Staging Runtime Gate blocker

The staging target is crm.nusrv.com on Plesk 18.0.80 with Node.js 22.23.2, MariaDB 11.4.7, and
Redis 7.4.11. No SSH/Plesk deployment access, staging database credentials, or Redis runtime
access is available in the current environment. Therefore the following cannot truthfully be verified yet:

- server OS, Node.js Toolkit state, SSH privilege, or Plesk document-root configuration
- dedicated staging database/user, grants, connectivity, trigger support, or Redis availability
- SSH privilege level, systemd/process-supervisor access, Plesk document roots, TLS, or staging DNS
- migration/seed execution on Plesk, Redis readiness, persistent worker, or registered scheduler
- deployed UI/API health, staging milestone/outbox/idempotency behavior, RBAC, or security smoke tests

The gate remains `BLOCKED`, not failed. The application has not been deployed and no server-side
claim is made.

## Required owner/server-admin action

Provide authorized SSH/Plesk deployment access for crm.nusrv.com, or have the server administrator run
`deploy/staging/inspect-plesk-host.sh` with `STAGING_DOMAIN` set and return its output. The configured application runtime is Node.js 22.23.2. Also provide or provision a
dedicated MariaDB 10.6+ staging database/user and private authenticated Redis accessible to the API
and independent worker. Actual secrets must remain in Plesk/server configuration and must not be
committed.

## Integration status

- MariaDB: migrations/live tests pass locally on MariaDB 11.7.2; Plesk staging execution blocked
- Redis/BullMQ: scheduler/worker code and tests pass; real staging Redis/runtime blocked
- Communication outbox: durable queue records only; no delivery transport
- Technical Connections: secure configuration/mapping only; no external provider calls
- Phase 3 integrations: locked and not started

## Next allowed work

Resume only the Phase 02 staging runtime gate after authorized server access/environment inventory
is supplied. Phase 3 remains locked until explicit owner authorization.
