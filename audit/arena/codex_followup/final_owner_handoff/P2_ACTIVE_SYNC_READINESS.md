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