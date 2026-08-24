# Codex Prompt — Phase 4: Invoicing and Jordan Fawtara

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

Implement invoice draft/review/publication and official Fawtara integration with separate configuration for the two BillingEntities.

## Mandatory preparation

Before implementing real Fawtara submission:
- obtain and inspect the current official Jordan Fawtara technical specification,
- confirm the exact required payload, authentication, response, QR/reference behavior and cancellation/correction rules,
- do not invent fields.

## Tasks

1. Implement Invoice and InvoiceLine models/UI.
2. Accepted renewal creates invoice draft.
3. Populate invoice from:
   - correct customer
   - correct BillingEntity
   - selected subscription(s)
   - configured prices/tax data
4. Add Accountant review screen.
5. Only authorized Accountant/Admin can publish.
6. Implement FawtaraGateway interface.
7. Implement separate credential/config resolution per BillingEntity.
8. Implement sandbox/mock first.
9. Then implement real official adapter only after specification/credentials are validated.
10. Persist sanitized official request/result references, status and QR/reference data.
11. Generate the approved branded invoice output/template using official returned data.
12. Send invoice using correct company email/bank details.
13. On successful send move case to COLLECTING.
14. Build failed-submission/retry queue.
15. Audit all invoice lifecycle events.

## Critical rule

A customer acceptance may create DRAFT automatically, but no official invoice is published without Accountant action.

## Acceptance criteria

Test both BillingEntities independently. A credential/config mix-up must be impossible by design. Failed Fawtara submission cannot be represented as a successful official invoice.
