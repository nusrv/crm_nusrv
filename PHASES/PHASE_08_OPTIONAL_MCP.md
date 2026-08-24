# Codex Prompt — Phase 8 OPTIONAL: MCP Interface

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


Also read `05_AI_LLM_MCP_STRATEGY.md`.

## Goal

Expose a secure MCP interface for approved external agents/n8n/Codex/ChatGPT without changing the CP's authority model.

This phase is optional and should not begin until the CP is stable in production/staging.

## Initial scope

Prefer read-only tools first:
- list_upcoming_renewals
- get_customer
- get_subscription
- get_renewal_case
- get_invoice_status
- list_action_queue
- get_integration_health

Later controlled request tools may include:
- draft_customer_reply
- create_followup_note
- request_invoice_publication
- request_suspension
- request_reactivation

## Rules

- MCP calls the same Application Services used by the CP.
- MCP cannot bypass RBAC.
- MCP cannot bypass approvals.
- MCP cannot directly call raw Fawtara/Plesk/SmarterMail credentials.
- Require scoped authentication and audit every MCP tool invocation.
- No destructive execution tool in the first MCP release.
- Support revocation/disable switch.

## Acceptance criteria

An authenticated MCP client can query authorized CP data while unauthorized calls fail, all calls are audited, and no approval/state-machine bypass exists.
