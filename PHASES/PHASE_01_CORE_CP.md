# Codex Prompt — Phase 1: Core Control Panel and Legacy Import

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

Deliver the usable internal CP for customers, subscriptions, service types, billing entities, technical connections and controlled legacy Excel import.

## Tasks

1. Build CP navigation/dashboard shell.
2. Build CRUD with RBAC for:
   - Billing Entities
   - Customers
   - Service Types
   - Subscriptions
   - Technical Connections
   - Subscription ↔ Connection mappings
3. Add connection capability/action profile fields.
4. Add customer billing-entity assignment.
5. Add subscription renewal date, cost, selling price, currency, auto-renew flag, grace hours.
6. Build legacy import staging architecture for `Project monitoring report.xls`.
7. Preserve raw source rows and source row references.
8. Build mapping/validation UI:
   - candidate customer
   - candidate service/subscription
   - duplicate detection
   - manual correction
   - approve import
9. Import must be repeat-safe/idempotent.
10. Add basic dashboard counts based on actual database records.
11. Add audit events for all administrative changes/import approvals.

## Important

Do not blindly interpret ambiguous legacy free-text descriptions. Surface them for human validation.

## Do not implement

- scheduled reminders
- inbound/outbound mail automation
- AI
- Fawtara
- collection workflow
- suspension execution

## Acceptance criteria

- operator can create a customer and multiple subscriptions
- each subscription can connect to zero/many technical connections
- each customer has one billing entity
- service types can be added later through UI
- legacy records can stage and be manually approved
- re-import does not duplicate approved records
- RBAC and audit tests pass
