# Codex Prompt — Phase 5: Payment Collection Workflow

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

Manage invoice follow-up until funds are manually confirmed.

## Tasks

1. Add configurable payment reminder rules/templates.
2. Start collection cycle only after invoice is successfully published/sent.
3. Send payment reminders through existing communication pipeline.
4. Detect customer payment-reported replies via AI classification.
5. Set PAYMENT_REPORTED and notify Accountant.
6. Build Accountant confirmation UI:
   - method: transfer/check/credit card/other
   - amount/currency
   - notes/reference
   - confirm or reject reported payment
7. Only authorized human can set PAYMENT_CONFIRMED.
8. After confirmed payment:
   - invoice PAID
   - renewal case FULFILLED
   - update next renewal date/cycle according to configured subscription policy
9. Stop payment reminders after confirmation.
10. Add overdue collection dashboard/escalations.
11. Audit all transitions.

## Critical rule

Customer email is never proof of cleared funds.

## Acceptance criteria

Payment reminders are idempotent; payment-reported and payment-confirmed are clearly separate; unauthorized users cannot confirm payment.
