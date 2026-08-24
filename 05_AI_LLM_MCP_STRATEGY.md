# AI / LLM / MCP Strategy

## Recommendation

Use a **direct LLM API integration inside the CP** for V1.

Do not make MCP the primary CP→LLM path.

Use MCP later as an optional interface that exposes selected CP capabilities to external agents such as Codex, ChatGPT, n8n, or other MCP clients.

## Why API first

The CP's AI use is narrow and deterministic:
- classify inbound email,
- summarize customer intent,
- extract relevant service/request,
- detect acceptance/rejection/payment-reported language,
- draft a suggested reply.

A direct API call is:
- simpler,
- easier to secure,
- easier to test,
- lower architectural overhead,
- easier to force into strict structured output.

The CP remains the authoritative workflow engine.

## Initial LLM architecture

Inbound email
→ Mailbox sync
→ sanitize/normalize body
→ identify known customer/thread context
→ LlmGateway
→ structured classification
→ validation
→ deterministic workflow service
→ optional human review

## Provider abstraction

Define an interface such as:

- classifyInboundMessage(context)
- summarizeMessage(context)
- draftReply(context)

Initial implementation:
- OpenAI Responses API (or another explicitly configured provider)

Do not hard-code the model name in business logic.
Use configuration:
- AI_PROVIDER
- AI_MODEL
- AI_CONFIDENCE_THRESHOLD
- AI_ENABLED
- AI_AUTO_ROUTE_ACCEPT_REJECT

## Structured output contract

Example logical schema:

```json
{
  "intent": "ACCEPT_RENEWAL",
  "confidence": 0.98,
  "summary": "Customer confirms renewal and requests the invoice.",
  "subscription_references": [],
  "invoice_requested": true,
  "payment_reported": false,
  "requested_change": null,
  "requires_human_review": false,
  "reason_for_review": null,
  "suggested_reply": "..."
}
```

Allowed intents:
- ACCEPT_RENEWAL
- REJECT_RENEWAL
- REQUEST_INVOICE
- PAYMENT_REPORTED
- REQUEST_UPGRADE
- REQUEST_DOWNGRADE
- REQUEST_CLARIFICATION
- PRICE_DISPUTE
- COMPLAINT
- OTHER
- UNCLEAR

## Auto-routing rules

High-confidence clear acceptance:
- may automatically move to ACCEPTED / create invoice draft,
- cannot publish invoice.

High-confidence clear rejection:
- may automatically open retention workflow,
- cannot suspend service.

Payment reported:
- may flag PAYMENT_REPORTED,
- cannot confirm funds.

Everything ambiguous or commercially material:
- HUMAN_REVIEW.

Confidence thresholds are configurable and tested against real historical email examples before enabling auto-routing.

## Prompt/version control

Store:
- prompt version
- model/provider
- structured result
- confidence
- timestamp
- optional reviewer corrections

Do not store chain-of-thought.

Use reviewer corrections later to improve prompts/evaluations.

## MCP — optional Phase 8

MCP becomes valuable when the CP is stable and we want external agent access.

Potential read tools:
- list_upcoming_renewals
- get_customer
- get_subscription
- get_renewal_case
- get_invoice_status
- list_action_queue
- get_integration_health

Potential controlled write/request tools:
- draft_customer_reply
- create_followup_note
- request_invoice_publication
- request_suspension
- request_reactivation

Important:
- MCP write tools must call the same CP application services and approval gates.
- MCP must never bypass RBAC/state machine.
- No MCP tool should directly execute raw Plesk/Fawtara actions outside the CP workflow.
- Start read-only if MCP is introduced.

## MCP and n8n

If n8n is already used with MCP, the CP can later expose an MCP server or a small secure REST API/MCP facade.

Recommended separation:

CP internal logic
→ normal application services

CP AI classification
→ direct LLM API

External agent/n8n interaction
→ REST API and/or MCP facade

This keeps the system functional even when MCP/n8n is offline.

## Current OpenAI direction

Current OpenAI Responses tooling supports direct model requests, structured/tool workflows, function calling, and MCP tools. Therefore choosing a direct API integration now does not block MCP later.
