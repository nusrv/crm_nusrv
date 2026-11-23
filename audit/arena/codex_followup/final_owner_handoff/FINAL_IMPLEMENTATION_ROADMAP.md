# Final implementation roadmap

This sequence refines the [Final Master Plan](../../FINAL_MASTER_PLAN.md), [P0 readiness review](../P0_IMPLEMENTATION_READINESS.md) and [roadmap corrections](../PROPOSED_ROADMAP_CORRECTIONS.md). P0–P3 are handoff work packages. Existing product phase names and deployment history remain as recorded in [Project Status](../../../../PROJECT_STATUS.md). Begin P0 only after explicit implementation authorization.

## P0 · Independent safety foundations

| Work | Readiness and order | Exit evidence |
| --- | --- | --- |
| P0.1 · Baseline and migration design | Implementation-ready inventory. Separate approved schema additions from the dirty worktree, review SQL history and identify gaps and nullable relation callers. Following environment authorization, obtain read-only deployed schema/version and data counts before rehearsing changes. | Schema-to-history matrix, drift report, reproducible additive migration order, legacy exceptions report, backup and restore drill on an authorized disposable copy. |
| P0.2 · Mail replay containment | Implementation-ready design. For both outboxes, stop unsafe ambiguous/stale replay and enforce the automatic-customer-reminder prohibition at schedule and dispatch. Deploy a durable attempt boundary and uncertainty quarantine after the relevant P0.1 schema verification. Freeze or drain old send workers during cutover and audit legacy queued/processing/failed rows. | Fault-injection evidence for timeout, crash after acceptance, worker overlap, and old pending rows. No old consumer can reclaim an uncertain send. No wider scheduling until this passes. |
| P0.3 · Authorization and session | Implementation-ready after endpoint/cookie inventory. Add fresh current ADMIN/account/session guards and enforce TTL caps. Then restore browser sessions and validate real login/bootstrap/logout paths. | Endpoint matrix, role removal/disable/revoke tests, restart/expiry/logout-race evidence and rollout handling for old session tokens. |
| P0.4 · Tax, QR and AI prerequisites | Split into independently reviewable changes. Render issuer tax snapshot in the company tax slot, build bounded PNG/JPEG/WebP structural validation, and guard inactive AI across direct/queued/diagnostic paths. | Regression fixtures show correct issuer per invoice, approved input formats and zero AI executions, including existing queue jobs. |
| P0.5 · Mail eligibility and fairness | Depends on P0.2. Use next-attempt eligibility, common scan/claim predicate and bounded delays. Preserve original scheduled timestamp and keep deferred rows outside the ready batch. | Delayed-row and late-poll tests, no extra SMTP attempts for Hold deferrals, no stale replay. |

**P0 release boundary.** Review each independently reversible change against the preserved worktree and test automatic reminder suppression, feature flags, migration compatibility and worker fencing together. Rollback must keep outbound paused or keep proven no-replay consumers in place. Complete the schema audit before enabling any path that references unapplied fields. New payment/receipt writes and new fulfillment flow remain gated.

## P1 · Mandatory human workflow

| Slice | Prerequisites | Release boundary |
| --- | --- | --- |
| P1.1 · Prospective invoice and fulfillment | P0.1, P0.3 and P0.4. Add verified-official predicate and prospective association. Add separate manual renewal and free invoice forms and explicit officialization with legal/financial snapshots. Connect fulfillment only after linking, official status, transactional date checks and guarded migration are verified. | Both backend and UI reject missing/ineligible invoices. Unpaid official invoices can fulfill. Existing historical PDF and free invoice paths remain supported. |
| P1.2 · Payment, receipt and balance | P0.1 and P0.3 plus P1.1 verified-official predicate. Inventory and reconcile existing facts, deploy typed receipt revision changes, backfill reliably matched records, shadow totals, then release the ADMIN collection workflow. | Official-invoice requirement, idempotency, corrections/void and single-source aggregate proven across API/UI. Cut over verified data only. Queue ambiguous legacy dispositions separately. |
| P1.3 · Manual reminder/reply and clarification | P0.2 and P0.3. Implement registered-contact selection and provenance, deliberate Hold bypass, shared review controls, exact SMTP acceptance transition and warned, audited resend. | Both outboxes use persistent evidence. Direct Waiting bypass closed. Permission and race tests pass. No implicit send from a review action. |
| P1.4 · Legacy date and QR recovery | P0.1, P0.3 and P0.4. Add explicit reasoned correction commands and retained evidence. Historical association dry-run design remains separate. | Date repairs leave fulfillment and subscription dates alone. QR changes retain historical artifact and correction history. |

## P2 · Complete mandatory scope and rehearse release

- **Active Email Sync.** Build on P0.2/P0.5 and P1.3. Cover all supported streams with inbound and available Sent/provider evidence, DSN capture/correlation, audit, manual reconciliation and Action/Error Queue. Use capability reporting and uncertainty where the provider exposes limited evidence. Release only after observation and replay tests with controlled mail fixtures. Protect existing threading, shared unread and decision semantics.
- **Company template.** Depends on P0.4 and P1.1 snapshot contract. Implement the approved NUSRV design for every COMPANY issuer, validate official/draft print and PDF output, and test historical rendering after issuer updates. P1.1 may ship earlier only where official output already preserves the approved legal and historical requirements. Capture enough versioned presentation data from the first officialization.
- **Workflow regression and operation.** Preserve Save/Close behavior, nested view context, controls and truthfully derived statuses. Rehearse fresh install and production-like upgrade using disposable MariaDB and mock transports, permission and concurrency tests, rollback compatibility, queues, observability and support handoff. Each slice includes applicable migrations, service, permission and job-idempotency tests and fixtures. Promote behind independent activation gates after evidence review.

## P3 · Bounded pending work and deferred scope

| Classification | Scope |
| --- | --- |
| Owner-policy activation | Legacy historical invoice association may be designed and inventoried now. Enable only after approval and candidate evidence. Resolve real cash exceptions only when facts require a new disposition. Any automatic post-bounce case-state change requires separate approval. |
| External reference prerequisite | Implement and activate the required INDIVIDUAL/PERSONAL template when the separately approved visual reference is available. Complete shared snapshot and selector infrastructure with COMPANY work. |
| Deferred or out of scope | Operational AI, automated customer renewal sends or automatic renewal invoicing, new accounting/reallocation systems, and external renewal/suspension/reactivation workflows. Existing settings visibility and inactive guards are mandatory P0 work. |

No pending policy or reference blocks the whole implementation. P0 is the recommended first independent authorization. Active Email Sync and the company layout are mandatory release work. Completion of a slice is measured by [acceptance criteria](IMPLEMENTATION_ACCEPTANCE_TESTS.md), migration evidence and scoped release controls.
