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
