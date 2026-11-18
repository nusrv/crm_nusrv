# Phase 4 - Human-controlled invoices and JoFotara

## Current scope

Owner-authorized Phase 4A hardening and Phase 4B integration are implemented locally.
No push, deployment, real credentials, real invoice POST, Mail/AI integration, or Payment Receipt.

ACTIVE Subscription -> Create CRM Invoice Draft -> auto-populated persisted Customer/Subscription/
Billing Entity snapshot -> human review/edit -> Preflight -> READY_FOR_FAWTARA -> explicit human
Submit Real JoFotara Invoice -> accepted/rejected -> official reconciliation -> NUSRV branded final
invoice -> browser Print / Save PDF.

## Phase 4A hardening

Only ADMIN/ACCOUNTANT may cancel a DRAFT, with a mandatory reason and UI confirmation. CANCELLED
records remain permanently, release the active-draft unique guard, and cannot be edited, officialized,
or rendered as customer invoices. Accepted records cannot use draft cancellation. There is no invoice
delete endpoint. Source financial records and submission history use RESTRICT relationships.

Manual acceptance requires SUBMITTED/ALREADY_SUBMITTED, official number, acceptance timestamp, and
an uploaded graphical PNG/JPEG/WebP official QR. MIME/signature checks reject active formats and
payload-only entry. UUID remains optional for this manual bridge. Provenance MANUAL/API is persisted
and displayed internally, without operational metadata on the customer document.

Original draft lines/totals and official values remain separate. Exact scaled integer arithmetic detects
any difference at database precision (0.001); currency differences also block final rendering/printing.
An explicit ADMIN/ACCOUNTANT reconciliation records actor, time, explanation, original and official
values in audit history. This does not alter draft lines. A reconciled discrepant document explicitly
labels historical CRM line values and shows the differences next to authoritative official totals;
it never silently presents mismatched lines and totals as consistent. Cancelled or unreconciled accepted
records produce no printable customer document. Print is a browser feature, not DRM for internal users.

## Independent device/link domain

BillingEntity 1 -> many JoFotaraConnection. Each actual portal device has its own name/user label,
income-source sequence, encrypted Client ID, encrypted Secret Key, enable flag, production permission,
last-used/disabled dates and audit. No global credential record. A nullable unique issuer key plus a
MariaDB CHECK enforce at most one enabled default per entity. Configuration updates lock the issuer
row to serialize default selection. Disabling removes default selection and turns production permission
off; no delete API is provided.

ADMIN configures connections from Billing Entities. ACCOUNTANT has masked read-only access. Both
credentials use the existing AES-256-GCM SecretEncryptionService/envelope and deployment encryption
key. Client ID is masked and Secret Key write-only after save. Replace inputs never refill plaintext.
GET/list/audit omit ciphertext and plaintext. Store/backup the encryption key securely; a changed key
makes historical encrypted credentials unreadable. Saving configuration never invokes the gateway.
Configured != production enabled. New connections default productionSubmissionEnabled=false.
No fake Test Connection exists: invoice submission must never serve as a connectivity test.

Invoices may select a connection of their own issuer or resolve that issuer's active default.
Preflight and submission both enforce issuer isolation. Durable attempts retain the exact connection
FK, name/income-source snapshots and request identity even after the device is renamed or disabled.
Replacing one device does not overwrite another. No credential is copied into invoice/attempt history.

## Official specification and supported mapping

Authoritative source inspected: ISTD technical API guide v1.5 (2026), release history dated 12 May,
approvals dated 14 May 2026:
https://istd.gov.jo/ebv4.0/root_storage/ar/eb_list_page/%D8%A7%D9%84%D8%AF%D9%84%D9%8A%D9%84_%D8%A7%D9%84%D8%AA%D9%82%D9%86%D9%8A_%D9%84%D9%84%D8%B1%D8%A8%D8%B7_%D9%85%D8%B9_%D9%86%D8%B8%D8%A7%D9%85_%D8%A7%D9%84%D9%81%D9%88%D8%AA%D8%B1%D8%A9_%D8%A7%D9%84%D9%88%D8%B7%D9%86%D9%8A.pdf

Reviewed PDF pages 10, 12-20, 33-44 and 96-104, including mandatory/optional highlighting, not a vendor
schema. Mapper supports income/general sales, local/export, cash/receivable profiles
011/021/111/121/012/022/112/122. Other invoice types fail closed; special tax, developmental zones,
returns/credit notes and other profiles require a later reviewed extension.

FawtaraInvoiceMapper consumes the persisted Invoice/InvoiceLine snapshot only. Explicit invoice
profile, ISO issuer/buyer countries, stable UUID/counter, tax identity, reviewed tax category/rate,
issuer/buyer names, line quantities/prices/discounts and income source feed XML. Missing fields fail
preflight; no invented tax IDs, countries, tax exemption, zero-tax category, or commercial references.
Service periods remain in the invoice snapshot/customer view rather than invented XML nodes.

The guide's gross TaxExclusiveAmount differs from CRM net subtotal: mapper adds the persisted
line-discount total using exact arithmetic. General sales categories follow ISTD: S positive documented
rate, Z exempt, O zero-rated; income uses explicit INCOME/zero arithmetic and omits general-tax nodes.
XML escaping prevents snapshot text from creating nodes. The golden fixture is synthetic financial
data, independently reviewed against the documented structure and formulas; it is not a real invoice.
An issuer counter increments transactionally without resetting annually; historical invoices are
backfilled deterministically. UUID and business ID remain unchanged for uncertain recovery.

## Preflight and permission

Readiness covers customer/issuer snapshots, active Billing Entity, date/currency, service periods,
lines/taxes, exact arithmetic/totals, supported UBL profile, stable identity/counter, income source,
issuer-scoped enabled connection and both configured credentials. Production permission is separately
reported as a nonblocking PASS/FAIL check: READY is possible while production submission is disabled.
Actual POST requires READY, current passing preflight, enabled own-issuer connection and credentials,
production permission, ADMIN/ACCOUNTANT role and explicit CREATE_REAL_JOFOTARA_INVOICE confirmation.

Only the guarded authenticated HTTP controller supplies human initiation. The invoice module exports
no submission service to workers; no AI, cron, scheduler, mail, queue or RenewalCase path invokes it.
UI confirmation complements server gates. An integer revision and database compare-and-set reservation protect concurrent
submissions and blocks draft/manual/status mutation while an outcome is uncertain.

## Request, response and retention

FawtaraGateway uses native fetch with one POST to
https://backend.jofotara.gov.jo/core/invoices/ and headers Client-Id, Secret-Key,
Content-Type: application/json. Body is {"invoice":"<UTF-8 XML encoded as Base64>"}.
Timeout is 30 seconds, redirects forbidden, automatic/background retry absent. No real call was made
during this task. Automated tests use mocked fetch/gateway only.

Before network I/O a transaction creates FawtaraSubmission with actor/time, attempt sequence,
exact connection/name/income source, stable business ID/UUID, exact XML and SHA-256 hash. XML contains
invoice data only, never auth headers. XML is deliberately retained as financial/customer audit data:
limit DB/backup access and retain with the invoice; it is not returned in ordinary history lists.
Financial/attempt history is not cascade deleted. Response persistence contains only whitelisted,
validated fields, redacted diagnostics, HTTP/EINV outcomes, official identity/QR and completion time.
Neither secrets nor arbitrary response/auth objects are stored/audited. No raw provider exception is
returned. Unexpected/malformed/timeout outcomes stay UNKNOWN with the reservation held.

A human can explicitly recover UNKNOWN (or PENDING older than five minutes after a process/database
failure), reusing EXACT original XML, ID, UUID and connection. No replacement draft/edit/manual
acceptance is permitted while reserved. Recovery still requires an enabled connection and production
permission. It is another explicit real POST, never an automatic retry. The documented
ALREADY_SUBMITTED semantics recover the original QR; accepted identity must match the submitted ID/UUID.
Never blindly create a new invoice following a timeout. If configuration disables the original device,
an administrator must resolve that device before recovery; do not select another issuer/device.

Only SUBMITTED/ALREADY_SUBMITTED plus official number/UUID/QR can accept; HTTP 200 alone never can.
NOT_SUBMITTED persists rejection and diagnostics, then allows the existing explicit return-to-draft
correction path. API success sets provenance API. EINV_SIGNED_INVOICE and ISTD's alternate spelling
EINV_SINGED_INVOICE are recognized. Returned invoice XML is parsed without DTD/entities; official
identity and monetary totals are checked and reconciled against the draft. When signed totals are
absent, they remain absent (not invented); the exact accepted request is retained as evidence. The
CRM does not independently verify a returned XML cryptographic signature.

The exact EINV_QR response string is rendered to a PNG by a dedicated utility; no QR semantics are
reconstructed from CRM values. Manual flow requires the uploaded original graphical image. Raw QR
text is never substituted into the customer document.

## Approved renderer and later receipt

All four supplied references were inspected: docs/templates/invoice_template.html,
invoice_original.pdf, payment_receipt_template.html and payment_receipt_original.pdf.
React uses persisted values and the supplied invoice identity/layout: logo/legal header, upper-right
QR, buyer block, six-column items, totals, bank/footer and A4 print. No contenteditable behavior or
reference customer/bank numbers enter production code. Bank settings may be replaced per entity,
encrypted with the existing mechanism, and copied into the invoice; draft bank/Arabic identity
snapshot fields can be reviewed. Drafts prominently state DRAFT / NOT OFFICIAL with no official QR
or fabricated electronic number. Final rendering requires accepted status, graphical QR and resolved
reconciliation. Multi-page lines flow without fixed-height clipping.

Payment Receipt is NOT implemented. Its approved references remain untouched. The later production
receipt must OMIT the stamp/seal visible in payment_receipt_original.pdf.

## Migration and deployment prerequisites

Additive MariaDB migrations: 20261118000000_phase4a_invoice_hardening and
20261118010000_phase4b_jofotara_connections_submissions, following the existing foundation migration.
They preserve accepted/draft records, provenance, counter/UUID backfills, default uniqueness/CHECK (immutable issuer FK uses ON UPDATE RESTRICT),
credential text envelopes, exact decimal fields, indexes and RESTRICT history FKs. Backfill invoice
profiles/countries by explicit human review; migrations do not assume tax treatment. No migrate dev.
Schedule a backed-up maintenance window with writers stopped for additive DDL/backfills; MariaDB DDL
is not transactionally rolled back as a whole. Keep a restorable backup and apply migrations once.

Use supported Node LTS meeting package engines, install from lockfile, migrate deploy, generate,
build and restart via the owner's deployment procedure. Preserve ENCRYPTION_KEY_BASE64 and backups.
Review issuer/tax/bank information and device registration; enter credentials only through ADMIN UI.
The first actual commercial invoice and owner visual acceptance remain deployment prerequisites.
Mail/AI acceptance remains deferred independently. Payment/collection and other phases are not started.

## First real invoice procedure (owner only, after deployment)

1. Confirm backup/migrations/builds and authorized ADMIN/ACCOUNTANT access. Verify the correct legal
   Billing Entity's identity, bank information, customer snapshot, subscription/service period and tax
   profile with the accountant. This must be a legitimate commercial invoice, never a dummy test.
2. ADMIN creates the matching portal device/link in that entity's JoFotara settings, enters its own
   Client ID/Secret Key/income source, and selects the intended default. Confirm submission remains
   OFF and that saving performs no request. Independently confirm the portal device registration.
3. Create the invoice from the ACTIVE subscription. Review every persisted field, country/profile,
   lines, tax treatment and totals; correct the DRAFT as needed. Confirm preview says NOT OFFICIAL.
4. Run Preflight. Resolve all blocking failures. Mark READY while production permission is still OFF.
5. ADMIN explicitly enables production on that device. Operator verifies connection and invoice one
   final time and chooses Submit Real JoFotara Invoice, accepting the irreversible-real-invoice prompt.
6. Inspect EINV_STATUS/diagnostics and history. On rejection follow controlled correction. On unknown
   outcome stop; do not create a replacement. Review original attempt and use explicit same-XML
   recovery only after checking the portal; ALREADY_SUBMITTED recovers an earlier acceptance.
7. On acceptance verify official ID/UUID and graphical QR against JoFotara, review returned official
   totals/reconciliation, and have the accountant explicitly reconcile any differences with a reason.
8. Inspect final NUSRV layout/legal/bank values, then Print / Save PDF at A4/100% with browser headers
   and footers disabled. Retain PDF and submission evidence. Disable production again if desired.
