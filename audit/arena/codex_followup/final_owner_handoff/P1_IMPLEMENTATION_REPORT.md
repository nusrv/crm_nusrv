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
