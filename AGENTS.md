# AGENTS.md
## Permanent Instructions for Codex

These instructions apply to every implementation task in this repository.

## 1. Product contract

Build a Customer Subscription Lifecycle Control Panel for managing:
- customers,
- billable subscriptions/services,
- renewal dates,
- reminder emails,
- inbound customer replies,
- AI-assisted reply classification,
- official invoicing through Jordan Fawtara,
- payment collection follow-up,
- internal approvals,
- retention workflow,
- service-specific suspension/reactivation,
- Plesk,
- SmarterMail,
- manual technical actions,
- audit history.

This is not a general CRM.

## 2. Non-negotiable business rules

1. Renewal reminder milestones: 30, 21, 14, 7, 2 days before expiry.
2. On expiry date send a final warning: service is subject to suspension after 24 hours.
3. Internal escalation recipients are configurable.
4. Customer reply changes the workflow; do not continue normal renewal reminders after a classified reply.
5. Accepted renewal:
   - create invoice draft,
   - accountant reviews/publishes,
   - official Fawtara submission occurs,
   - invoice is sent with the billing entity bank details,
   - collection workflow begins,
   - payment confirmation is ultimately human-controlled,
   - renewal case becomes fulfilled.
6. Rejected renewal:
   - start retention workflow,
   - notify/assign internal Sales Development, IT, and management as configured,
   - if retention fails, mark do-not-renew,
   - suspension becomes due only after expiry + 24 hours.
7. Services are normally externally auto-renewed unless intentionally stopped. The CP's critical technical automation is mainly suspension/reactivation and status control.
8. Suspension requires IT authorization before execution.
9. Never automatically delete customer data, domains, Plesk subscriptions, mailboxes, or server resources.
10. Customer “payment sent” email means PAYMENT_REPORTED, not PAYMENT_CONFIRMED.
11. One customer belongs to one billing/legal entity.
12. Initial billing entities:
    - New Serve for Digital Data Transformation — local payments.
    - Future foresight for Digital Data Transformation — international payments.
13. Each customer can own multiple subscriptions with independent dates.
14. Each subscription can map to zero, one, or many technical connections.
15. A technical connection can be Plesk, SmarterMail, a future API provider, or Manual.
16. Do not suspend unrelated services. Example: an SSL-only non-renewal must not blindly suspend hosting/email.
17. Every legal, financial, workflow, approval, email, and technical action must have an audit event.

## 3. Locked implementation stack

Unless the owner explicitly changes it, use:

- Node.js on a currently supported LTS release
- TypeScript in strict mode
- NestJS backend
- Next.js + React + Tailwind CSS frontend
- MariaDB
- Prisma ORM
- Redis + BullMQ for queues/background workers
- NestJS scheduling where appropriate
- Direct LLM API integration inside the CP
- MCP only as an optional later external interface

Do not initialize Laravel/PHP.
Do not downgrade to an obsolete Node/NestJS/Next.js line to match an old local runtime. Report the runtime prerequisite instead.

## 4. Architecture rules

- Use a modular monolith.
- Separate domain/business logic from external integrations.
- External systems are behind adapters/interfaces.
- The workflow/state transition service owns business transitions.
- Controllers/UI must not directly mutate critical statuses.
- Background jobs must be idempotent.
- Use database transactions around critical transitions.
- Use outbox/queued delivery patterns where duplicate emails/actions would be harmful.
- Never place secrets in source control.
- Never log full API secrets, passwords, tokens, or sensitive Fawtara credentials.

## 5. AI safety rules

The LLM is an interpreter/assistant, not the authoritative workflow engine.

The LLM may:
- classify inbound customer intent,
- summarize messages,
- extract requested changes,
- suggest a reply,
- detect likely payment-reported statements,
- detect ambiguity.

The LLM must not directly:
- publish a Fawtara invoice,
- confirm money received,
- suspend/reactivate services,
- change prices,
- approve discounts,
- execute Plesk/SmarterMail actions,
- make binding commercial commitments.

All LLM output must conform to a strict structured schema and be validated before use.

## 6. External API rules

Until explicit production credentials are configured:
- use mock/sandbox adapters,
- never make destructive production calls,
- provide `test connection` functionality,
- support retry with bounded attempts,
- log request outcome without logging secrets,
- surface failures into an Action/Error Queue.

## 7. Development rules

For each phase:
- write migrations,
- write domain/service tests,
- write permission tests,
- write idempotency tests for jobs,
- add factories/seeders for demo/test data,
- do not implement future phases prematurely.

Do not refactor unrelated completed areas unless necessary.

## 8. Required project status

Maintain `PROJECT_STATUS.md` with:
- current phase,
- completed acceptance criteria,
- open defects,
- deferred items,
- integration status,
- next allowed phase.

If the file does not exist, create it in Phase 0.
