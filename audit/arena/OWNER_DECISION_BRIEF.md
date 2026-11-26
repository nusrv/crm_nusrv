# OWNER DECISION BRIEF — NUSRV CRM (OD-1 … OD-12)

**Status of this document:** a decision aid only. Every "Recommended default" is a **recommendation by Claude, NOT an approved requirement**. No business policy has been decided. The application and the existing audit conclusions were not changed.
**Sources:** `FINAL_MASTER_PLAN.md` §J, `UNRESOLVED_DISAGREEMENTS.md`, `FINAL_VERDICT.md`, `rounds/ROUND_02–04_CODEX_RESPONSE.md` (Codex's exact OD wording is in Round 2 D4, amended in Rounds 3–4), and `docs/CURRENT_IMPLEMENTATION_SCOPE.md` (the frozen scope; its §29 says an explicit new owner instruction outranks it). Facts about the code are from static reading only; nothing was run.
**Count check:** exactly twelve decisions exist in the final documents (OD-1…OD-12). None were added or dropped. OD-10, OD-11, OD-12 were added by Codex in Round 2 ("preserve open decisions already in the matrix").

## 0. At a glance

| OD | Question (short) | Blocks P0? | Blocks | Safe interim while undecided |
|---|---|---|---|---|
| 1 | May staff email a reminder to an address other than the resolved contact? | No | P1-ops Send screen (recipient field) | Show the resolved recipient read-only; no free-text override |
| 2 | How fast must a revoked/disabled user lose access, and for which actions? | No | Nothing in P0; optional P1 hardening | Keep 15-min access tokens + refresh checks |
| 3 | Must an invoice exist before a renewal can be marked fulfilled? | No | Final Fulfil rule in P1-ops/UI | Keep current server rule (ACCEPTED can be fulfilled) |
| 4 | When can payments/receipts be recorded (draft vs official invoice)? Receipt numbering/void? | No | P1-finance payments & receipts | Keep current rule (official, reconciled invoices only) |
| 5 | What do "Needs Clarification" and "Keep in Review" mean, and who sees "unread"? | No | P1-ops reply-review UI | Build Keep in Review as an audited no-state-change mark |
| 6 | Do automation holds block a human-sent reminder? | No | P1-ops Send behaviour | Show hold warning; do not silently queue |
| 7 | How to rebuild a missing renewal proposal for old accepted cases? | No | Legacy recovery action only | Leave such cases blocked; count them first |
| 8 | Which QR image formats, QR scanning, and historical-record correction? | **Partly** (JPEG/WebP only) | A-02 final shape | Harden PNG now; hold JPEG/WebP decision |
| 9 | Should closing the browser end the session? | No | Nothing | Default: recover while refresh session valid |
| 10 | Show/hide/inert/authorize deferred AI diagnostics? | No | Nothing | Keep AI off; leave admin test routes as is |
| 11 | Confirm missing tax inputs and print variants per issuer type | No (A-05 fix is explicit in §17) | P1/P2 print verification | Fix the field binding now; verify prints after |
| 12 | Who may resend after an uncertain SMTP outcome? | No | P2 delivery-state work | Do not auto-resend; show "uncertain" |

**Bottom line:** none of the twelve blocks the independent P0-a/P0-b technical fixes except the narrow JPEG/WebP part of OD-8. Decisions 1, 3, 4, 5, 6, 7 should be answered before P1; 2, 9, 10, 11, 12 can be answered later.

---

## OD-1 — Recipient override on a human-sent reminder
1. **Question:** When staff prepare a renewal reminder, the system proposes the right contact (Billing → Primary → customer's primary email). May staff type a *different* email address before sending? If yes, who approves it and what if the contact changes before the email actually leaves?
2. **Why needed:** The code currently accepts any valid-looking email on send as long as a default contact exists, and sends to that stored address. §7 defines the *selection* order and forbids silently choosing Technical/Management contacts, but does not say whether a manual edit is allowed.
3. **Options:** (A) No override — send only to the resolved contact. (B) Override allowed to any address, with mandatory reason + audit. (C) Override only to another contact already stored on that customer (any role), audited. (D) Override to any address but needs a second approver (e.g. ADMIN).
4. **Consequences:** A: safest, but staff cannot reach a customer's new/temporary mailbox without first editing contacts (extra step, still audited). B: fastest, but a typo or wrong-customer address leaks service/pricing details. C: keeps data inside the customer record, small extra friction. D: strongest control, slowest.
5. **Security/ops/finance:** Disclosure of renewal prices/domains to a third party is the main risk. Replies from an unlisted address may fail correlation (§8 relies on headers/thread, subject token as fallback). If the stored contact changes after queuing, the worker already pins the address after the first SMTP attempt.
6. **Recommended default (not approved):** **C**, with the typed-in address path available only by first adding it as a customer contact; every send audited with who/what/why.
7. **Codex:** Rated as A-06 (policy decision open, not a defect). Asked the owner to define the override boundary and who approves; supports keeping explicit confirmation + audit if exceptions remain. No single option recommended.
8. **Scope conflict:** None explicit. §7 only governs selection; §6 requires the operator to review the recipient. Option A/C are closest to §7's spirit.
9. **Depends on:** Prepare Reminder/Send UI (P1-ops), A-06 hardening, reply-correlation tests.
10. **Blocks:** Not P0. Blocks only the recipient field of the P1 Send screen. Interim: read-only recipient.

## OD-2 — Immediate access-token revocation window and privileged actions
1. **Question:** When an admin disables a user or removes a role, how many minutes may that person's already-issued access token keep working, and are some actions (money, user admin) required to be checked against the database every time?
2. **Why:** The system uses short access tokens (capped at 15 minutes in the working tree) plus a refresh session. Disabled users cannot refresh, roles are re-read on refresh, but an issued token is trusted until it expires. §4 requires those refresh behaviours and does **not** require instant revocation.
3. **Options:** (A) Accept ≤15 min (current). (B) Shorten access TTL (e.g. 5 min), more refresh traffic. (C) Per-request database/session check for sensitive endpoints only (payments, receipts, user/role admin, official recording). (D) Per-request check on every endpoint.
4. **Consequences:** A: zero change, residual window. B: smaller window, more refresh calls, no architecture change. C: near-immediate revocation where it matters; small DB cost and new code in guards. D: strongest but changes the guard architecture and adds load on every call.
5. **Implications:** Security: a terminated accountant could record payments for up to ~15 min under A. Financial: payments/official records are append-only and audited, which limits but does not prevent damage. Ops: C/D need regression tests across RBAC.
6. **Recommended default (not approved):** **A for now**, with **C** as the first upgrade if the owner wants tighter control. (Claude argued this is Medium, not High.)
7. **Codex:** Conceded to Medium; "owner decision about revocation window and which privileged actions require a fresh check." Also noted durable **logout** revocation is unproven because the service swallows write failures — a technical item, not part of this decision.
8. **Scope conflict:** None. §4 lists silent refresh, logout revocation, disabled-user refusal, expiry, and roles on refresh only.
9. **Depends on:** P0-b session verification (proceeds regardless); any guard changes in P1.
10. **Blocks:** Nothing in P0. Safe to defer.

## OD-3 — Does fulfilment require an invoice?
1. **Question:** Can staff click "Mark Renewal Fulfilled" on an accepted renewal before any invoice exists, or must an invoice exist (draft) or be officially recorded first?
2. **Why:** §10 says payment must not block fulfilment, but is silent on invoices. Current server policy permits ACCEPTED → FULFILLED directly (and from INVOICE_DRAFT/COLLECTING). The UI is still wired to the old payment-confirmed rule (SC-02).
3. **Options:** (A) No invoice needed. (B) A draft invoice must exist. (C) An officially recorded invoice must exist.
4. **Consequences:** A: matches "service may renew externally regardless"; risk of tracking-date updated with nothing billed (forgotten invoices). B: ensures billing started, but a draft can be abandoned. C: strongest billing discipline, but delays the tracking update when the official invoice is issued late outside the CRM.
5. **Implications:** Financial: A can hide unbilled renewals unless a "fulfilled without invoice" report/flag is added. Operational: B/C add a step in a flow that §2 wants human-driven and independent of payment.
6. **Recommended default (not approved):** **A**, plus a visible "no invoice yet" warning on the case and an audit note when fulfilling without one.
7. **Codex:** "Does fulfilment require an invoice to exist or to be officially recorded? **Payment status cannot gate fulfilment.**" Acceptance tests say the UI follows server eligibility and "the approved OD-3 invoice prerequisite, if any." No option recommended.
8. **Scope conflict:** A/B/C all compatible with §10; only payment gating is forbidden.
9. **Depends on:** SC-02 UI gate alignment, fulfil acceptance tests, optional dashboard flag.
10. **Blocks:** Not P0 (the SC-02 UI gate can be fixed to match current server rules now). Needed before P1 acceptance.

## OD-4 — Payment/receipt stages, receipt numbering, corrections/voids
1. **Question:** At which invoice stages may a payment be recorded (draft, ready, official, unreconciled)? Do receipts need their own number series? How are wrong payments/receipts corrected or voided in this release?
2. **Why:** Code only allows payments on official (`FAWTARA_ACCEPTED`), reconciled, unlocked invoices. §19 says the receipt button becomes available "after an invoice exists" and a finalized receipt needs a real payment; §18 calls payments independent records. Real life: customers often pay before the official invoice is issued manually.
3. **Options (stage):** (A) Official only (current). (B) Any non-cancelled invoice incl. draft/ready. (C) Official or ready, never draft. **Numbering/void:** (i) none this release, receipts identified by internal id; (ii) a sequential receipt number per issuer; (iii) void/correction as a new reversing record.
4. **Consequences:** A: clean accounting but cannot record early payments; receipt button disabled until official issue (stricter than a literal reading of §19). B: records reality, but money linked to a draft whose amounts may still change. Numbering (ii) adds a sequence, migration and legal formatting questions; void (iii) is append-only-friendly but needs UI and audit.
5. **Implications:** Financial/legal: receipts are customer-facing financial documents; a changing draft total makes balance/overpayment logic unstable; receipts without numbers may not satisfy your accountants. Payments are append-only today, so there is **no way to correct a mistaken payment** without a new design.
6. **Recommended default (not approved):** **A** for stage (matches current code and keeps totals stable), numbering **(i)** now, and an owner/ACCOUNTANT answer on voids before payments go live — if mistakes must be fixable, **(iii)**.
7. **Codex:** "At which invoice stages may payments be recorded, and which receipt numbering, correction, or void rules apply if needed in this release?" The matrix cell flagged unresolved prerequisites; no recommendation recorded. Also flagged: replay currently bumps invoice revision (technical fix, not this decision).
8. **Scope conflict:** Possible tension: §19 "after an invoice exists" can be read as including drafts, while code requires official. **Owner clarification needed.**
9. **Depends on:** Payment recording service gate, receipts UI and renderer, migration for any numbering/void fields.
10. **Blocks:** Not P0. Must be answered before P1-finance work on payments/receipts starts.

## OD-5 — "Needs Clarification" lifecycle, shared vs per-operator "unread", effect of "Keep in Review"
1. **Question:** After reading a customer reply, what exactly happens for (a) Needs Clarification and (b) Keep in Review? Is the "unread" flag one flag for everyone or per operator, and does Keep in Review clear it?
2. **Why:** §9 requires all four actions but defines none. Today Keep in Review does not exist, and Needs Clarification moves the case to HUMAN_REVIEW (which fails if already there). §23 labels HUMAN_REVIEW "Needs review".
3. **Options (Needs Clarification):** (A) Case stays "Needs review" with a distinguishing reason. (B) Case returns to "Waiting for customer" after staff send a clarification email. (C) New distinct state. **(Keep in Review):** (i) audited note, no state change, unread stays; (ii) audited, clears unread; (iii) explicit "snooze" with a date. **(Unread):** shared or per operator.
4. **Consequences:** A is simplest but cannot separate "we are thinking" from "we asked the customer". B models reality but ties to a send action. C adds a state-machine/migration change. Keep-in-Review (i) never loses sight of the reply; (ii) can hide an unanswered reply; (iii) is more UI. Per-operator unread needs a new table; shared is a single field (`reviewedAt/By` already exists).
5. **Implications:** Operational: a reply cleared by one person disappears for everyone under "shared" (risk if they only glanced). Audit requirements apply either way (§25).
6. **Recommended default (not approved):** Keep in Review = **(i)** audited, no state change, unread **remains until an Accept/Do-Not-Renew/Needs-Clarification decision**; Needs Clarification = **(A)** with a reason, upgrading to (B) when a clarification email is human-sent; **shared** unread.
7. **Codex:** Conceded the state-machine problem; "OWNER APPROVAL REQUIRED for the clarification lifecycle and whether Keep in Review clears unread"; Round 4 added the shared-vs-per-operator question. No option recommended.
8. **Scope conflict:** None; §9 lists the four actions and forbids automatic decisions.
9. **Depends on:** Reply-review UI, transition policy fix, markRead semantics, acceptance tests for four decisions.
10. **Blocks:** Not P0. Must be answered before P1-ops reply review.

## OD-6 — Do automation holds block a human-sent reminder?
1. **Question:** If a renewal case has an active "stop customer reminders" hold, should a person's explicit Send still go out, be blocked with a clear message, or need an authorized override?
2. **Why:** Today the worker defers any customer message under such a hold — including a human-approved one — silently. The operator sees "queued" and nothing sends; the row also feeds the queue-starvation problem (A-03). §6 says sending is explicit and human, but §2 doesn't mention holds.
3. **Options:** (A) Hold blocks the send at click time with a visible message (nothing queued). (B) Human send overrides the hold (holds only stop automation). (C) Hold blocks unless an authorized role (e.g. ADMIN) overrides with a reason, audited. (D) Queue it and show "held" status (current behaviour but visible).
4. **Consequences:** A: clear, but may stop a legitimate urgent human email. B: human always in control; may defeat the purpose of a hold (e.g. legal/dispute holds). C: balanced, extra step. D: delayed sends surprise the customer when the hold lifts.
5. **Implications:** Operational/legal: holds may exist for disputes or customer requests; sending through one could breach that intent.
6. **Recommended default (not approved):** **C** (block with message; ADMIN-override with reason, audited). At minimum **A** until decided.
7. **Codex:** Conceded (CLAUDE-007): "OWNER APPROVAL REQUIRED for whether a hold blocks manual sends or permits an authorized override. In either case, show the operator the effective hold and delivery state."
8. **Scope conflict:** None explicit.
9. **Depends on:** Send endpoint/UI, hold feedback, mail worker eligibility, A-03 test fixture (the fixture uses held human sends).
10. **Blocks:** Not P0 (A-03 fix is independent). Needed before P1-ops Send.

## OD-7 — Reconstructing a proposal for legacy accepted cases
1. **Question:** Renewal cases accepted *before* the new "proposed period" fields existed have no proposal, so "Mark Renewal Fulfilled" fails with a conflict. What evidence may staff use to recalculate it, and who may do so?
2. **Why:** The fulfil action refuses to run without a proposed period, and there is no recovery action. We do not know how many such cases exist.
3. **Options:** (A) Recalculate from the case due date + the subscription's current interval via an audited human action. (B) Staff enter start/end/next date manually with a reason. (C) Do not support; close old cases another way. (D) Bulk backfill (script) — highest risk.
4. **Consequences:** A is fast but wrong if the interval/date changed since acceptance (the confirmed risk). B is flexible and human-checked, but error-prone. C may strand genuine renewals. D can silently set wrong dates.
5. **Implications:** Financial/operational: the tracking renewal date drives future reminders; a wrong date misfires the whole cycle. §10 says the date is committed only by a human fulfil.
6. **Recommended default (not approved):** First **count** affected cases (read-only query, no change). If few, **B** (manual entry with reason, preview, audit); never D.
7. **Codex:** Readiness question 7 and plan P1.2 call for an "audited legacy proposal action"; OD-7 asks "what evidence may an operator use… when the term or original tracking date is missing or has changed." No option recommended.
8. **Scope conflict:** None; any option must keep "no immediate overwrite; human commit only".
9. **Depends on:** Legacy-proposal action, fulfil acceptance tests, data inventory.
10. **Blocks:** Not P0; can be deferred if the count is zero.

## OD-8 — QR image formats, machine verification, historical correction
1. **Question:** Which image formats must the manual "official QR" upload accept? Must the system verify that the image actually contains a readable QR? How may already-stored suspect QR images be corrected?
2. **Why:** The current check accepts a fake 24-byte PNG header. §14/§15 require a "real official graphical QR" but don't name formats or verification depth. §26 forbids unrelated dependency changes; QR scanning needs a new library.
3. **Options (formats):** (A) PNG only. (B) PNG + JPEG + WebP with structural checks. (C) PNG/JPEG/WebP with proper decoders (new dependency). **(Scanning):** none / decode the QR symbol (new dependency, owner approval). **(Historical):** report only / flag & block final print / allow audited replacement keeping the original evidence.
4. **Consequences:** A: simplest and safe using the existing `pngjs`; operators must export/screenshot as PNG. B: still admits corrupt JPEG/WebP data (Codex showed structure checks are insufficient). C: most flexible, new dependency/maintenance. Scanning proves it is a QR but **cannot prove authenticity** (Codex's own caveat). Historical block could stop printing of invoices already issued.
5. **Implications:** Legal/financial: a broken QR on an official document is a customer-visible defect. Security: bounds on decoded pixels/memory are needed in any option (decompression bombs).
6. **Recommended default (not approved):** **A (PNG only)**, operator must confirm the image matches the externally issued document, no scanning for now, **read-only report** of suspect historical records with an audited correction path decided later.
7. **Codex:** Recommends PNG-only for new uploads "subject to OD-8 and representative official exports"; structural-only JPEG/WebP checks insufficient; owner decides formats, scanning, and historical correction.
8. **Scope conflict:** None. Scanning or a new decoder touches the §26 dependency boundary (hence owner approval).
9. **Depends on:** A-02 fix, DTO limits, official-recording form, historical inventory.
10. **Blocks:** **Partly P0-b**: PNG hardening can proceed now under any answer; only JPEG/WebP handling, scanning and historical policy wait.

## OD-9 — Session after the browser is closed
1. **Question:** If staff close the browser and reopen it within 24 hours, should they be signed in silently (refresh session still valid) or sign in again?
2. **Why:** The access cookie is a session cookie (disappears on browser close) while the refresh cookie persists; the dashboard then redirects to login even though a valid refresh session exists (S-1). §4 says the session "should remain usable for up to 24 hours" with silent refresh.
3. **Options:** (A) Recover silently while the refresh session is valid (matches §4). (B) End on browser close (re-login each time). (C) Make the access cookie persistent but short-lived.
4. **Consequences:** A: convenient, the 24h cap still applies; a shared PC stays signed in until 24h/logout. B: stricter, contradicts the §4 UX. C: engineering variant of A.
5. **Implications:** Security trade-off on shared computers; mitigated by explicit logout and the absolute 24h cap.
6. **Recommended default (not approved):** **A**. Cookie persistence mechanism is an engineering choice (Codex agrees).
7. **Codex:** "Default to §4 recovery while refresh remains valid. Keep access-cookie persistence a technical choice." Said OD-9 should not hold up the fix.
8. **Scope conflict:** Option B conflicts with §4's 24-hour usability statement; A fits.
9. **Depends on:** S-1 dashboard recovery fix, session tests.
10. **Blocks:** Nothing; the fix proceeds with the §4 default.

## OD-10 — Deferred AI diagnostics: hidden, inert, or separately authorized?
1. **Question:** The AI feature is off. Should AI settings/test/model-discovery stay visible to admins (inert), be hidden entirely, or be available only with separate authorization?
2. **Why:** §3 keeps the AI code but forbids operational use; §21–22 put AI settings under Advanced/System ("deferred"). Admin test/discovery routes still exist; the resolver forces AI off regardless of stored settings (Codex A-13: stored vs effective drift).
3. **Options:** (A) Visible in Advanced, clearly labelled "Deferred – inactive", test routes remain. (B) Hidden from UI, routes disabled. (C) Visible only to ADMIN with explicit "diagnostic test" authorization; no live calls by default.
4. **Consequences:** A: transparent, small risk of confusion/accidental provider test. B: cleanest, harder to re-enable later. C: balanced.
5. **Implications:** Security/cost: a test call sends data to an external provider and costs money; secrets handling stays unchanged.
6. **Recommended default (not approved):** **A** with the state shown as deferred and provider test calls requiring ADMIN, no live calls in this plan.
7. **Codex:** "Should deferred AI diagnostics be hidden, inert, or separately authorized? This plan uses no live provider calls."
8. **Scope conflict:** None; §22 expressly allows "AI Settings — deferred" in Advanced.
9. **Depends on:** Settings UI labelling (P2), A-13 flag-drift tests.
10. **Blocks:** Nothing; safe to defer. (Separate from SC-01, the AI routing gate, which proceeds in P0-c.)

## OD-11 — Missing tax inputs and print variants for Company and Personal issuers
1. **Question:** Which tax/identity fields must exist on an issuer for an official print, and which approved print variants (NUSRV, Future Foresight, Individual/Personal) must match the reference design?
2. **Why:** §17 fixes the Sales Tax No. rule for the approved design; §13 adds Company and Individual/Personal issuers. For an individual issuer the tax number may be national/personal, and the supplied reference covers NUSRV only.
3. **Options:** (A) NUSRV layout for all issuers; missing tax number blocks official print. (B) NUSRV layout; missing tax number prints blank/placeholder with a warning. (C) Separate approved templates per issuer type (needs reference PDFs).
4. **Consequences:** A: strict, prevents invalid official documents, may block personal issuers. B: risks an official-looking document with an empty tax field. C: highest fidelity, needs owner-supplied references and extra work.
5. **Implications:** Legal/financial: tax-number placement on a tax document; billing-entity isolation (§25) must stay intact.
6. **Recommended default (not approved):** **A**, and confirm with your accountant whether personal issuers print a national number in the same slot; supply a reference for Future/Personal if different.
7. **Codex:** "Confirm missing tax inputs and the approved print variants for company and personal issuers. Preserve current billing-entity isolation unless the owner explicitly changes it."
8. **Scope conflict:** None for the field binding (§17 is explicit); the variants question is outside §17's NUSRV reference.
9. **Depends on:** A4 print comparison tests, preflight rules, renderer variants.
10. **Blocks:** Not P0 — the A-05 field fix is mandated by §17 and proceeds. Needed before P2 print verification.

## OD-12 — Who may resend after an uncertain SMTP outcome, and on what evidence?
1. **Question:** If the mail server may have accepted a message but the system crashed before recording it, who is allowed to resend, and what proof is required to avoid duplicates?
2. **Why:** Delivery has a stable Message-ID and leases, but "SMTP accepted → database commit" cannot be one transaction. A crash leaves an unknown state (Codex A-11). A customer could get the same reminder twice, or none.
3. **Options:** (A) Never auto-resend; show "uncertain"; any Sender-role user may resend after checking the Sent folder. (B) Only ADMIN may resend, with a note of what was checked. (C) Auto-resend after N hours (rejected by §6/§2 spirit: no automatic customer sends).
4. **Consequences:** A: fast, relies on staff diligence. B: stronger control, bottleneck. C: risks duplicates and conflicts with human-control rules.
5. **Implications:** Customer experience (duplicate reminders) vs risk of missed reminders; audit entry on each resend.
6. **Recommended default (not approved):** **A** with a required audit note ("checked Sent folder / Message-ID"); no automatic resend.
7. **Codex:** "Who can authorize resend after an uncertain SMTP outcome, and what evidence is required?" No option recommended.
8. **Scope conflict:** Option C would conflict with §6 ("sending must never happen automatically").
9. **Depends on:** Delivery-state UI (queued / SMTP-accepted / failed / uncertain), A-11 work.
10. **Blocks:** Nothing in P0/P1; safe to defer to P2.

---

## Suggested order for the owner/ChatGPT review
1. **Before P1 starts (policy-critical):** OD-1, OD-3, OD-4, OD-5, OD-6.
2. **Before the related slice:** OD-7 (after a count), OD-8 (JPEG/WebP and historical part only).
3. **Safe to defer:** OD-2, OD-9, OD-10, OD-11, OD-12.

## Quick recommendation sheet (NOT approved — for discussion)
OD-1 C · OD-2 A (C if tightened) · OD-3 A + warning · OD-4 A / no numbering / decide void · OD-5 Keep-in-Review audited no-state-change, clarification with reason, shared unread · OD-6 C (A as minimum) · OD-7 count first, then B · OD-8 PNG-only, no scanning, report-only history · OD-9 A · OD-10 A · OD-11 A + supply references · OD-12 A with audit note.

## Open facts that could change answers
Number of legacy ACCEPTED cases without proposals; number of historical official invoices with suspect QR images; whether any existing holds are in use; whether accountants require numbered or voidable receipts; deployed topology. None were verified here.
