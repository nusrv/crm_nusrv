# FINAL ENGINEERING SPECIFICATION (DRAFT v1 — Claude-authored; **Codex review PENDING**, usage limit)
Governs: approved decisions in `OWNER_DECISIONS_APPROVED.md` > `CURRENT_IMPLEMENTATION_SCOPE.md` > this spec. Static analysis only; nothing implemented or executed. Items marked **[CLR-n]** wait for `OWNER_CLARIFICATIONS_REQUIRED.md`. Items marked **[ENG]** are engineering proposals, not owner policy.

## OD-1 Recipient from registered contacts
Send request carries `recipientContactId` (or `FALLBACK_PRIMARY`). Server loads that contact for the case's customer: active, valid email; reject anything else. Default preview order BILLING → PRIMARY → authoritative primary email; TECHNICAL/MANAGEMENT/OTHER only when the operator explicitly picks them. Worker re-validates before the first SMTP attempt (current code skips resolution for manual rows): if the contact became inactive/changed → cancel + audit (`recipient_no_longer_registered`). After the first attempt the address stays pinned (existing rule). Free-text recipient removed from DTO/UI. Customer contacts link shown when no valid contact.

## OD-2 Fresh authorization on sensitive actions
Guard `RequireFreshAuth` (new decorator) loads user (`active`), current roles and session state from DB per call; add `sid` to the access-token payload so a revoked session is detectable. Unchanged: 15-min cap, silent refresh, refresh re-reads roles, logout revocation, disabled users cannot refresh, 24h absolute cap. Not applied to ordinary reads.
**Proposed protected inventory [ENG, to be justified/verified with Codex]:** every non-GET route on controllers restricted to ADMIN or ACCOUNTANT, namely payments/receipts (record, receipt create, void/replace, payment correction), invoices (create, edit, mark ready, finalize/official record, reconcile, cancel, QR replace, submit-official), billing entities and branding assets, JoFotara connections, users/roles, mail settings (credentials), AI settings, currencies/rates, legacy import, technical connections; renewal cases (accept, do-not-renew, fulfil, legacy-proposal, link-invoice); customer-email sends (reminder, clarification, resend). Sensitive GETs: credential/secret-bearing settings and user lists only. Worker/internal jobs unaffected. Also confirm durable logout (write failures currently swallowed) as part of this slice.

## OD-3 Official invoice prerequisite
`markFulfilled` (one transaction): case status legal; proposal present; **exists** Invoice with `sourceRenewalCaseId = case.id`, official-recorded status, not cancelled, reconciliation complete **[CLR-4]**; payments never read. Subscription date commit CAS unchanged. Required: Create-Invoice-from-renewal writer (idempotent; sets sourceRenewalCaseId, uses the proposed period) and a manager audited "link existing invoice" action for subscription-created invoices. UI mirrors server eligibility, shows why disabled.

## OD-4 Payments, receipts, corrections
Payments: recordable against any non-cancelled CRM invoice (draft/ready/official) — currently only official+reconciled; total used for balance = official total when recorded else draft total, with a warning if the total later changes **[CLR-1]**; no CRM-invoice-free payments until owner decides. Receipts: created only for a payment whose invoice is official-recorded; visible number = invoice official number; internal receipt id distinct; multiple receipts per invoice allowed; receipt snapshot excludes stamp. Corrections: manager-only **[CLR-3]**, fresh-auth, mandatory reason; receipt "modify/delete" = append-only revision/void on the **receipt** (new `PaymentReceiptRevision`: prior snapshot, actor, time, reason; `voidedAt`) while the payment row stays untouched; payment correction as a separate audited reversing/adjusting entry only if owner confirms **[CLR-2]**. No hard deletes of financial rows. Fix payment replay so an identical retry does not bump invoice revision.

## OD-5 Reply review
Needs Clarification: operator prepares a clarification draft → reviews → human Send through the existing outbox (new `purpose=CLARIFICATION`). Case HUMAN_REVIEW → AWAITING_CUSTOMER only inside the same transaction that records send success **[CLR-6: "sent" = SMTP accepted]**; any failure/uncertain keeps HUMAN_REVIEW with visible failure. Keep in Review: marks message `reviewedAt/By` (shared), case stays/enters HUMAN_REVIEW (AWAITING_CUSTOMER→HUMAN_REVIEW is legal), audit event, no approval/closure. UI shows two independent indicators: message read vs case awaiting decision (derived: inbound reply on case with no decision recorded). Fix HUMAN_REVIEW self-transition handling (no illegal re-application).

## OD-6 Holds
`evaluateEligibility`: rows with `manualApprovedBy` do not defer for `customer_reminder_hold`. All other checks stay (customer/subscription active, case reminder-eligible, config, recipient validity OD-1). `customerReminderAutomationEnabled()` stays false; scheduled customer rows without manual approval still cancel. UI may display "hold active — your send overrides it".

## OD-7 Legacy proposals
Read-only inventory (query/report) of cases in ACCEPTED/INVOICE_DRAFT/COLLECTING with null `proposed*`. Manager-only endpoint `legacy-proposal` {periodStart, periodEnd, nextRenewalDate, reason}: validates coherence (end < next; next > due date), writes proposal + audit, never touches the subscription; OD-3 still gates fulfil.

## OD-8 QR images
PNG: signature, IHDR first, CRC of each chunk, IDAT present, IEND last, width/height/pixel caps. JPEG: SOI, marker walk, SOF dimensions/caps, SOS, EOI. WebP: RIFF size = byte length, first chunk VP8/VP8L/VP8X with parsed dimensions/caps. Byte cap aligned between DTO base64 limit and decoded cap. No QR decoding. Residual (documented in UI help): corrupt compressed pixel data in JPEG/WebP can pass; manager must compare with the externally issued invoice. Historical replacement: append-only `InvoiceQrCorrection` (original data/hash, replacement, reason, actor, time); original column untouched; print resolves the latest correction; manager-only, fresh-auth; invoice identity/values unchanged; read-only scan report of suspect rows first.

## OD-9 Session recovery
Next proxy cannot read the `/api/v1/auth` refresh cookie. Replace hard redirect with client `/session-restore?next=` that calls refresh once, then continues or goes to login. No long-lived access token. Logout/disabled/expired refresh → login.

## OD-10 AI deferred
Settings under Advanced/System labelled "Deferred — Currently Inactive"; provider-calling test/discovery buttons disabled while deferred; routing gated at scan and direct execution with audited disposition of historical pending/abandoned decisions; no live provider calls.

## OD-11 Templates
Renderer variants keyed by `BillingEntity.issuerType`: COMPANY (NUSRV reference authoritative; Future Foresight shares it pending confirmation) and INDIVIDUAL (**no approved reference exists → official Individual print blocked until supplied [CLR-7]**). Sales Tax No. = `issuerTaxNumberSnapshot`; remove extra issuer line; snapshots/isolation preserved.

## OD-12 Email status synchronization (mandatory)
1. Transport result: `send()` returns {accepted, rejected, response, envelope}; persist `smtpAcceptedAt` + sanitized response.
2. Append-only `EmailDeliveryEvent` (type, source, rawRef, observedAt) for SMTP_ACCEPTED, SENT_FOLDER_OBSERVED, DSN_FAILED/DELAYED/DELIVERED, BOUNCE_SUSPECTED, UNCERTAIN_FLAGGED, MANUAL_NOTE.
3. Sent reconciliation: `MailConfiguration.sentFolder` (SPECIAL-USE \Sent discovery), cursor with UIDVALIDITY, match by stable Message-ID; if the server does not file sent mail, status honestly stays "Accepted by SMTP". CRM does not IMAP-APPEND by default.
4. Inbound DSN detection (multipart/report, Mailer-Daemon/Postmaster, X-Failed-Recipients, Original-Message-ID/References) → events; bounces never create customer-reply/unread/awaiting-decision items (currently they would).
5. Status = pure function over evidence: Prepared, Queued, Sending, Accepted by SMTP, Confirmed in Sent (if observed), Delivery confirmed (only DSN success/other trustworthy evidence), Failed/Bounced, Uncertain. Never claim delivered/read without such evidence.
6. Uncertain handling **[CLR-5]**: crash after attempt mark, or timeout after DATA → UNCERTAIN, automatic retry stops (current code retries non-terminal failures); reconcile via Sent/DSN window; unresolved → action queue; manager may resend as a new explicit human send with evidence note; no auto resend.
7. Periodic sync worker + on-demand refresh; idempotent; duplicate-send guard via stable Message-ID + status checks.

## Cross-cutting
Migrations (single additive chain, P0-a): all unmigrated schema from the signed plan + `nextAttemptAt`, outbox `purpose`/SMTP result columns, `email_delivery_events`, `sentFolder`, receipt revision/void, `invoice_qr_corrections`. Tests per `ACCEPTANCE_CRITERIA.md`. No dependency changes assumed (pngjs exists; JPEG/WebP parsers hand-written; DSN parsing via existing mailparser if present — to verify).
