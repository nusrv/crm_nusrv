# Codex Prompt — Phase 7: Reporting, Reconciliation and Production Hardening

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

Make the CP operationally trustworthy and production-ready.

## Tasks

1. Build management dashboard:
   - next 7/30-day renewals
   - awaiting customer
   - invoice drafts/publication failures
   - collecting
   - payment reported
   - overdue collection
   - retention
   - suspension due
   - failed technical actions
2. Reports:
   - renewal forecast
   - collection
   - fulfilled/lost renewals
   - suspension/reactivation
   - integration failures
   - service/customer export
3. Add weekly reconciliation jobs:
   - mailbox sync health
   - integration health
   - stuck workflows
   - action queue
4. Add monthly management summary.
5. Add structured application health page.
6. Harden:
   - MFA path
   - login throttling/CAPTCHA
   - secret masking
   - backup docs
   - queue/scheduler supervision docs
   - log retention
   - production email recipient guard
7. Add comprehensive end-to-end staging tests.
8. Produce production deployment/runbook.
9. Produce legacy Excel cutover checklist.

## Acceptance criteria

All acceptance scenarios in `07_ACCEPTANCE_AND_TESTING.md` pass or have explicitly documented, owner-approved deferrals.
