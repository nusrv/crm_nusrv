# ADR-001 — Technology Stack

## Status

Accepted

## Decision

The Customer Subscription Lifecycle Control Panel will use:

- Node.js on a currently supported LTS release
- TypeScript
- NestJS backend
- Next.js + React + Tailwind CSS frontend
- MariaDB
- Prisma ORM
- Redis + BullMQ
- Direct LLM API integration inside the CP
- Optional MCP interface in a later phase

## Context

The application combines:

- CRUD/admin workflows,
- scheduled/background processing,
- asynchronous email ingestion,
- API-heavy integrations,
- LLM classification,
- future MCP interoperability,
- strong type contracts across frontend/backend.

A TypeScript stack provides a consistent language across the application and fits the event/integration-heavy roadmap well.

## Consequences

- Laravel/PHP is not part of the implementation.
- Do not choose an obsolete framework version to accommodate an old local runtime.
- External integrations remain behind adapter interfaces.
- MCP remains optional and must not become a dependency of the internal CP workflow engine.
