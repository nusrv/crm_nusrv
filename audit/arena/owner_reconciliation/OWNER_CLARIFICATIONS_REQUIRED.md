# OWNER CLARIFICATIONS REQUIRED (genuine business-policy gaps only)
Status: Claude's analysis only. **Codex position: not obtained** (usage limit, see log). Approved decisions are not reopened.

## Q1 — OD-4: May a payment exist before ANY CRM invoice record exists?
- Approved: payment recording must not depend on official issuance inside the CRM; receipts only after an official invoice exists/is recorded.
- Ambiguous: "before any CRM invoice record exists". Today `Payment.invoiceId` is mandatory.
- Why assuming is unsafe: either answer changes the ledger model (nullable FK / unapplied-payment record / later matching) and financial reporting.
- Options: (a) payments require a CRM invoice of any non-cancelled status incl. DRAFT/READY (smallest change); (b) allow an "unapplied payment" (customer, amount, date…) later linked to an invoice; (c) as (a) but create a draft invoice first.
- Claude recommends: (a). Codex: not obtained.
- Impact: (a) simple, balance uses official totals once recorded; (b) new table + matching UI + reconciliation reports.
- Blocks: P1-finance payment slice only. Safe independently: P0, migrations for other models, receipt rendering, payment arithmetic/replay fix.

## Q2 — OD-4: What does "modify or delete a payment receipt" do to the underlying payment?
- Approved: manager can modify/delete an incorrect receipt; integrity/traceability/audit preserved.
- Ambiguous: receipt document only, or also the payment? hard delete vs void/replace? may the manager also correct a wrong payment amount?
- Unsafe to assume: silently deleting a payment destroys the ledger; silently keeping it may not satisfy the owner's intent.
- Options: (a) receipt-only void/replace with preserved prior versions; payment untouched; (b) (a) plus manager "payment correction" as an audited reversing/adjusting entry; (c) hard delete of receipt row with audit copy (not recommended).
- Claude recommends: (a)+(b), where the receipt "delete" is a soft delete visible only in history. Codex: not obtained.
- Blocks: receipt edit/delete slice. Independent: receipt create/print.

## Q3 — Who is the "manager"?
- Approved: OD-4, OD-7, OD-8-H3 give powers to "the manager"; the application has roles ADMIN, ACCOUNTANT, IT, SALES_DEVELOPMENT and no MANAGER.
- Options: (a) manager = ADMIN; (b) add a MANAGER role; (c) ADMIN + ACCOUNTANT for finance corrections only.
- Claude recommends (a) for now. Impact: RBAC tests, user administration. Blocks: the three manager-only actions' authorization wiring; everything else proceeds.

## Q4 — OD-3: what exactly is "officially recorded"?
- Approved: official recorded invoice required, draft insufficient, backend-enforced.
- Ambiguous: must reconciliation be complete? Is a cancelled/replaced official invoice excluded? How do pre-existing invoices (created from a subscription, no renewal link) get associated with a renewal case?
- Claude recommends: status official-accepted AND no reconciliation pending, not cancelled; an audited manager "link invoice to renewal" action. Codex: not obtained.
- Blocks: fulfil backend rule + legacy linking. Independent: Create-Invoice-from-renewal writer, UI gate removal of payment prerequisite.

## Q5 — OD-12: handling of uncertain email outcomes and the existing auto-retry
- Approved: mandatory active status sync; no automatic resend of uncertain customer reminders without owner approval.
- Ambiguous: the current worker automatically retries non-terminal SMTP failures (including ambiguous ones such as timeouts). Which failures count as "uncertain" (must stop) vs definite not-sent (may retry)? Is a manager-initiated "Resend" after evidence review acceptable?
- Claude recommends: stop auto-retry for any outcome after the DATA phase or after a crash; retry only definite pre-acceptance failures (connection refused, 4xx at RCPT/auth), and allow manager manual resend with evidence note. Codex: not obtained.
- Blocks: mail-delivery slice. Independent: capture SMTP result, Sent-folder sync, DSN ingestion, display of statuses.

## Q6 — OD-5: what counts as "actually sent" for Needs Clarification?
- Approved: Waiting for Customer only after the email was actually sent.
- Ambiguous: SMTP accepted, or Sent-folder/other confirmation?
- Claude recommends: SMTP accepted by the server (strongest always-available evidence); show later evidence separately. Blocks: clarification transition trigger only.

## Q7 — OD-11: missing references and issuer-type compliance
- Approved: separate approved templates per legal issuer type.
- Missing: an approved Individual/Personal invoice reference; confirmation whether Future Foresight (Company) uses the Company template; whether Individual issuers print a national number in the tax slot (compliance).
- Unsafe to assume: layout/legal fields would be invented. Blocks: Individual official print only. Independent: Company template, issuer-tax-number binding fix (§17).
