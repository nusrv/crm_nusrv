# Codex Prompt — Phase 0: Node.js/NestJS Foundation and Architecture

Before coding:
1. Read `AGENTS.md`.
2. Read `01_MASTER_PLAN.md`.
3. Read all architecture documents relevant to this phase.
4. Inspect the current repository and `PROJECT_STATUS.md`.
5. Preserve completed functionality.
6. Implement ONLY this phase. Do not implement later-phase features.
7. Use mocks/sandbox adapters for external systems unless explicit non-production credentials are already configured.
8. Add automated tests.
9. Update `PROJECT_STATUS.md`.
10. Finish with an implementation report and acceptance checklist.


## Goal

Establish a production-quality TypeScript project foundation and the core domain schema without implementing business automation from later phases.

## Locked stack

- Node.js on a currently supported LTS release
- TypeScript strict mode
- NestJS backend
- Next.js + React + Tailwind CSS frontend
- MariaDB
- Prisma ORM
- Redis + BullMQ
- NestJS scheduler where appropriate
- Jest/backend integration tests
- Linux-compatible deployment

Do not initialize Laravel/PHP.

If the local Node.js runtime is too old for the supported NestJS/Next.js versions you intend to use, stop and report the required runtime upgrade. Do **not** solve that by selecting an obsolete framework release.

## Aborted Laravel scaffold

An earlier attempt may have created a directory named `.phase0-laravel`.

Before changing it:
1. inspect it,
2. confirm it contains only the aborted standard Laravel scaffold/dependencies and no user-authored CP implementation,
3. if confirmed, it may be removed as cleanup,
4. if anything non-standard/user-authored exists, do not delete it; report it.

Do not modify the planning/source documents during this cleanup.

## Tasks

1. Initialize a clean TypeScript workspace/monorepo using a standard lightweight workspace mechanism.
2. Create:
   - `apps/api` as the NestJS backend
   - `apps/web` as the Next.js frontend
   - `packages/shared` only for genuinely shared TypeScript contracts/types
3. Enable strict TypeScript configuration and consistent lint/format tooling.
4. Configure environment validation for:
   - MariaDB
   - Redis
   - application URLs/secrets
   - future integration placeholders
5. Configure Prisma against MariaDB.
6. Configure Redis/BullMQ foundations, but do not create renewal/business jobs yet.
7. Configure the authentication foundation, authorization/RBAC framework, CAPTCHA abstraction/configuration, secure session/token strategy, and MFA-ready structure.
8. Create backend modules/domain foundations for:
   - BillingEntity
   - Customer
   - ServiceType
   - Subscription
   - TechnicalConnection
   - SubscriptionConnection
   - RenewalCase
   - Audit
9. Create Prisma models/migrations for the Phase 0 core entities defined in `02_ARCHITECTURE_AND_DATA_MODEL.md`.
10. Seed:
    - the two initial BillingEntities,
    - ServiceTypes: Domain, SSL, Hosting, Dedicated Server, Support, Antivirus,
    - roles: Admin, Accountant, IT, Sales Development, Management.
11. Implement an AuditService used by future application services.
12. Implement encrypted-secret handling for TechnicalConnection credentials:
    - encrypted at rest,
    - masked when serialized,
    - never logged.
13. Create factories/fixtures/test helpers for core domain data.
14. Create a minimal authenticated frontend shell sufficient to prove frontend↔backend foundation and RBAC navigation structure; do not build Phase 1 CRUD screens.
15. Add backend health endpoint(s) for application/database/Redis foundation without exposing secrets.
16. Add technical documentation under `docs/technical/` describing:
    - workspace structure,
    - local setup,
    - environment variables,
    - database migration/seed commands,
    - test commands,
    - queue/Redis setup,
    - architecture decisions actually implemented.
17. Initialize Git if the directory is not already a repository, unless the environment/workspace policy explicitly prevents it.
18. Ensure clean install/start/test commands are reproducible from the repository root.

## Do not implement

- real renewal reminders
- customer email synchronization
- LLM calls
- Fawtara
- payment workflow
- retention workflow
- suspension/reactivation execution
- production Plesk/SmarterMail adapters
- Phase 1 legacy import UI
- general CRM functionality

## Acceptance criteria

Phase 0 is complete only when:

- workspace installs from a clean checkout
- NestJS API boots
- Next.js frontend boots
- MariaDB configuration is environment-driven
- Prisma migrations run from zero
- seed command creates required billing entities/service types/roles
- Redis/BullMQ connection foundation is testable
- authentication foundation works
- authorization/RBAC tests pass
- core Prisma relations are covered by tests
- secrets are encrypted/masked and absent from normal serialized responses/logs
- AuditService has automated tests
- health endpoint does not leak sensitive configuration
- lint/type-check/tests pass
- no later-phase business automation has been implemented
- `PROJECT_STATUS.md` marks Phase 0 complete and Phase 1 available

At completion, stop. Do not start Phase 1.
