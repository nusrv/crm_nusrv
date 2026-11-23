# CLAUDE INITIAL CHALLENGES

Context: all analysis is STATIC (no node_modules, no Prisma client, nothing executed).

## Strengths of the Codex packet acknowledged up front (independently verified by me)
- A-01 (no migrations for Payment/PaymentReceipt/proposed*/manualApprovedBy/reviewedAt/sourceRenewalCaseId): VERIFIED.
- A-02 (24-byte synthetic PNG header passes `isManualQrImage`): VERIFIED by reading.
- A-03 (defer leaves `scheduledAt` unchanged; batch 50; order scheduledAt,id): VERIFIED by reading.
- A-05 (customer tax in Sales Tax slot, and prohibited issuer "Tax / National No." line): VERIFIED.
- SC-02 (UI gates fulfil on PAYMENT_CONFIRMED): VERIFIED. Matrix has exactly 55 rows, `S01..S55`, spanning §1–§29: VERIFIED.
- The matrix already self-corrected A-04 ("not a confirmed violation") — a good-faith qualification.

## CLAUDE-001 — "Keep in Review" and "Needs Clarification" cannot be built as the plan describes
**Target:** Matrix S18 / plan P1.2 "Add all four operator choices … three decisions".
**Claim:** The packet notes Keep in Review is missing but does not notice the state machine blocks it. `LEGAL_PREDECESSORS[HUMAN_REVIEW]` = {UPCOMING, REMINDER_CYCLE, AWAITING_CUSTOMER}; `isLegalRenewalCaseTransition` is pure set membership, so HUMAN_REVIEW→HUMAN_REVIEW is illegal. The new `markNeedsClarification` therefore 409s when the case is already HUMAN_REVIEW, and a naive `keep-in-review` that re-applies HUMAN_REVIEW would fail the same way. Also both actions map to the same state, so "Needs Clarification" and "Keep in Review" are indistinguishable in data and in §23's label "Needs review".
**Evidence:** `renewal-transition-policy.ts` (LEGAL_PREDECESSORS, isLegalRenewalCaseTransition); `renewal-cases.service.ts markNeedsClarification`; nothing in `apps/web` references either action.
**Impact:** Mandatory §9 control ships unusable or semantically collapsed.
**Alternative:** Model Keep in Review as a non-transition, audited review mark (message `reviewedAt/By` already exists, plus a case-level audit event) and define Needs Clarification as an explicit decision (owner choice: stays HUMAN_REVIEW with a distinguishing `customerDecision`/reason, or moves to AWAITING_CUSTOMER after a human clarification send).
**Verification:** Unit test of the transition matrix + service call from each source state.
**Severity:** High. **Confidence:** High (static). **Status:** Open.

## CLAUDE-002 — A-04 is rated High and drives a P1 architectural item against a scope that it does not violate
**Target:** CODEX_INITIAL_REPORT A-04 "High · CONFIRMED"; plan P1.1 "implement session/user validation".
**Claim:** §4 lists five required behaviours; all five are implemented in `auth.service.ts` (refresh re-reads roles, disabled users revoked, logout revokes, expiry enforced, absolute 24h cap). Local code also caps access-token life at min(config, 900 s, remaining session). The residual is ≤15 min of stale claims — a documented trade-off of stateless JWTs, not a defect against the frozen scope. The matrix itself says "do not label … confirmed violation", yet the initial report/plan still carry High + P1 work. Per-request DB/session lookup is a guard-architecture change ("do not weaken … RBAC" and §27 efficiency apply both ways).
**Evidence:** `auth.service.ts` refresh/issueTokens/signAccessToken; `jwt.strategy.ts validate`.
**Impact:** Misprioritised effort; risk of a regression in the one subsystem that currently works.
**Alternative:** Reclassify Medium + OWNER APPROVAL REQUIRED; if approved, targeted check only for ADMIN/ACCOUNTANT money and user-admin endpoints.
**Verification:** Owner decision; test with fake clock.
**Severity:** Medium. **Confidence:** High. **Status:** Open.

## CLAUDE-003 — A-02 remediation should not require a new decoder dependency
**Target:** A-02 "bounded raster decode … validate a decodable QR"; P0.2.
**Claim:** `pngjs` is already an `apps/api` dependency, so PNG chunk walk (IHDR type, bounded dimensions, IDAT presence, IEND, CRC) needs no new package. JPEG (SOF marker + dimensions) and WebP (VP8/VP8L/VP8X chunk header) can be structurally parsed in a few dozen lines. Actual QR *decoding* needs a new dependency (e.g. a QR reader), which collides with §26 ("unrelated dependency upgrades") and with the audit/no-install rule, and — as Codex itself notes — cannot prove authenticity. The plan leaves the choice open; it should pick structural validation + mandatory operator visual confirmation, and make QR decoding an OWNER APPROVAL item. Also: the DTO regex and `isManualQrImage` are two separate checks; historical records accepted under the weak check need a read-only scan report, not an auto-reject.
**Evidence:** `manual-qr.ts`, `invoices.dto.ts:26,156`, `apps/api/package.json` (pngjs).
**Severity:** Medium (severity of A-02 itself I accept as High). **Confidence:** Medium-High. **Status:** Open.

## CLAUDE-004 — A-03 fix: a new column is not the only (or the safest) option, and severity depends on which defer reasons persist
**Target:** P0.3 "persisted, indexed next-attempt time".
**Claim:** (a) `CommunicationOutbox.updatedAt` (`@updatedAt`) already changes on every defer write, and index `(status, scheduledAt)` exists. A candidate query that excludes rows deferred within a back-off window (using `updatedAt`, no DDL), or orders by `updatedAt` for deferred rows, fixes starvation without another migration stacked on the unmigrated schema (A-01). Codex should justify why a column is required. (b) Since the working tree cancels unapproved customer rows (`human_approval_required`), the remaining indefinite-defer reasons are `mail_configuration_unusable`, `internal_notification_hold`, `customer_reminder_hold`, `no_current_recipient`. Which of them can accumulate ≥50 rows, and per mailbox? (c) A-03 is a HEAD defect independent of the policy cutover, so it must not wait for P0.1.
**Evidence:** `mail-outbound.service.ts` L160-170, L364-412, L463-470; schema `CommunicationOutbox`.
**Severity:** Medium-High. **Confidence:** Medium. **Status:** Open.

## CLAUDE-005 — SC-01 (AI HUMAN_REVIEW routing) severity is overstated and its proposed disposition is undefined
**Target:** Matrix SC-01 "High".
**Claim:** Existence conceded (I independently found it: `ai-routing.service.ts` L79-90 filters only AUTO_ACCEPT; `executeHumanReviewRouting` writes HUMAN_REVIEW on message/thread). But it can only move items *toward* human review, never decides, accepts, classifies anew, or acts externally, and the code never downgrades RESOLVED. High is not proportionate; Low-Medium. More important: gating the batch/process path leaves historical PENDING decisions pending forever. The plan must say what happens to them (mark SKIPPED with audit? leave?) or the queue scanner re-selects them each tick (same starvation class as A-03).
**Severity:** Medium. **Confidence:** High. **Status:** Open.

## CLAUDE-006 — P0.1 bundles unrelated work into one release gate
**Target:** P0.1 "Establish a coherent manual-only release" (A-01, A-06, A-10, A-13, High effort).
**Claim:** P0.1 mixes (i) additive migration + Prisma regeneration + strict-type fixes for nullable `customerId/sourceSubscriptionId` (A-01), (ii) policy gates (AI/JoFotara/customer mail), (iii) recipient policy (A-06), (iv) CI/verification (A-10), (v) UI capability labelling (A-13). They have different owners, risk, and rollback. Sequence should be: **P0-a** migration + generated client + typecheck (nothing else may be verified before this), **P0-b** release-blocking defects with independent small fixes (A-05, A-02, A-03, SC-02 UI gate), **P0-c** policy gates with fake-transport proof. A single gate prevents partial, independently verifiable progress.
**Severity:** High (plan quality). **Confidence:** Medium. **Status:** Open.

## CLAUDE-007 — Missed interaction: a human-approved send can be silently stuck by an *automation* hold and then feed A-03
**Target:** A-06/P1.2 treatment of manual send.
**Claim:** `evaluateEligibility` applies `holdPolicy.stopCustomerReminders → defer('customer_reminder_hold')` to human-approved customer rows too. A human who clicks Send while a case hold is active gets a 201/queued row that never sends, with no operator feedback, and it joins the starvation population (CLAUDE-004). Scope §6 says sending is explicit and human; whether holds should block *human* sends is an owner decision that the packet does not list.
**Evidence:** `mail-outbound.service.ts` L396-399; `manual-renewal.service.ts send` (does not check holds).
**Severity:** Medium. **Confidence:** Medium-High. **Status:** Open. **OWNER APPROVAL REQUIRED** (hold semantics).

## CLAUDE-008 — Owner-decision register is incomplete: payment/receipt prerequisites (§18–19) and legacy ACCEPTED cases
**Target:** Readiness §"Questions requiring evidence" (8 items) and Codex's three named decisions.
**Claim:** (a) `PaymentsService.record` requires `status = FAWTARA_ACCEPTED && !reconciliationRequired && !submissionLock`. §19 says the receipt action becomes available "after an invoice exists" and §18 says payments are independent records. A customer who pays against a DRAFT/READY invoice (common: payment precedes manual official issue) cannot be recorded. The matrix mentions "unresolved prerequisites" in one cell but it is not a registered owner decision. (b) Every payment increments `invoice.revision` as a lock — correct for serialization but it also invalidates any open edit form/CAS keyed on `revision`. (c) Legacy ACCEPTED cases without `proposed*` hit a 409 in `markFulfilled` with no recompute action; plan only says "include handling". Propose an audited human "Recalculate proposed period" action.
**Severity:** Medium-High. **Confidence:** High on facts, Medium on policy. **Status:** Open. **OWNER APPROVAL REQUIRED** for (a).

## Limits on my own analysis (to be tested by Codex)
No test executed. I have not traced receipt rendering, §20 modal stack, §22 navigation, RBAC role matrix, or send→AWAITING_CUSTOMER status effects.
