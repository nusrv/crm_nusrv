# Dependency-aware implementation plan

## Executive summary

Complete the policy and schema transition before cutting any release. Deliver identity, human communication and finance through explicit contracts and real boundary tests. Finish operational UX on those contracts. Each effort rating is relative for one engineer familiar with this repository and assumes access to a separate disposable verification environment. No calendar estimate is supportable without the remaining scope and production topology checks.

**Dependency order:** P0.1 policy and release gate precedes any rollout. P0.2 document gate precedes new official issuance. P1.1 stabilizes identity and recovery, then P1.2 finishes renewal operations. P1.3 uses that accepted-renewal contract. P2.1 can start while interfaces stabilize and completes with the P1 browser checks. P2.2 and P2.3 use the same release artifacts. P3 requires new authorization.

## P0 — Immediate release and data risks

### P0.1 · Establish a coherent manual-only release · High effort · A-01, A-06, A-10, A-13

- **Goal and components.** Block incompatible side effects and schema mismatch across API, workers, settings, Prisma and the deployment runbook.
- **Approach and prerequisites.** Record owner defaults and the policy cutover. Resolve modified and new files without discarding existing work. Add additive DDL only for agreed models. Regenerate Prisma in an isolated build, reconcile strict types and repeatable migration contracts, and require worker/API effective capability tests. Use explicit handling for old queued reminders, previous AI jobs, and known integration configurations. Coordinate the shutdown and start of workers so an old process cannot process new human-only states. Verify actual runtime topology separately with permission.
- **Risks.** Old binaries may still send under legacy policy. Blindly replaying old queued rows may send mail without authorization. Clearing them would erase history. Nullable source fields can break old readers. Migration locking and rollback timing depend on live volume and deployment architecture.
- **Acceptance.** Fresh migration chain and populated upgrade on an authorized disposable MariaDB with historical invoices, messages, accepted renewals and issuer branding. Validate, generate, typecheck, lint, build and run regression tests. Using mocks, confirm no automatic customer mail or AI/JoFotara operational calls, a real human command still queues correctly, internal evaluation stays intact, and direct routes match effective policy.
- **Recovery.** Pause outbound worker consumption or change a verified fail-closed release policy while investigating. Retain durable data and queue state. Roll back only to an app revision compatible with the schema and frozen side-effect policy. A restored database is a last resort after reviewing newer financial and mail records. Rehearse the order.

### P0.2 · Protect official document integrity · Medium effort · A-02, A-05

- **Goal and approach.** Correct Sales Tax No. in the shared renderer. Add bounded raster decode and reliable validation at official-record time. Make historical correction auditable. Preserve original QR and financial evidence where correction is required. Use owner-approved policy and image formats.
- **Risks and prerequisites.** Stronger validation could block old low-resolution images. A UI-only check can still leave invalid API writes. Verify formats against synthetic/approved fixtures. Coordinate operational handling before applying any blanket old-record gate.
- **Acceptance.** Synthetic malformed inputs rejected at API, large dimensions rejected before decode, valid QR and both issuer types render, buyer identifier never populates the issuer tax slot, existing snapshots survive migration, and actual browser PDFs are visually compared to approved fixtures.
- **Recovery.** Keep prior document assets and revision evidence. If a decoder regression occurs, suspend only affected official recording and fix forward. Preserve a separately authorized correction process.

### P0.3 · Restore forward progress in mail delivery · Medium effort · A-03, A-11

- **Goal and approach.** Give deferred reminders bounded next-attempt dates and report oldest eligible age. Modify persisted scheduling and CAS paths without altering identity pinning, historical schedule, suppression rules, or SMTP send budgets.
- **Risks and prerequisites.** Existing scheduled times carry meaning. Choose a new indexed field if reusing time would conflate audit and delivery. Rehearse simultaneous workers and old queue rows with no provider access.
- **Acceptance and recovery.** Verify newer eligible items proceed past 50 blocked ones, temporary conditions recover, terminal/cancelled jobs stay closed, and unknown outcomes are visible. On a release failure hold consumption, retain queue rows and reconcile using audit and Message-ID history. Roll back the selection logic only while the worker is prevented from replaying blocked legacy jobs.

## P1 — Operational stabilization

| Work item | Implementation and prerequisite | Risk and acceptance | Recovery and effort |
| --- | --- | --- | --- |
| P1.1 Bounded session and privileged revocation (**A-04**) | Derive expiration centrally and enforce the maximum from session start. Retry one guarded API call after a single in-flight browser refresh. Determine the required revocation window for finance/administration and implement session/user validation there as needed. Reconcile deployment examples. | Preserve CAPTCHA, cookie scope and existing permissions. Test active, disabled, revoked, downgraded, expired, old access token, concurrent refresh and absolute clock boundaries. Confirm supported proxy and browser behavior in authorized staging. | Security-safe rollback requires short access tokens and an understood forced sign-in. Keep existing session rows recoverable. Medium. |
| P1.2 Human reminder and reply review (**A-01**, **A-06**, **A-07**, **A-11**) | Finish preview, confirmed send, effective address policy, thread identity and durable history, and accessible reply review. Use mail worker changes from P0. Restrict the subject hint to unambiguous matched sender/mailbox. Persist proposed calendar dates on acceptance. Finish through a transaction that compares the tracked date and records the human transition. Include handling for previously accepted cases without proposals. | Be precise about repeat reminders versus duplicate requests and sender changes. Test BILLING/PRIMARY/fallback, missing and changed contacts, verified exceptions, one command per intent, reply headers, readable-reference fallback, unread state, leap/year-end months, three decisions and unpaid fulfillment. Verify internal and technical boundaries. | Disable human-send UI and server entry coherently while retaining reviewed messages and proposed dates. Pause delivery independently if necessary. High. |
| P1.3 Invoice sources, collections, receipts (**A-01**, **A-02**, **A-05**, **A-07**) | Complete accepted-renewal and manual source contracts, manual official issue, separate ledger and per-payment receipt snapshots. Use exact payment arithmetic and serialize balance checks. Validate cross-issuer existing customers, restrict lifecycle roles, and define retry outcomes. Depends on migrated schema, accepted-period contract and document gate. | Prior accepted records and immutable branding must remain readable. Concurrency tests for double-submit, installments and overpayment, and per-payment receipt uniqueness. Verify operator and print paths, state/date independence and absence of payment information on invoice output. Render receipts without a stamp. | Release behind reversible entry points with additive schema. Preserve every valid payment and receipt through rollback. Stop writes while investigating drift rather than deleting history. High. |

## P2 — Architecture and release quality

| Work item | Approach and dependencies | Acceptance, trade-off and recovery |
| --- | --- | --- |
| P2.1 Operator UX and accessibility (**A-09**, **A-13**) | Shared modal stack and success feedback, human labels, simpler nav, role-aware Settings, and correct print preview. Start on agreed API contracts. | Browser keyboard, focus return, repeated saves, parent context, role-specific views, renewal/review/payment states and actual NUSRV/Future/personal print fixtures. Migrate dialog families incrementally so an individual regression can be reverted. Medium to high. |
| P2.2 Repeatable verification and recovery (**A-08**, **A-10**) | Pin runtime and lockfile in build. Publish SHA-bound build/test provenance. Add protected checks, credential-free app smoke tests, disposable populated DDL checks, routine dependency review and restore drills. Bind local infrastructure to loopback. | Show artifact/DB compatibility, rollback runbook and secure local connectivity. Baseline package advisories belong in a separate, testable change set. A CI definition is reversible without altering runtime history. Medium to high. |
| P2.3 Measure worker and API cost (**A-03**, **A-10**, **A-12**, **A-14**) | Review query plans on realistic synthetic volumes. Instrument work lag, oldest eligible age and stuck leases. Add bounded batches or list projections only after measurements. | Verify no rows omitted, query count and payload size remain bounded, and healthy row processing under tenant or mailbox skew. Revert query changes independently of data. Medium. |

## P3 — Owner-approved options

Revisit provider enablement, collection analytics or stronger issuer-level staff segregation only after the owner states requirements and risk limits. A new service boundary, identity provider or data store is justified only by clearly measured load, operational requirements, or incompatible ownership boundaries. Preserve audits and existing records, prototype separately and release behind an explicit opt-in. Effort varies with the proposed capability.

## Quick wins and high-risk work

A tax-slot binding correction with the two-identifier fixture, loopback Compose defaults, clear effective-deferred labels, and a CI manifest tied to a verified SHA have bounded scope. Migration with mixed application versions, authorization changes, old-mail cutover, nullable invoice sources and balance/receipt concurrency need integration proof and documented rollback. Do not bundle unrelated dependency upgrades, adapter rewrites or large UI refactors into a release with unproven financial migrations.

[Evidence register](CODEX_INITIAL_REPORT.md) · [Challenge questions](CODEX_CHALLENGE_READINESS.md)
