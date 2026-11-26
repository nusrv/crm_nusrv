# NUSRV CRM — remaining implementation roadmap

Owner-approved R1–R6 correction sequence. The authoritative business rules remain in CURRENT_IMPLEMENTATION_SCOPE.md and the approved owner requirements. Do not infer completion from a commit or a successful compile.

## R1–R5 source delivery

Baseline deployed revision: 2f542829882a62926c8a342e92cba19e412c78f4.

- R1/R2 (4abbe4e): visible per-case manual reminder, registered contact preview, explicit send, verified SMTP acceptance summary, shared unread/review, exact selected reply review, clarification, proposed period and audited historical recovery.
- R3 (6a1dc3d): invoice payment and receipt panel, partial/multiple payments, correction/void/history, QR history, explicit officialization and deferred real JoFotara submission.
- R4/R5 (7eac84e): remove operational AI controls; advanced identifiers, settings and readable states; direct links from customers and communications; shared read state; outbound evidence and warned explicit resend controls.
- Follow-up in this revision: unambiguous inbound replies open human review; stale manual reminders are guarded at eligibility and durable attempt boundary; targeted review/ingest tests; explicit refresh.

## R5.1 — source closure before Plesk

The owner requires completing all available programming work before any Plesk build/deployment. This is not a new product scope. Source corrections since 5cea3fb:
- 9b02e4d: manual Waiting for Customer endpoint now rejects bypass; selected-reply acceptance/rejection and shared read marking are atomic; renewal revision CAS and explicit ADMIN route metadata.
- ddf4553: per-message bounded, exact mailbox Sent-header observations and stored failure follow-ups; no recipient delivery inference.
- 2793902: revision-bound draft/review submission, stale resend rejection, new inbound-reply revision fence, limited reply read projection, strict verified-official print eligibility and regression coverage.
- 5ee549d: manual (not automatic milestone) history, truthful uncertain label and bounded batched reminder counts, verified official-invoice eligibility in renewal UI, ADMIN operational affordances and page filter reset.
- Current follow-up: SMTP mock vs real acceptance regression cases, stale worker revision, explicit ADMIN communications routes, exact SMTP corroboration of historical DSN follow-up display.

## Remaining external programming dependencies and verification

- **OD-12 real provider evidence adapter:** source contract, binding, storage and bounded UI projection exist, but the production mail provider and its authenticated report/tracking capability were not specified or approved. SMTP acceptance and a Sent copy are not recipient delivery. Raw DSNs remain review-only; do not invent or enable a provider adapter, infer delivery, or accept arbitrary MIME as authenticated proof. Obtain provider identity and supported documented evidence API/permission model, then implement the provider-specific adapter and tests.
- **OD-11 individual template:** approved separate personal invoice visual reference is missing. Company issuer template remains in place. Individual officialization remains blocked pending approved template; do not silently reuse the company layout as the individual official template.
- **Historical association:** remains separately approved work; not an authorized implementation item.
- Full TypeScript/lint/Jest/build and runtime acceptance have not been executed for this revision. New tests are source changes, not recorded passes. No new dependency or migration is introduced by R5.1. No main merge, database write, mail send, workflow dispatch or Plesk action performed. Do not enter R6 while known in-scope source gaps remain, including the external programming dependencies unless the owner explicitly defers them.

## R6 — Plesk acceptance

Use the existing branch, manual Git deployment, and systemd services. Keep mail workers paused and experimental P2 features disabled until controlled tests pass. Confirm the actual systemd environment, not a second unused dotenv file. Run root package typecheck, lint and build; use isolated fixtures for targeted Jest and broader integration checks. Do not run destructive database fixtures against CRM production data. After successful checks, restart the existing services and check readiness.

Operational acceptance (ADMIN, controlled test customer and mailbox only):
1. Renewals: Prepare Reminder, registered recipient only, edit/close without send, explicit send, truthful acceptance count/date, Hold manual override, no automatic reminder.
2. Reply: correct thread/case, unread shared across users, explicit review choices, Keep in Review preserves state and marks exact reply read. Clarification does not become waiting until the actual SMTP acceptance. Confirm no AI.
3. Accepted renewal: proposed period displayed; repair historical dates with reason; formal invoice manually officialized with valid QR; fulfillment independent of payment. Draft invoice cannot create receipt.
4. Payment: partial, full, correction and void audit; balance and receipt number match; print excludes operational panels. Validate customer/company invoice layouts. No live JoFotara call.
5. Modal close/save behavior, ADMIN permissions, navigation, session restoration and fresh permission checks.
6. Evidence: acceptance is not delivery; uncertain message requires explicit warned resend; ambiguous/forged reports cannot affect decisions. Validate controlled IMAP, Sent and provider evidence separately before enabling each feature.

The owner accepts operational completion only after these checks. A GitHub update alone is not a production release.
