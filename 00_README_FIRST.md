# Customer Subscription Lifecycle Control Panel
## Codex Build Pack — Read This First

This folder is the source-of-truth documentation for building the Customer Subscription Lifecycle Control Panel (CP).

The product is intentionally **not a CRM**. Its responsibility is:

> Customer → Subscription → Renewal Case → Communication → Invoice → Collection → Approval → Technical Action → Audit

## Source material

The business requirements came from:
- `must answer2.txt` — confirmed operational answers.
- `Project monitoring report.xls` — legacy customer/service tracking workbook to be migrated/normalized.

Do not treat the Excel workbook as the future operational database. It is a migration/import source.

## Recommended build approach

Build in strict phases. Do **not** ask Codex to implement the whole system in one pass.

Read order:

1. `AGENTS.md`
2. `01_MASTER_PLAN.md`
3. `02_ARCHITECTURE_AND_DATA_MODEL.md`
4. `03_WORKFLOWS_AND_STATE_MACHINE.md`
5. `04_INTEGRATIONS.md`
6. `05_AI_LLM_MCP_STRATEGY.md`
7. `06_SECURITY_RBAC_AUDIT.md`
8. `07_ACCEPTANCE_AND_TESTING.md`
9. Run exactly one prompt from `PHASES/`

## Locked technical baseline

The implementation stack is now fixed. Do not substitute another framework merely because the local machine has an older runtime installed.

- Architecture: modular monolith with a TypeScript monorepo/workspace
- Runtime: a currently supported Node.js LTS release
- Language: TypeScript with strict type checking
- Backend: NestJS
- Frontend: Next.js + React + Tailwind CSS
- Primary database: MariaDB
- ORM: Prisma
- Queue/cache: Redis
- Background work: BullMQ workers/queues plus NestJS scheduling where appropriate
- Authentication: secure application accounts with MFA-ready capability
- CAPTCHA on login
- API secrets: encrypted at rest; never plain text
- Backend tests: Jest (or NestJS-supported equivalent) + integration/e2e tests
- Frontend tests: component/feature tests as appropriate; Playwright for critical end-to-end flows when introduced
- External integrations: adapter interfaces with sandbox/mock mode
- Deployment target: Linux-compatible Node.js environment

Preferred repository layout:

```text
/
├── apps/
│   ├── api/        # NestJS backend
│   └── web/        # Next.js frontend
├── packages/
│   ├── shared/     # shared TypeScript contracts/types where justified
│   └── config/     # shared lint/tsconfig configuration where justified
├── docs/
├── PHASES/
└── ...
```

Use npm workspaces, pnpm workspaces, or an equivalent standard workspace approach; choose one and document it. Do not introduce Nx/Turborepo unless it solves an actual need rather than adding tooling for its own sake.

Do not introduce microservices unless a later requirement proves they are necessary.

If the machine's Node.js version is too old for the selected supported NestJS/Next.js releases, stop and report the runtime prerequisite instead of downgrading the project to an obsolete framework line.

## Phase discipline

Every phase must:

1. Inspect the existing repository first.
2. Re-read `AGENTS.md` and the relevant architecture documents.
3. Implement only the requested phase.
4. Add migrations and tests for the phase.
5. Preserve backward compatibility with completed phases.
6. Never execute destructive calls against real customer systems during development.
7. Use mock/sandbox adapters until credentials and explicit production configuration are supplied.
8. Update `PROJECT_STATUS.md`.
9. Finish with a concise implementation report:
   - What changed
   - Files changed
   - Migrations
   - Tests run
   - Remaining known issues
   - Whether phase acceptance criteria pass

## Product principles

- Automation prepares and coordinates; critical legal/financial/technical actions have human gates.
- Customer acceptance may trigger invoice preparation, but the accountant publishes the official invoice.
- A customer saying “I paid” does not equal confirmed payment.
- A subscription is not the same thing as a technical server connection.
- Suspension is service-specific, never “suspend the entire customer” blindly.
- No automatic deletion.
- All meaningful actions are auditable.
- The workflow engine is the heart of the product; the UI should remain simple.
