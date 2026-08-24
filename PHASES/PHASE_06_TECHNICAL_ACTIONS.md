# Codex Prompt — Phase 6: Retention, Suspension, Plesk, SmarterMail and Manual Actions

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

Complete the non-renewal enforcement path with retention, IT approval, service-specific suspension/reactivation and external adapters.

## Tasks

1. Complete RetentionCase workflow/UI.
2. Rejected customer:
   - open retention
   - assign/notify Sales Development
   - notify IT/management based on rules
   - outcome recovered or lost
3. Lost → DO_NOT_RENEW.
4. At expiry, send final warning.
5. At expiry + 24h, eligible case → SUSPENSION_DUE.
6. Create IT approval request.
7. Build TechnicalAction planner based on:
   - subscription
   - service type
   - connected systems
   - action profile
8. Implement TechnicalServiceAdapter interface.
9. Implement Plesk adapter for validated supported actions.
10. Implement SmarterMail technical adapter for validated supported actions.
11. Implement Manual adapter/task.
12. Build action executor with:
    - idempotency
    - bounded retry
    - sanitized logging
    - verification
    - error queue
13. Mark subscription SUSPENDED only when required action set completes/confirmed.
14. Implement reactivation through the same gated architecture.
15. Add integration health checks.
16. Audit every approval and technical execution.

## Safety tests

- SSL-only action must not disable unrelated hosting/email.
- No action before expiry + 24h.
- No action without IT approval.
- No automatic deletion.
- Wrong remote identifier protection.
- Failed API result cannot produce false success.

## Acceptance criteria

Demonstrate one automated Plesk test case, one SmarterMail test case and one Manual action case in non-production mode.
