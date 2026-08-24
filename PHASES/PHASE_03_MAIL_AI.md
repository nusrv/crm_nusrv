# Codex Prompt — Phase 3: SmarterMail Communication and LLM Classification

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

Connect the communication loop: SMTP sending, IMAP inbound synchronization, threading and AI-assisted classification.

## Tasks

1. Implement SMTP MailTransport.
2. Implement IMAP MailboxReader with incremental sync and idempotency.
3. Store Message-ID, In-Reply-To, References and thread/case linkage.
4. Implement renewal case reference tagging/correlation.
5. Create LlmGateway interface.
6. Implement configured direct LLM API provider using strict structured output.
7. Add prompt versioning and classification persistence.
8. Implement intents from the AI strategy document.
9. Implement safe auto-routing:
   - high-confidence ACCEPT → accepted + invoice draft placeholder state; do not publish
   - high-confidence REJECT → retention workflow placeholder/open case
   - PAYMENT_REPORTED → flag only
   - unclear/questions/upgrades/disputes → HUMAN_REVIEW
10. Build Communication Center UI:
    - thread
    - customer
    - renewal case
    - AI summary
    - classification
    - confidence
    - suggested reply
    - human correction
11. Add operator reply-send function via SMTP.
12. Store reviewer corrections for evaluation.
13. On AI failure/malformed output, safely route to HUMAN_REVIEW.

## Safety

The LLM must not call Fawtara, Plesk, SmarterMail suspension, payment confirmation, or workflow approval tools.

## Acceptance criteria

Use a test corpus of representative emails proving:
- acceptance
- rejection
- invoice request
- payment-reported
- upgrade
- clarification
- ambiguous message

Threading must be repeat-safe and AI failure must never break the renewal engine.
