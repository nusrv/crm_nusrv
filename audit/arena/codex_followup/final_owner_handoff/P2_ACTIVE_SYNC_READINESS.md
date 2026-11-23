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

**Status: P2.B schema/helper/tests committed on the temporary branch, integration validation pending; no P2.C activation.**
