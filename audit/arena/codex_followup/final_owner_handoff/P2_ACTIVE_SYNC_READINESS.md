# P2 Active Email Sync — source-level readiness and migration boundaries

Date: 2026-11-23
Branch: `work/p1-chatgpt-recovery`
Authority: `APPROVED_OWNER_REQUIREMENTS.md` (OD-12, CL-5/6), `FINAL_TECHNICAL_DESIGN.md`, `FINAL_IMPLEMENTATION_ROADMAP.md` and `IMPLEMENTATION_ACCEPTANCE_TESTS.md`.

## Source inventory (verified on the recovery branch)

- `MailInboundIngestService.syncAll()` scans enabled configurations with `inboundSyncEnabled=true` and their environment guard. It currently calls `syncOneConfig` for **one** `MailConfiguration.imapFolder`, with a per-configuration `lastSyncUidValidity` and `lastSyncUid`. Cursor-state checks, bootstrap CAS, UIDVALIDITY change containment, bounded ordered fetch, exact IMAP identity and per-UID cursor CAS are already implemented for the current inbound folder.
- `ImapMailboxReader.fetchMessagesSince()` checks UIDVALIDITY inside the same selected mailbox used to fetch messages. It does not provide a separate Sent folder/provider evidence sync.
- `EmailMessage` stores `mailConfigurationId`, `imapFolder`, `imapUidValidity`, `imapUid` and the scoped identity hash `imapIdentityKey` (already suitable for deduplicating an observable copy in another folder). Its direction/classification model does not, by itself, distinguish a DSN from a customer-authored inbound reply.
- `CommunicationOutbox` and `OperatorReplyOutbox` now maintain SMTP acceptance audit evidence and uncertain-send controls. Neither a historical `DELIVERED` state nor absence of a Sent copy proves receipt in the customer's mailbox.
- `MailInboundCorrelationService` maps customer message threads by bounded reply headers and sender; it was not built to treat delivery-status notifications as trustworthy customer decisions.
- Current `MailConfiguration` has one `imapFolder` and a *single* cursor pair. Reusing that cursor pair for INBOX and Sent would corrupt the source identity/checkpoint contract. P2 multi-folder observation must not reuse these fields across folders.

## Mandatory P2 gaps

1. A durable **folder-scoped checkpoint model**: per configuration and exact canonical folder with UIDVALIDITY, UID cursor, observation capability and last scan metadata. Prepare additive migration and isolated historical upgrade rehearsal before any worker uses new fields. Retain existing INBOX cursor identity and migrate only positively matched existing configurations. Do not guess a Sent folder name or assume every provider has one.
2. Read-only **provider/mailbox capability discovery**: support unsupported/unavailable folder states and clearly distinguish no access from no events. Do not change mailbox flags or mark existing messages read.
3. **Sent-folder/provider observations**: preserve source object ID, mailbox, folder, timestamps and exact Message-ID/envelope/recipient evidence, with case-sensitive correlation plus provenance checks. A Sent copy is an observation, **not** proof of SMTP recipient acceptance or final delivery.
4. **DSN evidence path** *before* normal human-reply processing: recognize structured report candidates, preserve raw/sanitized facts and unknown/untrusted cases, correlate only with sufficient mailbox/provider/attempt/recipient evidence. A spoofed From/subject/Message-ID must not by itself trigger hard-bounce state.
5. **Deduplicated Action/Error Queue**: confirmed hard bounce updates evidence and opens one human follow-up; preserves any prior SMTP acceptance, customer decision and Waiting state. No automatic re-send, refund, or new renewal state transition without separate owner approval.
6. **Integration validation**: mailbox UIDVALIDITY resets, folder checkpoint restarts, concurrent polls, out-of-order/duplicate provider evidence, unavailable Sent folders, crash after persistence, actor-based manual review, and zero automatic email replay.

## Safe sequencing

- Step P2.A: implement unit-testable evidence/capability definitions and a read-only operational inventory; no mailbox activation or provider connection.
- Step P2.B: author the per-folder cursor and evidence-source additive migrations, verified against the exact physical baseline and disposable MariaDB copy, before wiring worker polling.
- Step P2.C: implement mailbox/provider read-only observation adapters and bounded checkpoint CAS, with deterministic fixtures. Preserve existing INBOX behavior independently.
- Step P2.D: implement trusted DSN/reconciliation projection and human Action/Error Queue, behind owner-controlled activation switches, after race tests.
- Step P2.E: verify supported streams end-to-end with controlled SMTP/IMAP, explicit unavailable capabilities, retained history and rollback/old-worker fencing.

## Release boundary

**P2 Active Email Sync is not implemented or operationally verified.** This document is an inventory and safe design sequence only. Existing per-mailbox switches stay at their current settings; no new synchronization is activated here. In particular, do not point `MailConfiguration.imapFolder` at Sent just to gain observations, because doing so would abandon or invalidate the INBOX cursor identity.

## Implementation checkpoint — P2.A offline classification (2026-11-23)

Added `apps/api/src/modules/mail/active-email-evidence.ts`, plus `active-email-evidence.spec.ts`, on the temporary recovery branch. This new **unwired, side-effect-free** module accepts explicitly scoped source observations and requires exact mailbox configuration, case-sensitive Message-ID, intended recipient, outbound attempt and source-object identifiers before producing any correlated observation. It distinguishes observed Sent, generic inbound, provider observation and candidate DSN. All results explicitly leave delivery status `UNKNOWN`; a reported HARD DSN is a **candidate**, never a confirmed bounce or an instruction to resend, modify Waiting for Customer or change renewal state.

The module deliberately contains no network/mailbox calls, no worker integration, no database writes, no AI calls and no automatic replies. It does **not** authenticate DSN or provider provenance: those integrations remain open and must check trusted source and attempt evidence before elevating a candidate.

Unit tests cover Sent-not-delivered, hard/ambiguous DSN-not-authoritative, case-sensitive identifiers, recipient/attempt/mailbox mismatch, missing source identities, provider-without-IMAP-folder, and untrusted general inbound observations.

**Not yet executed after this checkpoint**: current workflow triggers are intentionally manual-only for this repository; no tests, database or mail were run by adding these files. P2.A is partially authored, not accepted or activated.

## P2.A operational inventory endpoint — source checkpoint

Added `GET /settings/health/evidence-sources` under existing `IntegrationHealthController`, requiring the same **ADMIN/IT** read access as integration health. It calls `IntegrationHealthService.getEvidenceSources()`, which only performs a selected `MailConfiguration.findMany` query. It does not decrypt or emit credentials, read mailbox contents, test provider connections, advance cursors or write records.

The return value distinguishes each configured inbound IMAP folder's state as `DISABLED`, `NOT_CONFIGURED`, `BLOCKED_BY_DEPLOYMENT` or `CONFIGURED_ONLY`. The last state is a **configuration inventory**, not proof of reachability or message evidence. Sent folder, provider events and DSN correlation explicitly say `NOT_IMPLEMENTED` for every mailbox rather than fabricating support or confusing 'no access' with 'no events'. Source date `lastInboundSyncAt` is an existing last-sync observation only.

Added unit scenarios for fully configured, disabled, missing-credential and mock-deployment cases; stale previous inbound sync never implies Sent/DSN support. Added a controller-level role metadata regression check to keep the endpoint ADMIN/IT-scoped.

**Not yet executed on CI since manual-only mode was selected; therefore P2.A remains source-implemented but unverified and P2 remains incomplete.**

## P2.B source checkpoint — independent per-folder IMAP cursors (2026-11-23)

### Added without activating mailbox synchronization

- Prisma model `MailEvidenceFolderCheckpoint` and purely additive migration `20261123014000_p2_folder_scoped_evidence_cursors` introduce a *new* folder-scoped checkpoint table with a per-mailbox identity digest, source kind, optional UIDVALIDITY/UID cursor and capability metadata.
- `syncEnabled` defaults **false**, `capability` defaults `UNPROBED`, and both cursor fields initially stay NULL. The new table has no automatic backfill or seed. No existing mailbox, subscription, customer, invoice or message row changes.
- Existing `MailConfiguration.lastSyncUidValidity`, `lastSyncUid`, `lastSyncedAt`, `inboundSyncEnabled` and the current inbound worker remain unchanged. **The old INBOX cursor remains authoritative.** New folder checkpoint rows are *not* consulted by any running worker.
- The folder identity helper reuses the frozen IMAP rule: only INBOX is case-insensitive; Sent/sent and whitespace-distinct folders get separate `v1:` + SHA-256 keys, scoped under the actual MailConfiguration ID. The hash, rather than a case-insensitive MariaDB collation on raw folder names, enforces uniqueness.
- The pure cursor policy refuses automatic cursor bootstrap, partial cursor repair, UIDVALIDITY reset and nonmonotonic progression. Future implementation must perform actual updates via database compare-and-set.
- New unit tests cover canonical folder distinctions, stable key, invalid names, uninitialized/inconsistent checkpoints and safe monotonic decisions.
- New source-only migration checks verify no DML/alteration of legacy mailbox tables, default-off sync, SQL/Prisma names and MariaDB identifier lengths.
- A disposable MariaDB fixture validates per-folder distinct rows, disabled defaults, unique index and FK constraints, without touching existing INBOX cursor. It is included only in the **manual-only** MariaDB workflow; no test was automatically triggered.

### What was actually verified this turn

A direct source inspection of the committed SQL and schema verified the table/name mappings, four explicit index/FK identifier lengths (all at most 64 characters), the default-off schema/DDL agreement, no existing table alteration, and two new-table-only SQL statements. This is **static evidence**, not `prisma validate`, `prisma migrate deploy`, a live database transaction or a successful Jest run. The environment cannot directly dispatch branch-only GitHub Actions through the current connected GitHub actions; the repository's workflows remain manual-only by owner instruction.

### Required P2.B acceptance before any P2.C worker wiring

1. Run Prisma Client generation, typecheck, lint and P2-focused Jest tests against this exact head SHA.
2. Apply the new migration to an isolated fresh MariaDB and a representative upgrade snapshot, inspect `prisma migrate status` and verify legacy cursor values and enabled flags are byte-for-byte unchanged.
3. Run the new DB uniqueness/default-off/cursor tests, including case-distinct names under the default case-insensitive table collation.
4. Agree explicit Sent folder identification and first-observation bootstrap policy; NEVER assume all providers use `Sent` or silently reuse the existing INBOX cursor.
5. Review old worker fencing, UIDVALIDITY failure/epoch remediation and per-folder CAS under two concurrent disposable workers before enabling new folder scans.
6. Keep DSN evidence as untrusted until trusted source/attempt/recipient checks exist; no automatic re-send or new case transition.

The disposable MariaDB test now also includes a two-writer compare-and-set race: two updates with the same exact expected UIDVALIDITY and UID must produce one successful update and one rejected stale update, without enabling polling. Its mailbox fixture uses a canonical, real `BILLING_ENTITY:<id>` scope instead of an invented test-only scope. The test remains **unexecuted**.

**Status: P2.B schema/helper/tests committed on the temporary branch, integration validation pending; no P2.C activation.**

## P2.C read-only Sent preview source checkpoint — 2026-11-23

The actual checked-in P2.B work was inspected before beginning P2.C. The new `MailEvidenceFolderCheckpoint` Prisma model and `20261123014000_p2_folder_scoped_evidence_cursors` migration are purely additive; `syncEnabled` defaults false and the independent UID cursors default null. The legacy inbound worker still uses only the old MailConfiguration INBOX cursor.

### Source fixes / regression coverage

- The existing P2.B disposable MariaDB test previously depended on the first Jest case creating a Sent checkpoint. Its duplicate-key and concurrent-CAS tests now create their **own** independent folder records. The legacy-cursor preservation case now seeds non-null old INBOX UIDVALIDITY/UID values and asserts that a new Sent checkpoint does not alter them.
- `decideFolderCursorAdvance()` now treats invalid, zero and negative UID/UIDVALIDITY inputs as requiring review instead of silently labelling them already observed. Added unit cases.
- Added `mail-evidence-sent-preview.ts` as a **standalone, unregistered helper**, with `mail-evidence-sent-preview.spec.ts`. Only a source explicitly marked `SENT`, `syncEnabled: true`, `capability: AVAILABLE`, with a valid exact folder identity and established consistent UID cursor can request a bounded fetch. The current persisted defaults provide **none** of those activation prerequisites automatically.
- `previewSentFolderObservations()` uses the existing `MailboxReader.fetchMessagesSince()` contract (including its same-selection UIDVALIDITY check). It returns up to **50** read-only UID/Message-ID metadata observations with case-sensitive source identity and delivery status `UNKNOWN`, or an explicit no-read/review outcome. A stale UID epoch, duplicate/descending/old UID, oversized batch, missing cursor or wrong folder role produces no observation. This helper never writes, schedules, sends, modifies a cursor, persists message contents, or asserts a reply, acceptance, delivery or bounce.
- The new preview suite is included in the repository's **manual-only** P1/P2 source validation workflow. The disposable MariaDB workflow already includes the P2.B folder-checkpoint fixture.

### Verification performed and evidence limits

Ten **source-structure checks** were performed against the current GitHub branch: migration-only new table; default-off; null initial cursors; unmodified legacy worker; preview not registered as route/worker; no write/send calls in preview; bounded reader use; fail-closed outcomes; presence of regression tests; and both workflows remaining `workflow_dispatch`-only. All ten passed. These are static source checks, **not** TypeScript/Jest/SQL runtime tests.

The latest full green source CI in the repo still predates these edits. The current GitHub connection cannot dispatch the branch-only workflow; no CI run was started to avoid reversing the owner's manual-only preference. Accordingly **P2.B and the P2.C preview remain unverified at the current head**, and P2.C active integration is NOT authorized.

### Next required evidence and work

1. Manually run the existing branch-specific source CI (Prisma generation, typecheck, ESLint, focused P2 Jest, full API Jest and additive migration Node invariants).
2. Manually run the disposable MariaDB P2 folder checkpoint fixture and migrate an authorized representative upgrade snapshot. Capture schema/drift reports and exact pre/post old-cursor values. The historic combined MariaDB suite has known older failing cases; keep them visible and separately triaged.
3. Review and approve an explicit per-provider Sent folder discovery and baseline policy. Do **not** guess folder names or copy INBOX UIDs.
4. Only after P2.B passes, design the durable per-folder CAS and observation persistence with outbox evidence provenance and idempotency. No new worker should be wired until the old-worker and fallback behavior is tested.
5. Keep DSN/SMTP/provider evidence untrusted until source, attempt and intended recipient can be corroborated. No automatic resend or renewal transition is permitted.

## P2.C observation ledger and atomic checkpoint commit — 2026-11-24

### Implemented on the temporary recovery branch, NOT activated

- Added **MailSentObservation** in Prisma and the strictly additive migration `20261123015000_p2_sent_observation_ledger`. It creates only `mail_sent_observations`; no existing `mail_configurations`, `email_messages`, INBOX cursors or P2.B folder rows are modified or backfilled. There is no seed, new job or activation flag.
- Each observation is attached to one existing **MailEvidenceFolderCheckpoint** with a RESTRICT foreign key, a globally unique frozen v1 IMAP source identity key, and a second unique constraint on folder checkpoint + UIDVALIDITY + UID. Only bounded metadata (internal date, optional Message-ID, parse-failure flag and source identifiers) is stored; never raw body/HTML, recipient addresses or credentials. Delivery status defaults to `UNKNOWN` and an exact-case MariaDB CHECK prohibits any other value, even under case-insensitive table collation. CHECK also requires positive UID and UIDVALIDITY.
- Added `prepareSentObservationWritePlan()`, a **pure** safety boundary that recomputes all stable hashes, requires an explicitly enabled, available SENT folder, validates the epoch, monotonic UIDs, current expected cursor, storage limits, and rejects fabricated delivery assertions or malformed preview batches.
- Added `commitSentObservationPreview()` as an **unregistered, uninvoked transaction primitive**. It locks and reloads the real folder checkpoint, checks that its parent mailbox remains enabled and its cursor/scope are unchanged, revalidates the batch from persisted source identity, inserts observation rows, checks the inserted count and conditionally advances **only the new folder checkpoint** in one Prisma transaction. A duplicate, stale claim, disabled source, failing insert or failed cursor CAS raises an error and should roll back the full transaction. This path does not send/retry email and never touches the existing INBOX worker.
- Added Jest cases for scope/identity tampering, disabled/stale source, wrong delivery state, malformed UID, bounded headers, no-op empty preview, duplicate insert, partial insertion and losing CAS. Expanded the isolated MariaDB P2 fixture to check unique keys, FK, uppercase-only UNKNOWN, positive UIDs, two concurrent commits, failed duplicate insert with no cursor advance and preservation of the existing INBOX cursor values. **The MariaDB scenarios are written, not executed after these commits.**
- Updated the manual-only source-validation workflow with focused P2 ledger tests and `p2-sent-observation-migration.test.mjs`. The manual-only disposable MariaDB workflow already includes the expanded `p2-evidence-folder-mariadb-live.spec.ts` fixture.

### Verified in this authoring session

Twelve direct **source-structure checks** passed on the checked-in branch: only two new-table DDL statements; no old table DML; matching Prisma relationship; exact source/epoch uniqueness; all six SQL names within the 64-character MariaDB limit; exact-case UNKNOWN-only and positive UID constraints; no message bodies/recipients; explicit transaction/row lock; insert and cursor CAS within the same transaction; no registration in mail module, worker app or old inbound ingestion; and both workflow triggers still `workflow_dispatch` only.

**These checks do NOT prove that generated Prisma Client compiles or the new migration passes on MariaDB.** No CI dispatch, MariaDB transaction, IMAP session, SMTP send, application deployment, production migration or main-branch update was performed in this round. Historical MariaDB suite failures from the earlier run remain unresolved until rerun.

### Exact verification gates for the current head

Use the existing manual-only GitHub workflows on `work/p1-chatgpt-recovery`, or run in an isolated checkout with dependencies:

```powershell
npm run db:generate
npm run typecheck
npm run lint
npm run test -w @cp/api -- --runTestsByPath src/modules/mail/mail-evidence-sent-preview.spec.ts src/modules/mail/mail-evidence-folder-identity.spec.ts src/modules/mail/mail-sent-observation-plan.spec.ts src/modules/mail/mail-sent-observation-commit.spec.ts
node --test apps/api/prisma/p2-sent-observation-migration.test.mjs
```

In a *throwaway* MariaDB instance with an explicitly verified local test URL and freshly generated Prisma Client, rehearse `prisma migrate deploy` and `prisma migrate status` first, then run `apps/api/prisma/p2-evidence-folder-mariadb-live.spec.ts` using the repository's disposable DB workflow. Separately test a representative legacy schema/upgrade snapshot and verify pre/post existing INBOX UIDVALIDITY, UID, sync-enabled flags and table counts. Do **not** run these migration commands against `crm.nusrv.com` or production data.

### Remaining before P2.C/P2.D is eligible for release

1. Current-head generation, TypeScript, lint, full Jest and live disposable MariaDB migration/transaction tests **must pass**, including the concurrent two-writer case and correct transaction rollback.
2. Approve explicit provider-specific Sent folder selection, capability/UID baseline policy and a responsible ADMIN activation path; no guessing folder names or copying INBOX UIDs.
3. Add and verify a bounded authenticated orchestration layer with provider/environment gates and worker fencing before binding this primitive to real polling. Its absence is intentional.
4. Implement trusted DSN/provider/recipient/attempt provenance and operator Action/Error Queue separately under OD-12 and CL-5/6. A Sent copy still never proves message delivery, and no automatic resend or decision transition is authorized.

**Current status: P2.C observation persistence architecture and tests committed, but not compiled, executed, activated or release-approved.**

## P2.C guard hardening — 2026-11-24

Source review uncovered an authorization race in the unregistered `commitSentObservationPreview()` transaction primitive: it locked only the Sent folder checkpoint and checked its parent mailbox `enabled` state without locking the parent. The code now takes a **parent MailConfiguration row lock first**, then the folder checkpoint row lock, reloads the folder with its parent enabled flag, and only then inserts observation metadata and advances the new cursor. This lock order is explicit and asserted by the offline unit harness. A concurrent ADMIN mailbox disable must therefore serialize with the evidence transaction rather than racing the enablement read. Future orchestration and administrative write paths must retain compatible lock order to avoid deadlocks.

The pure `prepareSentObservationWritePlan()` now rejects runtime-invalid MIME metadata even when TypeScript types are bypassed: non-BigInt UIDs, non-boolean parse-failure state, non-string Message-ID, control-character/CRLF/NUL Message-ID headers, and out-of-bounds lengths. Added test cases with **real** escaped CRLF and NUL characters, not literal backslash sequences. These invalid observations cannot be committed as normal metadata.

Added a disposable MariaDB fixture that disables the real parent MailConfiguration before trying to commit a valid Sent preview, asserts **no observation inserted and no cursor movement**, then restores the original configuration value in a `finally` block. It does not start IMAP, SMTP or a worker.

**Verification status:** changes are committed on `work/p1-chatgpt-recovery` but the repository's CI remains manual-only. These tests have **not run** on the current head; typecheck, lint, Prisma generation, P2 Jest, and disposable MariaDB integration still gate release. The feature remains unregistered, unscheduled and unactivated, with no change to `main` or production.

## P2.D candidate-DSN review boundary — 2026-11-24

### Confirmed against the controlling roadmap and acceptance criteria

The mandatory P2 Active Email Sync work calls for a DSN/bounce evidence lane **before** ordinary inbound reply/unread processing. A valid-looking MIME report or a `5.x.x` status is still untrusted without an authenticated mailbox/provider source, attempt ID, intended envelope recipient and original Message-ID. A confirmed hard bounce must eventually produce exactly one operator follow-up, preserve prior SMTP acceptance, Waiting for Customer and renewal decision, and never automatically resend. Those trusted correlation, persistence and queue steps remain **unimplemented**.

### Source-only implementation saved on recovery branch

Added `apps/api/src/modules/mail/dsn-candidate-parser.ts` and `dsn-candidate-parser.spec.ts`.

- Pure, bounded RFC 3464-style `multipart/report; report-type=delivery-status` / `message/delivery-status` candidate parser. It does not guess from Subject, From, human-readable message text, or an unauthenticated SMTP response.
- The parser caps report bytes (64 KiB), lines (256), line length (1024), and recipient records (32). It rejects malformed MIME, duplicates/contradictions, CRLF/NUL corruption, missing source identifiers and bad runtime input types. It records only the claimed recipient, Action, enhanced Status and candidate HARD/SOFT/UNCLASSIFIED category; it does **not** include diagnostic body text or provider credentials.
- Every parsed report explicitly returns `CANDIDATE_DSN`, `deliveryStatus: UNKNOWN` and `requiresHumanReview: true`. Unusable DSN-shaped reports are marked `UNUSABLE_DSN` for separate review. Neither becomes a confirmed bounce, customer reply, SMTP acceptance, action or state change.
- Added `selectDsnInboundTriage()` as an **unwired pure contract**: recognized/invalid DSN-shaped reports must be handled in a future DSN human-review lane, not by ordinary customer reply correlation. Normal non-DSN messages remain ordinary inbound.
- Focused Jest cases cover multiple recipients, duplicate/cross-recipient ambiguity, hard/soft candidate distinctions, malformed statuses, header folding, spoofed freeform content, unbounded payloads, runtime-type tampering, genuine CRLF/NUL source injection, and the no-customer-decision triage rule.
- Registered the focused spec only in the existing **manual-only** GitHub Actions source workflow. Both project workflows still use `workflow_dispatch` and have no `push` trigger. No Inbox worker, HTTP controller or mail transport imports this helper.

### Verification and remaining gates

A ten-point static source inspection of the exact branch files passed, including bounds, no delivery authority, DSN-before-reply triage contract, explicit test inclusion, and unchanged manual-only workflow triggers. This is **not a runtime test**. The tests were not run, because the connected GitHub workflow dispatch capability is unavailable here and restoring automatic push triggers would violate the owner's instruction. A direct repository checkout is also unavailable from this isolated execution environment.

Before enabling P2.D, obtain current-branch TypeScript/lint/Jest and disposable MariaDB verification for P2.B/C, then add trusted MIME-part extraction in the IMAP/provider adapters, independent source provenance, attempt- and recipient-safe correlation, deduplicated persisted review and Action/Error Queue, and controlled operator resolution. Preserve existing unread/review semantics and prevent any bounce-triggered case transition without separately approved policy.

**State: P2.D parser/triage source added; no live DSN detection, correlation, delivery update or queue activation. P1/P2 release remains blocked.**

## Recovery validation and continuation

The local recovery branch was fast-forwarded from `00700968b84b829d9ef00b86519ae389df97b417` to the latest fetched remote head, `47274dccebf1b19dbb7e499456b6437bcd451e82`. The range contained 184 commits across 68 paths. The tracked worktree and index were clean on entry. The two pre-existing untracked files, `Prepare-NUSRV-Handoff.ps1` and `tatus --short`, were kept outside the change. This section supersedes the older test-status notes above for the recovered code and this continuation.

### Implemented locally

- **P2.C Sent discovery and baseline.** The IMAP adapter uses LIST/XLIST server flags to identify one selectable Sent folder and preserves the exact returned path. Missing capability, name-only guesses, ambiguity and a disabled mailbox leave the source unavailable. The future-only baseline planner requires an explicitly selected exact folder and an inactive, untouched checkpoint for that same mailbox and folder. Its proposal uses the selected mailbox's `UIDNEXT - 1` and its current UIDVALIDITY. Saving that baseline and enabling observation remain separate operations. The proposal neither writes nor resets any checkpoint.
- **P2.C bounded ordered read.** The Sent preview selects the lowest outstanding UIDs using bounded ESEARCH MIN/COUNT responses within the UID range of the same read-only mailbox selection. It requests the exact selected UIDs, restores ascending order and rejects a partial, substituted or duplicate FETCH result. An unsupported server produces an explicit unavailable outcome. UIDVALIDITY disagreement and invalid UID bounds produce no cursor candidate. The existing INBOX fetch and ingestion contracts are unchanged. Each Sent preview requests at most 50 message sources and can issue up to 50 search round trips. Provider compatibility and timing still need controlled integration evidence.
- **P2.D follow-up planning.** The pure planner requires agreement between parsed DSN content, an independently authenticated provider report supplied by a future server-side adapter, and the original mailbox, attempt, Message-ID and envelope recipient. Only a matched permanent failure yields a human follow-up plan. A stable key de-duplicates by mailbox, attempt and recipient while each report keeps its own source identity. Missing provenance, inconsistent fields and transient reports stay in review. No provider verifier, persistence, queue entry, customer decision change or resend is executed by this planner.
- **Common COMPANY template.** The existing shared invoice renderer was retained. Static render regression now checks common document sections, the single issuer tax field, and separate issuer values across NUSRV, Future Foresight and a third company. The existing historical snapshot, independent draft, and receipt rendering cases remain in the local checks. Chrome printed four local synthetic fixtures, including NUSRV, Future Foresight, historical and draft, to valid one-page PDFs using dedicated profiles. Comparison with the approved reference and a print run through the authenticated application remain open. The separate individual visual reference remains required.
- **Baseline defects.** Replaced four control-character regular expressions with equivalent explicit character classification and corrected three unsafe Jest matchers. The folded DSN fixture contains two recipients, so the regression now checks both. The Windows sandbox failed to resolve the account name required by the installed `tsx` runner; an isolated rerun outside the sandbox with database and browser integration variables cleared passed that wrapper.

### Activation gates

1. Rehearse a fresh and legacy-upgrade migration on verified disposable MariaDB using synthetic data. Exercise both P2 tables, folder-scoped uniqueness, duplicate prevention, transaction rollback, competing workers, disabled mailbox, unchanged INBOX records and P1 financial invariants. Verify backup and restore and capture schema and Prisma mapping evidence. The local Docker named pipe was unavailable, the service was stopped and no installed standalone MariaDB executable or dedicated disposable endpoint was verified. No database was contacted.
2. Run a controlled provider fixture for Sent discovery, ESEARCH support, sparse or expunged UIDs, epoch changes and elapsed-time bounds. Authorize baseline persistence and activation separately. Verify P0 worker replacement and deployed schema compatibility before enabling the Sent worker.
3. Build authenticated provider provenance and structured MIME extraction before wiring DSN triage into ingestion. Verify a durable exact attempt and envelope-recipient binding across repeat attempts, then persist independent evidence and de-duplicated follow-up in one transaction. Complete controlled operator resolution and permissions. A Sent copy, unauthenticated DSN, or unresolved report preserves SMTP evidence, the customer decision and Waiting for Customer.
4. Complete controlled COMPANY visual comparison and an authenticated print run. The separate P0 full-process browser restart gate remains open. Runtime communication, operational database changes and deployment still require separate authorization.

The two GitHub Actions workflows remain manual-only. This continuation leaves P2 Sent polling and DSN processing inactive.

### Executed checks

Validated source commit `2e01c2603fb7bbcb612370f262cb33ea19072d58`.

| Check | Outcome |
| --- | --- |
| Dependency install | Lockfile install completed from the existing npm cache with lifecycle scripts disabled. Prisma client generation ran explicitly. |
| Prisma | Client generation and schema validation passed with an unused loopback connection string. Migration SQL was never applied. |
| TypeScript, ESLint, Next production build | All passed. |
| API Jest | 1,389 passed, 139 skipped, 0 failed across 152 executed suites. The skipped set includes environment-dependent database and browser cases. |
| Focused P2 Jest | 95 passed in eight suites, also covered by the full API run. |
| Node invariants and migration contracts | All 28 passed, including P2.B and P2.C static migration contracts. |
| Invoice/receipt rendering | Both synthetic fixture scripts passed. Chrome produced valid, one-page PDFs for four synthetic invoice cases. The dedicated Chrome profiles were removed afterward. |
| Disposable MariaDB and provider integration | Blocked by the missing verified environments. Fresh and upgrade migrations, Prisma mappings against migrated tables, finance invariants, worker races and backup/restore remain unverified at this source commit. |
| P0 full-process browser restart | Prior blocked status retained. The synthetic print smoke tests did not exercise authentication or profile persistence. |

## WIP recovery checkpoint

Continued from `beca204dd648076bb4e7d3bb40831f75c4d4042c`. Read-only specialist review found that the historical runner is already serial, but expired 30-second hooks can leave uncancelled schema setup and cleanup running across suites. The saved run reported 8 passed, 98 failed and open handles. Only explicit migration fixture budgets changed, to 120 seconds. Assertions and migration SQL were preserved. No new test result was captured. The pending focused command was interrupted before a result was available and was not rerun during this checkpoint.

The portable MariaDB 11.4.12 launcher created a disposable loopback server in the ignored cache. Before resuming, verify the prior listener is stopped and provision a fresh run using `node_modules/.cache/nusrv-recovery/start-mariadb-rehearsal.ps1` and the previously verified portable bundle. Verify PID, executable, start time, sole loopback listener, SQL datadir and scoped database account. Set both database URL variables to the new manifest's legacy target, with SMTP and IMAP disabled and AI mocked. Next command from the repository root:

```powershell
npm.cmd run test -w @cp/api -- --runTestsByPath prisma/mariadb-phase3-slice-c-live.spec.ts
```

Then isolate each legacy suite's schema and process, close setup and cleanup connections after failure, and rerun the historical suite before classifying business failures. The provider harness and Action/Error Queue remain design-only in this checkpoint. Use scripted IMAP and test-only signed provider evidence with the existing Sent and DSN helpers. Verify exact identities, replay, conflicts and delayed evidence without activating a worker. The five documented legacy timestamp defaults remain untouched.

## Disposable MariaDB validation

This execution began at `6c6a48d0dfbd427c574dc0af2f52751c92550695` on `work/p1-chatgpt-recovery`. The Docker CLI was present, but the Windows service was stopped and there was no accessible engine pipe. The rehearsal used the official portable MariaDB 11.4.12 Windows ZIP, verified against the published SHA-256 checksum. The server ran with a newly initialized data directory, no registered service, no Docker volumes and one listener bound to `127.0.0.1:3306`. A generated manifest bound the listener to the server PID, executable and start time. Each runner rechecked the database version, data directory, exact schema and dedicated scoped account before writes. All records were synthetic.

After the tests, the verified server shut down gracefully and port 3306 had no listener. The two run-owned data directories and the credential manifest were removed. The ignored rehearsal scripts, sanitized logs and synthetic backup evidence were retained locally.

- **Fresh install.** All 26 checked-in migrations applied. Prisma status and no-op redeploy passed. The physical schema contained 54 tables, including seven checked mappings. Focused tests exercised P0/P1 finance and both P2 evidence tables.
- **Populated upgrade.** The exact 24-migration pre-P2 archive at `2927775c84891377749744f174514fbf23219990` upgraded to 26 applied migrations. The two appended migrations preserved the established synthetic INBOX cursor, folder and settings flags. Both new P2 tables started empty. Named index, foreign-key and CHECK definitions were inspected, and a repeat deploy was a no-op. The populated rehearsal exercised the two P2 migrations, with P0/P1 exercised on the fresh path.
- **Backup and restore.** A first restore failed with MariaDB error 1227 because two audit triggers carried the source account as their definer. The original dump was retained. After resetting only the verified disposable restore schema, the retry changed exactly those two definers to the restore principal. The restored 26-entry ledger, synthetic INBOX state and P2 DDL matched. The restored append-only triggers rejected both UPDATE and DELETE probes.
- **Focused integration.** The initial run passed nine of ten tests. The failing fixture asserted that all rows on a shared test mailbox were disabled even though preceding test cases explicitly enabled their own checkpoints. Restricting the assertion to the newly created checkpoint preserved the default-off check and every existing INBOX assertion. The corrected real MariaDB run passed all ten focused cases, covering exact financial values, receipt revision and void, transactional rollback, concurrent duplicate keys, foreign keys and indexes, duplicate evidence, concurrent Sent commits, disabled parent containment and INBOX preservation.
- **Concurrent fulfillment.** The final focused MariaDB run passed 11 of 11 tests across two suites. The added service-level fixture gave competing actors the same accepted renewal and correctly linked, verified official invoice with zero payments. One request fulfilled the renewal, advanced the tracking dates once and wrote one audit event for the winning actor. The other returned a conflict. No payment was created.
- **Physical schema diff.** Prisma's read-only comparison returned exit 2 for five legacy `updated_at` defaults. The physical database supplies `CURRENT_TIMESTAMP` on `currencies`, `customer_code_sequences`, `customer_email_addresses`, `customer_phone_numbers` and `subscription_code_sequences`, while the Prisma declarations omit that default. No P1/P2 mapped table difference was reported. Historical SQL was preserved.
- **Legacy regression.** The separate destructive fixture runner reported 8 passed and 98 failed across ten suites, with one suite passing. Most failures cascaded from 30-second setup/teardown hook timeouts and shared-schema DROP TABLE conflicts. The resulting run did not reach a reliable assessment of the legacy business assertions. Jest printed final counts then held open handles. Only its verified rehearsal child process was stopped to let the log close. This remains a failed regression gate. Isolate each fixture schema or ensure timed-out setup cannot overlap the next suite before relying on a broad rerun.

## Source hardening after the database rehearsal

- The Sent reader checks that the path actually selected by the IMAP client exactly matches the approved path before forming a baseline or scanning. A case variant with the same UIDVALIDITY fails closed. A durable baseline binding to the mailbox's connection identity and invalidation when settings repoint the mailbox remain prerequisites for scheduling.
- The DSN follow-up key now includes the exact outbox type and ID. The new disconnected resolver corroborates independently verified provenance with a bounded read of system start and SMTP acceptance audit events for that typed subject. It checks the exact source object, mailbox, wire Message-ID, attempt and envelope recipient. Missing, duplicate, malformed, mock or mismatched evidence remains in review. A real acceptance after lease loss remains admissible. The resolver reads only audit events and does not change delivery, customer, renewal or waiting state.
- Provider authentication and correlation using a controlled fixture, the durable operator queue and authorization for controlled resolution remain open. There is no new polling registration or production activation. P2 COMPANY visual comparison and authenticated printing, P0 full-process session restoration and the physical production schema remain separate release gates.

### Final regression and delegation

Source commit `ac28a27b2d3f0864642b3a0cf1941d0eced3e019` passed 1,396 API Jest tests in 153 executed suites with 140 tests skipped and zero failures. All 28 Node invariants, Prisma generation and validation, workspace TypeScript and ESLint, the Next production build, and both invoice and receipt render fixtures passed. The prior Chrome print checks remain the browser evidence. No new authenticated browser or provider session ran.

The `routine_low` role ran the infrastructure inventory and fresh/legacy database runners and diagnosed the shared fixture failure. `design_medium` managed the upgrade and restore, prepared the concurrent fulfillment fixture design and identified the source binding needed for Sent orchestration. `critical_high` reviewed the SMTP audit and exact DSN scope boundary. Each role used its configured GPT-6.2-Sol tier. Independent runtime model introspection was unavailable. The specialist roles excluded tracked application edits, so the coordinator made the scoped source, fixture and report changes and reviewed the results.

The next implementation gate is a controlled provider fixture for authenticated source and attempt correlation. Preserve each provider observation under an account-scoped unique event identity. Add a separate durable follow-up unique by typed outbound subject, exact attempt and recipient. A confirmed replay may add evidence without duplicating or reopening a task. A current authorized operator's conditional resolution and append-only audit should share a transaction. None of those operations may send mail or change SMTP acceptance, customer decisions or Waiting for Customer.

## Legacy suite isolation recovery

ChatGPT resumed the verified remote checkpoint `ea068fecbdb87aeecb481f26e684ee2db11083d9` without discarding the five Codex commits or the WIP 120-second fixture budgets. The prior historical run remains a failed gate: 8 passed, 98 failed. No MariaDB server or accessible project dependencies were available in the current execution environment; no live database test was attempted.

- The legacy launcher now has ten explicit suite IDs and exact Jest paths. Each suite requires a separately provisioned empty loopback schema named `nusrv_legacy_<suite>_test`, with a scoped non-production account; both child DB URL variables are set to that target. Full mode requires an explicit JSON mapping for all ten dedicated targets (`MARIADB_TEST_SUITE_URLS`). Do not reuse a timed-out or partially seeded schema. The launcher does not create or drop databases, and does not prove server ownership merely from a URL: verify PID, executable, listener, datadir and account independently before provisioning.
- A preflight queries the selected schema and its table count, refusing nonempty or inaccessible targets. SMTP and IMAP are disabled and AI mocked for the test child. Each exact suite runs in its own Jest process, with an eight-minute child deadline and explicit failure/timeout reporting. The manual MariaDB workflow uses an isolated service container per historical suite (matrix, fail-fast false, max parallel 2) and keeps its focused P1/P2 job separate. Both workflows remain manual-only; no dispatch occurred. Local multi-suite mode still requires the operator to provision and later remove the disposable instance/schemas.
- Twelve existing fixture teardown hooks close setup connections in `finally` if Prisma disconnect or schema reset rejects. This is not proof of cancellation of an in-flight SQL query: a timeout still invalidates the run, and the next suite must never use its schema. The multi-describe backfill suite may still need further intra-suite lifecycle isolation if its own hooks time out. No business assertion, migration SQL, production setting or operating worker was changed.
- **Executed verification:** copied the launcher planner and its test file from the Git tree into an isolated Node 22.16.0 environment, verified exact Git blob IDs `f0c161db16a0093c771a601d7bb28e95853b9eb7` and `ce38b1b84b0fed1f29220a43911400966a417046`, and ran `node --test mariadb-integration-plan.test.mjs`: four passed, zero failed/skipped. These are pure launcher contract tests using fake spawn/preflight, not an actual DB preflight or MariaDB/Jest integration result. The new tests are also included in the manual source workflow.

### Next executable gate

In the project checkout, provision a verified disposable MariaDB instance and a fresh empty schema `nusrv_legacy_phase3c_test` with dedicated credentials. Set both `DATABASE_URL` and `MARIADB_TEST_DATABASE_URL` to that same exact loopback target. Then run from the repository root:

```powershell
npm.cmd run test:db:mariadb -w @cp/api -- --suite phase3c
```

For a complete rerun, provision all ten distinct schemas and provide `MARIADB_TEST_SUITE_URLS` as a JSON object keyed by the launcher suite IDs, or use the existing manual-only workflow after owner approval. Preserve the old reported 8/98 result until real reruns are available; classify remaining business failures against approved owner requirements. Provider fixtures, durable operator follow-up and full P2 release acceptance remain incomplete.

## Historical financial regression coverage follow-up

At checkpoint `efe362368f6c64e5da27ccaf7e7d21af8361a25d`, the complete repository tree listed fifteen live MariaDB specs. The ten-suite historical launcher omitted `mariadb-phase4-live.spec.ts` (populated upgrade, invoice/device history and draft CAS) and `mariadb-branding-live.spec.ts` (retained issuer snapshots, visibility-only editing and cross-issuer assets). Both are now included as `phase4` and `branding`, using isolated `nusrv_legacy_phase4_test` and `nusrv_legacy_branding_test` schemas. The child process maps only the corresponding opt-in variable to its validated target and strips any inherited special DB target. The fixtures now reject nonempty schemas rather than erase tables during setup; branding connection cleanup also runs if Prisma disconnect rejects. Business assertions remain unchanged. The existing manual-only workflow matrix includes both suites. Full mode now requires twelve dedicated URLs instead of ten. Single-suite invocation and the focused P1/P2 database job are unchanged.

The fifteenth live spec, `mariadb-phase3-slice-g-live.spec.ts`, still exercises historical AI auto-routing assumptions. It is explicitly outside this twelve-suite mandatory launcher until its assertions are reconciled with OD-10 and its test-only isolation is verified; it is not a passed test and operational AI must remain disabled. This is an identified remaining coverage gap, not a release exemption.

Executed in the isolated local Node 22.16.0 environment: verified baseline planner/test blobs `f0c161db16a0093c771a601d7bb28e95853b9eb7` and `ce38b1b84b0fed1f29220a43911400966a417046`, then ran `node --test mariadb-integration-plan.test.mjs` on the revised files (5 passed, 0 failed/skipped; expected blobs `7bf795643889a33b2c9239a6d28e842ffcd238cc` and `acb983c92b940b6b5bf4b0dd4cc8fa409000c3cd`). These are launcher contracts, not Jest/MariaDB tests. The local environment has no MariaDB server or project dependencies and direct repository checkout fails DNS; the GitHub connection can read/write source but cannot dispatch a fresh workflow. No live test or deployment occurred. The previous 8/98 historical DB result remains open, and all twelve suites require real reruns on dedicated fresh schemas. Next: verify phase3c first, then full historical matrix and focused P1/P2; classify real failures. Separately reconcile Slice G test-only policy coverage and continue controlled provider verification and durable operator follow-up without activating mail observation.

## DSN ledger planning contract

Continued from `af15da542438e82b043aa495d88c9261011bdd97` without requiring MariaDB. The existing hard-failure planner now carries the exact corroborated folder, wire Message-ID, recipient and enhanced status, in addition to typed outbound subject, attempt, mailbox and provider source object. The new inert `dsn-follow-up-ledger-plan.ts` requires agreement with those fields and an independently verified current provider-account binding. It calculates a versioned observation key over mailbox, binding and stable provider-event identity, and independently recomputes the existing exact-attempt/recipient follow-up key. It refuses malformed identities, mismatched scope, altered proof, and conflicting reuse of an event identity (including a conflicting recipient). A first event plans one follow-up; subsequent distinct reports for that attempt plan evidence only, even after human resolution. An exact replay is a no-op; a missing referenced follow-up or an inconsistent stored task is review-only. There is no resend, delivery-state, or customer decision operation.

Executed `node --experimental-strip-types --test dsn-follow-up-ledger-plan.test.mjs` using Node 22.16.0: 7 passed, 0 failed/skipped. Exact new source/test Git blobs `c5a44b79ba79ff857ef64a55ed49a52365406014` / `124df158452f8acab0039c65aafd294ba3c0dc96` match the tested files. The existing Jest expectation was updated, not run. Manual-only source workflow now includes the dependency-free contract tests. This verifies the pure planner against synthetic corroborated input, not provider authentication, database uniqueness or concurrency, or the workspace typecheck.

Next: implement independently verifiable provider-account binding and stable event provenance; design append-only observation persistence and a unique follow-up row with atomic transaction/reload on races. Keep multi-recipient ambiguity in review rather than overriding evidence. A current ADMIN must conditionally resolve a task with an atomic audit event. This module stays unregistered until those gates pass; no changes to production, SMTP, INBOX handling, migration history, customer state or delivery status. Historical MariaDB regression remains pending separately.
