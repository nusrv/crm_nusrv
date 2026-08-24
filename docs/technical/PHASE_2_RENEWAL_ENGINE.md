# Phase 2 — Renewal Engine and Notifications

## Runtime configuration

`BUSINESS_TIMEZONE` is an IANA timezone and defaults to `Asia/Amman`. Redis must be available through
`REDIS_URL` for the BullMQ scheduler, worker, and Admin manual trigger. MariaDB remains the durable
source of truth.

The worker registers this scheduler:

```text
queue: renewal-evaluation
job: evaluate-renewals
schedule: 00:05 daily in BUSINESS_TIMEZONE
```

`POST /api/v1/renewal-engine/run` is Admin-only and queues the same evaluation path. It does not run
the engine in the HTTP request and it does not send email.

## Evaluation behavior

For active subscriptions due within the largest enabled rule window, the worker:

1. creates or locates the unique Renewal Case for subscription plus due date;
2. calculates calendar days remaining in the configured business timezone;
3. selects enabled customer and internal rules for that day;
4. stops on ineligible workflow states or effective holds;
5. renders allowlisted renewal templates;
6. inserts durable outbox records with stable unique idempotency keys;
7. writes linked append-only audit events;
8. records deduplicated material skip/duplicate decisions.

The six seeded customer milestones are D-30, D-21, D-14, D-7, D-2, and D0. The D0 body explicitly
states that the service is subject to suspension after 24 hours. Phase 2 never schedules or executes
suspension.

Internal defaults are D-2 to active IT users and D0 to active IT and Management users. Admins can
configure role recipients, additional email addresses, hold suppression, and enablement. No real
transport is attached.

## HTTP surfaces and RBAC

- `GET /renewal-cases` and `GET /renewal-cases/:id`: authenticated operational roles.
- Hold/release: Admin, Accountant, IT, and Sales Development.
- `GET /renewal-configuration`: authenticated operational roles.
- Reminder/template/notification changes: Admin only.
- `GET /communication-outbox`: authenticated operational roles.
- `POST /renewal-engine/run`: Admin only.
- Technical Connection list/detail remain Admin/IT only.

## Verification

The normal test suite covers policy, timezone boundaries, templates, RBAC, holds, configuration
audit, BullMQ scheduling/manual jobs, worker execution, and migration contracts. The guarded live
suite requires `MARIADB_TEST_DATABASE_URL` ending in `_test`; it resets only that database, applies
both migrations from zero, and tests all milestones, repeated/concurrent execution, holds,
ineligible/inactive records, renewal-date changes, outbox uniqueness, and audit behavior.

Before deployment, run a live Redis smoke test and supervise both the API process and BullMQ worker.
No SMTP/IMAP credentials are used in Phase 2.
