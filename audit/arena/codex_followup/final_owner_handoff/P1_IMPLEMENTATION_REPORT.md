# P1 implementation recovery — first engineering checkpoint

Date: 2026-11-23
Branch: `work/p1-chatgpt-recovery`
Original interrupted Codex checkpoint: `00700968b84b829d9ef00b86519ae389df97b417`

## Scope and evidence limits

This report records a source-level review and subsequent small commits after Codex's five-hour usage allocation was exhausted. It is **not** a statement that P1 has passed integration tests. The exact final Codex command is not recoverable from Git history, but at the saved checkpoint P1 migrations, service/controller code and UI components for all four P1 slices were present, whereas `P1_IMPLEMENTATION_REPORT.md` and focused payment-service regression tests were not.

Work is restricted to the recovery branch. No production databases, live mail, production migrations, deployment or main-branch changes are authorized or performed.

## Found in the interrupted checkpoint

| Slice | Source evidence observed | Status |
| --- | --- | --- |
| P1.1 | `InvoicesService.createForRenewal`, explicit `recordFawtaraResult` officialization, `RenewalCasesService.markFulfilled`, renewal source key and additive SQL | Implemented in source; not integration verified |
| P1.2 | `PaymentsService`, `PaymentsController`, revision-based effective balance arithmetic, payment/receipt/revision migrations, invoice and customer panels | Implemented in source; concurrency, real DB and printable receipt UX unverified |
| P1.3 | `ManualRenewalService`, reply/recipient helpers, SMTP-acceptance transition in `MailOutboundService`, operator/renewal resend controls and human communication panel | Implemented in source; real SMTP and concurrency not verified |
| P1.4 | Historical proposed-date repair and QR correction routes, Prisma migration, recovery UI panels | Implemented in source; database/audit/history integration not verified |

The existing P0 validation report remains `Verdict B — partially verified`: disposable MariaDB rehearsal and full-process browser profile persistence were not proven. Production schema and deployment gates remain open.

## Changes after the checkpoint

1. Added `payment-money.spec.ts` to assert exact three-decimal arithmetic, 100/40/30 collection, 40→35 correction, voiding 30, unresolved/mismatched receipts, full collection and excess disclosure. This tests the pure financial calculator; it does not replace transactional service tests.
2. Added `official-invoice-eligibility.spec.ts` to verify the positive evidence path and rejection of missing/ambiguous/invalid official status, provenance, QR, issuer, date, money and currency.
3. Restricted renewal reminder preview and inbound reply GET routes to current ADMIN. The existing send/review/evidence mutations were already ADMIN-gated. Added a controller metadata/guard regression test.
4. Added `renewal-period.spec.ts` for ordinary and end-of-month/February/leap-year dates and invalid intervals.

These are source commits only. **The added tests have not been executed in the recovery environment.** The GitHub combined commit status contained no reported CI statuses at the time of review.

## Next implementation priorities

1. Run workspace typecheck, focused P1 Jest tests and existing P0 regression checks in an authorized test environment. Fix any failures before relying on these tests.
2. Add transactional tests of payment+receipt atomicity, idempotency, correction/void stale-version rejection and concurrent submissions. Verify against isolated MariaDB before P1.2 acceptance.
3. Verify P1.1 accepted-case invoice lifecycle, distinct explicit officialization, official-number issuer uniqueness, conflict with newer renewal cycles, payment independence and legacy manual/free invoice scenarios.
4. Verify P1.3 exact case-linked SMTP acceptance and late-evidence/resend races. Do not send actual customer email.
5. Verify P1.4 QR previous-byte retention and historical date repair audit with an isolated test database.
6. Review P1.2 receipt presentation: the observed UI primarily shows receipt history in a modal, not a verified printable stamp-free receipt document. Do not claim this exit criterion complete.
7. Validate additive migration order and any pre-existing physical payment tables against an isolated database. Do not execute migrations against operational data or assume that checked-in SQL matches the production schema.

## Outstanding owner/release gates

- Live/target schema comparison and explicit operational migration authorization.
- Old outbound-worker cutover and safe queue handling.
- Full browser-process restart persistence verification in a suitable Windows profile environment.
- The separate approved INDIVIDUAL/PERSONAL invoice template reference.
- Historical official invoice association remains owner-gated and must not be enabled.
- Actual live SMTP/integration activation and deployment authorization.

## Checkpoint verdict

**P1: implementation in progress, partially inspected, not verified.** Preserve the interrupted checkpoint and continue with targeted tests and source fixes rather than reproducing the previous long Codex run.


## Recovery checkpoint 2 — financial, mail and UI hardening (2026-11-23)

All changes below were made on the temporary GitHub recovery branch; the original interrupted Codex checkpoint remains in Git history.

### Financial document integrity

- Added `PaymentsService` unit scenarios for official-only payment, currency isolation, same-key replay, conflicting-key rejection, initial receipt, correction, void and stale version rejection.
- Added a receipt snapshot revision guard. `PaymentsService.record()` and `receipt()` fetch the candidate immutable display snapshot, acquire the invoice row lock, then compare the invoice revision. A concurrent invoice correction between these steps now fails safely with a reload-required conflict instead of freezing stale invoice data into a new receipt.
- Implemented a separate printable, stamp-free `PaymentReceiptDocument` in the existing collection modal using the original legal/issuer/invoice snapshot and the latest effective receipt revision. Voided receipts cannot be printed as current valid acknowledgements. The document contains no tax-invoice QR or seal.
- Added a server-rendered receipt markup check for the corrected amount, historical issuer/invoice, invalid/void status and React escaping. CSS printing has not yet undergone real Chrome visual verification.

### Human mail resend containment

- In both `MailOutboundService` and `OperatorReplyOutboundService`, an ADMIN-authorized resend now locks the original outbox row and checks committed SMTP acceptance evidence inside the transaction immediately before the durable send-attempt boundary.
- If the original had accepted by that point, the new resend is marked CANCELLED with an audit entry and **no new SMTP attempt** begins. Lock ordering synchronizes with the existing `recordSuccess` original-row update path.
- A genuinely later acceptance after the new attempt starts remains a possible duplicate-delivery risk; this is why explicit ADMIN acknowledgment is mandatory. No system can retroactively unsend an already-transmitted SMTP request.
- Added tests for positive late acceptance, nonacceptance with an authorized resend, and normal first-send behavior for both outboxes. Real multi-connection transaction races remain unverified until disposable MariaDB is available.

### Additional P1 coverage

- Added priority and fallback recipient tests (registered BILLING, PRIMARY, then main email), plus invalid-address filtering.
- Added historical renewal-date repair tests for authorized reasons, missing-only corrections, superseded cycles, already-complete dates and invalid boundaries.
- Added QR correction tests for preserved original image, actor/reason, revision guard, rejected input and nonofficial invoices.
- Existing official-invoice evidence, money arithmetic, renewal dates and GET authorization tests remain in the branch.

### Verification and current restrictions

**Source changes saved; tests NOT EXECUTED locally in this ChatGPT environment.** The connected GitHub repository exposes file operations, but no verified checked-out package-install/database runtime; no successful Jest, TypeScript, browser or MariaDB run has been claimed.

P0 remains partially verified. P1 remains **engineering-in-progress**, not approved for operational migration or deployment. P2 Active Email Sync remains outside this implementation slice; only P1 manual resend safety was modified.

Next steps, ordered by importance:
1. Workspace API/web/shared typecheck and targeted Jest/Node renderer tests against the exact recovery branch, then repair failures.
2. Transactional MariaDB P1.1/P1.2 rehearsal, including invoice uniqueness, total/effective receipt revisions, concurrent writes and migration compatibility with physical legacy tables.
3. Multi-worker SMTP late-evidence, resend authorization and clarification-acceptance tests with synthetic transports, never live customer email.
4. Real browser print review of the stamp-free receipt and existing invoice branding.
5. Complete distinct prospective/free invoice and fulfillment end-to-end tests, followed by controlled owner review and separately authorized rollout.

## Recovery checkpoint 3 — accepted-cycle integrity and targeted test commands

- Strengthened `acceptedRenewalPeriod()` so an accepted renewal begins exactly on the due date and ends exactly one day before the proposed next-renewal date. Gapped or shifted periods cannot qualify for prospective officialization or fulfillment.
- Added `accepted-renewal-invoice.spec.ts` for decision, missing/gapped dates, row-lock ordering and superseded cycles.
- Added `legacy-renewal-recovery.controller.spec.ts` and `invoice-qr-corrections.controller.spec.ts` for original evidence preservation, revision locks and audit.
- Updated `PROJECT_STATUS.md` to retain the P1 recovery branch and open verification gates.

### Safe focused local validation (requires previously installed project dependencies)

From the recovery checkout, without starting any SMTP/worker/production service:

```powershell
npm run typecheck
npm run test -w @cp/api -- --runTestsByPath src/modules/invoices/payment-money.spec.ts src/modules/invoices/payments.service.spec.ts src/modules/invoices/official-invoice-eligibility.spec.ts src/modules/invoices/invoice-qr-corrections.controller.spec.ts src/modules/renewal-cases/renewal-period.spec.ts src/modules/renewal-cases/renewal-mail-recipient.spec.ts src/modules/renewal-cases/accepted-renewal-invoice.spec.ts src/modules/renewal-cases/legacy-renewal-recovery.controller.spec.ts src/modules/renewal-cases/renewal-cases.controller.spec.ts src/modules/mail/resend-attempt-guard.spec.ts
.\node_modules\.bin\tsx.cmd apps/web/tests/payment-receipt-renderer.check.tsx
```

These targeted checks use synthetic/mock data and do not perform migrations or live sends. They are **not executed at the time of writing**. Their eventual passing cannot substitute for isolated MariaDB concurrency/upgrade rehearsals or real browser print and session verification.

## Recovery checkpoint 4 — SMTP evidence serialization and legacy money quarantine (2026-11-23)

### Late SMTP evidence race tightened

The prior resend preflight locked its original outbox and inspected committed SMTP acceptance evidence, but the original send's acceptance recording did not always explicitly lock the original row when the lease had already been quarantined. Both `MailOutboundService.recordSuccess()` and `OperatorReplyOutboundService.recordSuccess()` now issue a locking read of that original outbox row **before** conditionally updating status and appending the SMTP acceptance audit event. This creates a consistent original-row lock boundary with both outbox `markAttempt()` resend gates, even if status CAS affects zero rows.

The two legacy worker test harnesses now support this additional locking read. Added a focused audit ordering test asserting that ownership-lost late acceptance is still recorded after the original-row lock. These are synthetic unit tests, **not a live MariaDB concurrency proof**. No live SMTP was invoked.

### Financial history integrity tightened

`effectiveReceiptAmounts()` now:
- checks the original Payment currency as well as the effective receipt currency;
- excludes and flags malformed, zero or negative historical Payment principals;
- excludes and flags malformed, zero or negative effective receipt revisions;
- retains voided receipt history without counting it as a collection;
- exposes the number of unresolved records rather than throwing and breaking all customer balance results for these data discrepancies.

The source Payment record and every receipt revision remain unmodified. No currency exchange, refund, reallocation or automatic correction occurs.

`PaymentsService.receipt()` additionally refuses to issue a first receipt for a zero/negative historical Payment while preserving the existing valid backfill path for a positive recorded Payment. Added unit cases covering both and extended money-projection cases to cover mismatched principal/receipt currencies and malformed values.

### Mandatory verification still open

- Run TypeScript and targeted Jest suites for exact branch head; **none of the new tests have been executed in the connected GitHub file-edit environment**.
- Verify race ordering against two concurrent disposable MariaDB transactions and mocked SMTP, including acceptance after lease quarantine and before/after resend claim.
- Verify existing production schema and migration compatibility before any operational database change; deploy and old-worker cutover require separate owner approval.
- Verify receipt printing in a real browser and the company's invoice template output.
- Preserve the P0 browser restart and MariaDB release gates; do not interpret source review as P1 completion.

**Verdict remains: P1 source hardening in progress, release not authorized.**
