# ADR-004 — Phase 2 Deterministic Renewal Engine

## Status

Accepted for Phase 2 implementation.

## Decisions

- Renewal evaluation is a BullMQ worker concern, not an HTTP request concern. A BullMQ Job Scheduler
  registers one daily `evaluate-renewals` job at 00:05 in `BUSINESS_TIMEZONE`. The Admin-only manual
  endpoint only enqueues the same job.
- Business-day calculations use an explicit IANA timezone, defaulting to `Asia/Amman`, and an
  injectable clock. MariaDB `DATE` fields remain logical calendar dates and are not reinterpreted as
  operating-system-local timestamps.
- A renewal cycle is uniquely identified by `(subscription_id, due_date)`. The engine creates a case
  transactionally and treats a concurrent unique-key conflict as discovery of the existing case.
- The communication outbox is the durable Phase 3 transport boundary. Phase 2 renders and stores the
  recipient, subject, body, milestone, audit link, attempt metadata, and a SHA-256-derived stable
  idempotency key, but does not send email.
- Customer reminder rules use six seeded, configurable records for D-30, D-21, D-14, D-7, D-2, and
  D0. Templates accept only an allowlist of renewal fields; this is not a marketing or executable
  template system.
- Internal notification rules resolve configurable application roles and optional configured email
  addresses. Defaults are IT at D-2 and IT plus Management at D0. No personal recipient is hard-coded.
- Workflow holds are historical records with explicit customer/internal suppression policy,
  optional expiration, and audited release. They never mutate subscription renewal dates.
- Only `UPCOMING`, `REMINDER_CYCLE`, and `AWAITING_CUSTOMER` cases are eligible for ordinary renewal
  reminders. Material hold, ineligible-state, and duplicate decisions are deduplicated in a decision
  table before audit to avoid noisy repeated scan events.

## Consequences

- Database uniqueness, not an in-memory check, is the final defense against concurrent reminders.
- Redis/BullMQ must be supervised in deployment. A queue outage prevents evaluation jobs but cannot
  cause duplicate outbox records when processing resumes.
- SMTP/IMAP, delivery-state changes, inbound replies, and LLM classification remain Phase 3 work.
- No suspension or other technical action is scheduled or executed by Phase 2.
