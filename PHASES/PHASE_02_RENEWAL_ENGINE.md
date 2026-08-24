# Codex Prompt — Phase 2: Renewal Engine and Notifications

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

Implement the deterministic renewal scheduler and notification framework.

## Tasks

1. Expand RenewalCase persistence/state service.
2. Implement daily job that ensures renewal cases for active subscriptions.
3. Implement customer reminder milestones:
   - D-30
   - D-21
   - D-14
   - D-7
   - D-2
   - D0
4. Make reminder rules/templates configurable.
5. Implement message outbox/queue abstraction. In this phase a safe fake/test transport is acceptable.
6. Add internal notification rules and recipient configuration.
7. Initial escalation behavior:
   - D-2 can notify IT
   - D0 can notify IT + configured management
8. D0 customer template states suspension is possible after 24 hours.
9. Build renewal dashboard:
   - upcoming
   - awaiting customer
   - urgent
   - overdue
10. Add workflow hold feature.
11. Make all jobs idempotent.
12. Audit every scheduled/sent/skipped reminder decision.

## Critical rules

- do not send normal renewal reminders after accepted/rejected/human-review transition where the cycle is paused
- scheduler may run more than once without duplicate emails
- no suspension execution in this phase

## Acceptance criteria

Simulated dates prove each reminder fires once at the correct milestone, escalation works, holds work, and no destructive action occurs.
