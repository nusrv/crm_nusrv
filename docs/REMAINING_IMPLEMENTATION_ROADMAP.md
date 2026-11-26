# NUSRV CRM — remaining implementation roadmap

Owner-approved R1–R6 correction sequence. The authoritative business rules remain in CURRENT_IMPLEMENTATION_SCOPE.md and the approved owner requirements. Do not infer completion from a commit or a successful compile.

## R1–R5 source delivery

Baseline deployed revision: 2f542829882a62926c8a342e92cba19e412c78f4.

- R1/R2 (4abbe4e): visible per-case manual reminder, registered contact preview, explicit send, verified SMTP acceptance summary, shared unread/review, exact selected reply review, clarification, proposed period and audited historical recovery.
- R3 (6a1dc3d): invoice payment and receipt panel, partial/multiple payments, correction/void/history, QR history, explicit officialization and deferred real JoFotara submission.
- R4/R5 (7eac84e): remove operational AI controls; advanced identifiers, settings and readable states; direct links from customers and communications; shared read state; outbound evidence and warned explicit resend controls.
- Follow-up in this revision: unambiguous inbound replies open human review; stale manual reminders are guarded at eligibility and durable attempt boundary; targeted review/ingest tests; explicit refresh.

## Remaining verification and limitations

These source changes are not deployed or runtime-validated. No new dependency or migration is introduced. Existing schema must already be migrated. Provider-independent authenticated delivery/bounce evidence is not yet connected to a real provider adapter; unverified evidence must remain unverified. Do not activate Sent observation or DSN features on real mail before separate controlled acceptance. Individual-issuer final template still requires the approved reference. Historical invoice association remains separately approved work.

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
