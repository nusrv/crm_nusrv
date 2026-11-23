# P1-to-P2 gap review — recovery branch

Date: 2026-11-23
Branch: `work/p1-chatgpt-recovery`
Baseline: interrupted Codex checkpoint `0070096`
Authority: `APPROVED_OWNER_REQUIREMENTS.md`, `FINAL_IMPLEMENTATION_ROADMAP.md`, `IMPLEMENTATION_ACCEPTANCE_TESTS.md`, `OWNER_APPROVAL_GATES.md`.

## Purpose and limits

This is a source inspection and updated execution sequence. No production database, SMTP server, mail provider, live JoFotara API or deployment was contacted. Added tests are *not* equivalent to passing evidence. Existing production migration/old-worker rollout approval remains separate. Do not merge this branch to main until the required release gates are met.

## Mandatory P1 status against accepted release boundaries

| Area | Current source implementation | Not yet proved or missing |
| --- | --- | --- |
| P1.1 Prospective renewal invoice | Explicit from-renewal draft, immutable snapshots, official evidence, case key, guarded renewal fulfillment, and an invoice-detail UI exist | End-to-end MariaDB uniqueness/locking; correct lifecycle for rejected/unpaid; data migration; per-issuer PDF render |
| P1.1 Independent/free invoice | API `POST /invoices/manual-draft` existed; a manual one-time COMPANY-issuer form has now been added to invoices list. Null subscription display bug fixed. | Run web typecheck; prove create/save/preflight/officialize/print. Current UI targets one-time buyers; an existing-customer selection UX still needs product validation |
| P1.2 Payments | Payment and append-only receipt revisions, exact unit math, official-only predicates, initial receipts, correction/void and customer balances exist. A printable acknowledgement form was added | Disposable MariaDB concurrent payment/receipt execution, verified existing-data mapping and backfill, print review, API/UI reconciliation |
| P1.2 Idempotency | Source review found receipt snapshot revision checks ran before detecting a duplicate key, defeating safe replay after a later audited invoice revision. Moved stale-snapshot checks after exact replay identity verification. Existing receipts can be reopened without a second issuance. | Verify replay after QR correction and concurrent create on MariaDB; run newly added Jest tests |
| P1.3 Manual mail/review | Registered BILLING/PRIMARY/fallback selection, purpose/case revision, explicit send, SMTP-acceptance gate and audited resend paths exist | Realistic mock SMTP test, two-worker acceptance/resend race on isolated DB, old queued worker cutover, manual UI permissions |
| P1.4 Historical recovery | Reasoned date correction and immutable QR correction history exist | Full isolated DB/audit tests; no historical invoice association activation without owner approval |

## P0 and P2 dependencies

P0 remains only partially verified: baseline/physical schema and disposable upgrade rehearsal are open; browser full-process restart remains unproved. No new P1 migrations or mail workers should be activated until the corresponding gates are satisfied.

P2 is **mandatory**, not an optional enhancement:
- Active Email Sync across supported inbound/outbound streams, Sent/provider evidence where available, DSN/bounce correlation, capability reporting and action/error review without auto-resend.
- Unified COMPANY invoice layout for NUSRV, Future Foresight and other COMPANY issuers, with immutable snapshots and correct issuer logo/legal/tax/bank/QR data.
- Fresh install/upgrade, rollback compatibility, operational permissions and UI workflow regressions using isolated fixtures.

P3 remains gated: INDIVIDUAL/PERSONAL approved visual template reference, historical invoice association and any new bounce-driven decision transition. Operational AI and automatic customer renewal messages remain prohibited.

## Execution order after this review

1. Fix direct P1 source defects (nullable independent invoice in listing, missing manual form, exact idempotent replay behavior) — source changes saved to the recovery branch.
2. Run workspace typecheck, focused P1 unit tests and existing P0 regressions against exact branch head. Correct type errors and failing fixtures before expanding features.
3. Rehearse migration order and transactional concurrency on a disposable MariaDB database with realistic legacy/dirty records; never test against production.
4. Verify the customer one-time invoice and company template PDF/print in a real browser. Check independent invoice and preserved approved renewal flow.
5. Validate P1.3 with mock SMTP and outbox races; record evidence, not just mock expectations.
6. Begin P2 Active Email Sync as bounded read-only observation/inventory slices first, then controlled provider evidence/DSN processing, never as an unconstrained rewrite.
7. Obtain owner-controlled activation approval only after source, database, browser, provider and rollback evidence is collected.

## Current verdict

**P1 engineering progressed, not acceptance-complete. P2 remains pending and mandatory.**
Do not claim successful builds, Jest/Node tests, MariaDB transactions, UI printing or deployment until results have actually been obtained and archived.
