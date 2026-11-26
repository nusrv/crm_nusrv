# REVISED FINAL MASTER PLAN (DRAFT — Claude-authored; Codex review PENDING; no implementation authorized)
Base: `audit/arena/FINAL_MASTER_PLAN.md` (Codex SIGNED, technical only). Changes below come from the twelve approved owner decisions.

## Differences from the signed plan
- OD-1 replaces "recipient policy open" with a registered-contact-only rule (P1-ops).
- OD-2 replaces "optional per-request check" with a mandatory fresh-auth guard on sensitive mutations (needs `sid` claim) — cross-cutting P0-b/P1.
- OD-3 adds a backend official-invoice prerequisite; makes Create-Invoice-from-renewal (C-1) and invoice-link action prerequisites of fulfilment (moves C-1 earlier).
- OD-4 relaxes payment gate (non-cancelled invoices), adds receipt void/revision design; clarifications Q1–Q3.
- OD-5 adds clarification-send lifecycle (outbox purpose + transactional transition) and Keep in Review semantics.
- OD-6 changes hold semantics for human sends (supersedes H-1 "owner decision").
- OD-7 adds manager legacy-proposal endpoint + read-only inventory.
- OD-8 REVERSES the PNG-only recommendation: PNG/JPEG/WebP structural validators with documented residual risk, plus QR correction overlay.
- OD-9 refines S-1 fix to a client session-restore page (proxy cannot see the refresh cookie).
- OD-10 fixes UI labelling; OD-11 adds issuer-type template gate; OD-12 makes email status synchronization **mandatory** (new work item).

## Phases
**P0-a** One additive migration chain (all unmigrated schema + `nextAttemptAt`, outbox purpose/result, delivery events, sentFolder, receipt revisions/void, QR corrections); Prisma generate; typecheck; extend live runner.
**P0-b (parallel)** A-05 issuer tax slot; OD-8 structural validators (+DTO limits); A-03 fairness; SC-02 UI gate (no payment prerequisite; follows server rule); OD-9 session-restore; durable logout verification; `RequireFreshAuth` guard + `sid` claim (infrastructure; applying to endpoints continues in P1).
**P0-c** AI routing gate + disposition; human-only customer mail proof (OD-6 does not enable automation); JoFotara/technical-action refusal proof; mixed-version rollout/rollback rehearsal.
**P1-ops** OD-1 contact selection; OD-5 clarification send + keep in review; OD-6 hold bypass; OD-7 inventory + manager action; truthful Mark Read; reply linkage/unread; **OD-12 foundation (transport result, delivery events, DSN ingestion so bounces never become replies, uncertain-stop of auto-retry)**.
**P1-finance** Create-Invoice-from-renewal + link action; OD-3 fulfil prerequisite; free invoice; payments (OD-4 a/b depending on Q1), receipts (same invoice number, void/revision per Q2/Q3), QR replacement history (OD-8 H3); fresh-auth applied to all financial actions.
**P2** OD-12 Sent-folder reconciliation + status UI + uncertain-queue (**mandatory, not optional**); OD-11 issuer-type templates (Company now; Individual after reference); OD-10 labels; §20–24 UX; CI, Compose loopback, perf.
**P3** Deferred scope only.

## Blockers (owner)
Q1/Q2/Q3 → P1-finance payment & receipt-correction slices. Q4 → fulfil rule detail and invoice-link action. Q5 → uncertain-outcome policy within OD-12 (design of status capture proceeds). Q6 → clarification transition trigger. Q7 → Individual template only.
## Independent tasks that can proceed after future authorization
Migrations, A-05 tax slot, OD-8 validators, A-03 fairness, SC-02 UI gate, session-restore, AI gate, OD-1, OD-6, OD-12 transport/DSN/event capture, receipt create/print, payment arithmetic/replay fix, QR correction history.
## Preserved constraints
§25 safeguards, §26 deferred scope (no AI ops, JoFotara, Plesk/SmarterMail, Telegram, auto reminders/decisions), §28 deployment boundary, no `npm audit fix`.
