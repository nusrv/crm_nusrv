# Phase 02 Plesk staging runbook

Target staging runtime: `crm.nusrv.com`, Plesk 18.0.80, Node.js 22.23.2, and MariaDB 11.4.7.
The deployment source is the GitHub repository.

This runbook deploys only the approved Phase 0-2 application. It does not enable SMTP, IMAP,
SmarterMail synchronization, LLM calls, Fawtara, collection, retention, suspension, or any other
Phase 3+ integration.

## 1. Required host inventory

Do not deploy until the server administrator has provided an SSH target and a staging hostname. On
the host, run:

```bash
STAGING_DOMAIN=crm.nusrv.com bash deploy/staging/inspect-plesk-host.sh
```

Record the OS, Plesk version, Plesk Node.js Toolkit state, installed Node versions, MariaDB version,
Redis version/listen address, SSH user privileges, systemd availability, subscription system user,
document root, certificate state, and staging DNS result. Node.js must be 22.12 or newer; do not
downgrade the application to fit an older server. MariaDB must be 10.6 or newer.

## 2. Topology and directories

Keep three separately supervised Node processes:

```text
HTTPS browser -> Next.js web :3000 -> NestJS API :3001 -> MariaDB
                                            |       -> Redis/BullMQ
                                            + scheduler registration
Redis/BullMQ -> independent renewal worker -> RenewalEngineService -> MariaDB/outbox
```

Recommended layout under the Plesk subscription system user:

```text
/var/www/vhosts/DOMAIN/customer-cp/
  releases/20260824-001/     immutable application release
  current -> releases/...    active release symlink
  shared/staging.env         mode 0600, outside document root
  shared/log/                only when journald is unavailable
```

The public Plesk document root must not contain `staging.env`, source credentials, database dumps,
or Redis configuration. Configure Plesk/reverse proxy routes so the staging web hostname reaches
port 3000 and the API hostname reaches port 3001. Issue valid HTTPS certificates for both hostnames.

## 3. Environment

Copy `deploy/staging/.env.staging.example` to the secured server-side environment path and replace
every placeholder. Never commit the completed file. Required settings include `NODE_ENV`,
`APP_URL`, `WEB_URL`, `API_URL`, `NEXT_PUBLIC_API_URL`, `DATABASE_URL`, Redis URL or host settings,
`BUSINESS_TIMEZONE`, JWT/session secrets, and the encryption key. This internal staff-only CP uses
`CAPTCHA_PROVIDER=none`; no CAPTCHA keys or test token are configured.

Keep these Phase 3+ switches disabled:

```text
AI_ENABLED=false
SMTP_MODE=mock
FAWTARA_MODE=mock
PLESK_MODE=mock
SMARTERMAIL_MODE=mock
```

Generate secrets on the host with an approved secret manager or OS cryptographic tool. URL-encode
special characters embedded in `DATABASE_URL` or `REDIS_URL`. Restrict the environment file to the
application system user (`chmod 600`).

## 4. MariaDB

Create a dedicated staging database and user. Use `utf8mb4` with a conservative collation supported
by the installed MariaDB release. Grant schema migration privileges, including `CREATE`, `ALTER`,
`INDEX`, `REFERENCES`, and `TRIGGER`, but do not grant global administrative access.

From the release directory, with the secured environment loaded:

```bash
npm ci
npm run db:generate
npm run db:migrate:deploy
npm run db:seed
```

Verify Prisma reports both migrations as applied:

```text
20260823000000_mariadb_phase_0_1_foundation
20260824000000_phase_2_renewal_engine
```

Run the guarded suite only against a separate disposable database ending `_test`:

```bash
MARIADB_TEST_DATABASE_URL='mysql://.../customer_lifecycle_cp_staging_test' npm run test:db:mariadb
```

Verify foreign keys, the audit update/delete rejection triggers, and application connectivity. Do
not point the guarded reset suite at the staging application database.

## 5. Redis

Use a stable Redis release supported by BullMQ. Bind Redis to localhost or a private network, enable
authentication/ACLs, block public ingress, and configure persistence and memory policy appropriate
for a durable job queue. Do not use an in-memory substitute.

Verify from the application account without printing credentials:

```bash
redis-cli -h 127.0.0.1 --no-auth-warning PING
ss -lnt | grep 6379
```

If Redis is absent and SSH lacks package-administration permission, the server administrator must
install and secure Redis before the gate can pass.

## 6. Build and processes

Use Node.js 22.12+ selected by Plesk Node.js Toolkit or the explicit `/opt/plesk/node/22/bin`
binaries. Build once per release:

```bash
npm ci
npm run db:generate
npm run build
```

The API process starts `apps/api/dist/main.js`. The worker is intentionally separate and starts
`apps/api/dist/worker-main.js`; it does not depend on HTTP traffic. The web process runs the built
Next.js application.

When root/systemd administration is available, customize and install the templates in
`deploy/staging/systemd/`:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now customer-cp-api customer-cp-web customer-cp-worker
sudo systemctl status customer-cp-api customer-cp-web customer-cp-worker
sudo systemctl restart customer-cp-api customer-cp-web customer-cp-worker
sudo systemctl stop customer-cp-api customer-cp-web customer-cp-worker
```

Use Plesk Node.js Toolkit for web/API supervision only when it supports distinct persistent apps.
The renewal worker still requires a reliable independent supervisor. Interactive SSH shells and
HTTP keep-alive requests are not acceptable supervisors.

## 7. Health and scheduler verification

After startup, verify:

```bash
curl --fail --silent https://api-cp-staging.example.com/api/v1/health/live
curl --fail --silent https://api-cp-staging.example.com/api/v1/health/ready
systemctl is-active customer-cp-worker
journalctl -u customer-cp-worker -n 100 --no-pager
```

For this host, proxy `/api` on `crm.nusrv.com` to the NestJS API while other application
paths reach Next.js; the browser API base remains `https://crm.nusrv.com`.

Readiness must report MariaDB and Redis as `up` without returning connection strings. Confirm in
Redis/BullMQ that queue `renewal-evaluation` contains scheduler `daily-renewal-evaluation`, job name
`evaluate-renewals`, pattern `0 5 0 * * *`, and timezone `Asia/Amman` (or the configured business
timezone).

Do not wait until midnight. Log in as Admin and use the existing manual evaluation control. Confirm
the path Admin request -> BullMQ -> independent worker -> RenewalEngineService -> MariaDB ->
Communication Outbox. No email transport should run.

## 8. Safe staging data and idempotency

Through the authenticated UI, create only `.invalid`/`.test` contacts and clearly named records:

- `STAGING CUSTOMER - D30`
- `STAGING CUSTOMER - D21`
- `STAGING CUSTOMER - D14`
- `STAGING CUSTOMER - D7`
- `STAGING CUSTOMER - D2`
- `STAGING CUSTOMER - D0`

Set renewal dates relative to the `Asia/Amman` business date. Exercise a customer-only hold, an
internal-only hold, both simultaneous holds, an expired hold, a released hold, and two holds for the
same category.

Record Renewal Case, outbox, decision, and audit counts. Trigger evaluation twice sequentially and
then twice concurrently. Confirm one case per subscription/due date, one communication per
milestone/audience/recipient, deduplicated material decisions, no state corruption, and suppression
aggregated across all effective holds.

## 9. UI, RBAC, and security smoke checks

Exercise Admin, IT, Accountant, Sales Development, and Management accounts through HTTPS. Verify
login, dashboard, customers, subscriptions, renewals, settings, outbox, holds, and the Admin manual
trigger. Technical Connection list/detail must return success only for Admin/IT and denial for all
other representative roles. Credentials must remain masked.

Also verify secure cookies, origin enforcement, lockout, the approved disabled-CAPTCHA setting,
sanitized health responses, absence of secrets in API responses/logs, private database/Redis network
access, and no real customer communication.

## 10. Logs, updates, and rollback

Use distinct journald identifiers for API, web, and worker. Inspect with:

```bash
journalctl -u customer-cp-api -f
journalctl -u customer-cp-web -f
journalctl -u customer-cp-worker -f
```

Logs must never contain database/Redis URLs, passwords, encryption/JWT secrets, or Technical
Connection credentials.

For an update, create a new release directory, run `npm ci`, Prisma generation, tests/build, and
`prisma migrate deploy`; then atomically repoint `current` and restart all three processes. Database
migrations are forward-only. Roll back application code by repointing `current` to the prior release
only when its schema is compatible. Restore databases only from an authorized verified backup; do
not use destructive Prisma reset commands on staging.
