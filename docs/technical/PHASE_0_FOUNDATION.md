# Phase 0 Technical Foundation

## Workspace structure

The repository is an npm workspace and a modular monolith:

```text
apps/api/                 NestJS application and all backend modules
  prisma/                 canonical Prisma schema, migrations, and seed
  src/audit/              append-only audit writer
  src/database/           Prisma lifecycle provider
  src/identity/           authentication, CAPTCHA, JWT sessions, and RBAC
  src/modules/            core domain module boundaries
  src/queue/              Redis and BullMQ connection foundation
  src/security/           authenticated encryption and masked serialization
apps/web/                 Next.js application and authenticated shell
packages/shared/          contracts used by both applications
docs/technical/           implementation and operations documentation
```

There is one deployable backend and one frontend. Domain modules are not independently deployed.
Prisma is owned only by `apps/api/prisma`.

## Local setup

Prerequisites:

- Node.js 22 LTS or newer supported LTS (`.nvmrc` selects 22)
- npm 10 or newer
- MariaDB 10.6 or newer
- Redis
- Docker Compose is optional but is the simplest local service setup

From the repository root:

```bash
cp .env.example .env
docker compose up -d mariadb redis
npm ci
npm run db:generate
npm run db:migrate:deploy
npm run db:seed
npm run dev
```

Generate secrets before starting. Examples:

```bash
openssl rand -base64 32
openssl rand -hex 32
```

Use the base64 value for `ENCRYPTION_KEY_BASE64` and distinct random values of at least 32
characters for each JWT secret. Never commit `.env`.

The API defaults to `http://localhost:3001/api/v1`; the frontend defaults to
`http://localhost:3000`. The root `npm run dev` starts both.

## Environment configuration

| Variable                                   | Purpose                                                        |
| ------------------------------------------ | -------------------------------------------------------------- |
| `DATABASE_URL`                             | Prisma `mysql://` URL for the MariaDB database                 |
| `REDIS_URL`                                | Redis connection URL used by BullMQ and readiness checks       |
| `WEB_URL` / `API_URL`                      | CORS/origin boundary and service URL                           |
| `NEXT_PUBLIC_API_URL`                      | Browser-visible API base URL                                   |
| `JWT_ACCESS_SECRET`                        | Short-lived access-token signing secret                        |
| `JWT_REFRESH_SECRET`                       | Separate refresh-token signing secret                          |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL`       | Token lifetimes such as `15m` and `7d`                         |
| `ENCRYPTION_KEY_BASE64`                    | Exactly 32 random bytes, base64 encoded                        |
| `CAPTCHA_PROVIDER`                         | `mock`, `turnstile`, or `recaptcha`                            |
| `CAPTCHA_TEST_TOKEN`                       | Non-production mock token; forbidden as a production mechanism |
| `CAPTCHA_SITE_KEY` / `CAPTCHA_SECRET`      | Required for a non-mock CAPTCHA provider                       |
| `*_MODE`                                   | Future integration guard; defaults to `mock`                   |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | Optional initial development administrator                     |

Configuration is validated before application startup. Production refuses mock CAPTCHA. The future
integration modes do not activate any integrations in Phase 0.

## Database operations

```bash
npm run db:generate
npm run db:migrate       # creates/applies development migrations
npm run db:migrate:deploy
npm run db:seed
```

The seed is idempotent. It upserts the two billing entities, six service types, and five roles. An
initial administrator is created only when both optional seed variables are present; its password is
Argon2-hashed.

## Tests and quality commands

```bash
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run build
npm run format:check
```

The local migration-contract suite validates the Prisma `mysql` mappings, complete zero migration,
foreign keys, uniqueness, JSON, decimals, dates, UUID strings, IPv4/IPv6 storage, and MariaDB audit
triggers without pretending to run a database server. The opt-in live suite requires
`MARIADB_TEST_DATABASE_URL` pointing to a disposable `*_test` database; it applies the migration from
zero and exercises these guarantees through Prisma and MariaDB. See ADR-003.

## Redis and BullMQ

`QueueFoundationModule` configures BullMQ from `REDIS_URL` with bounded attempts, exponential
backoff, and bounded retained job history. It intentionally registers no business queues or workers in
Phase 0. `RedisConnectionService` uses a lazy, bounded connection for readiness checks. Run Redis
locally with `docker compose up -d redis` or provide a compatible managed endpoint.

## Health endpoints

- `GET /api/v1/health/live` confirms the process is responding.
- `GET /api/v1/health/ready` checks MariaDB through Prisma and checks Redis.

Responses contain only `up`/`down` component states. Connection strings, hosts, credentials, and raw
errors are never returned.

## Reproducibility note for synchronized drives

Some virtual/synchronized filesystems cannot reliably hold a large `node_modules` tree. If npm emits
repeated `EBADF` or archive write errors, keep the repository in version control but perform the
checkout and `npm ci` on a local Linux/Windows filesystem for development and deployment.
