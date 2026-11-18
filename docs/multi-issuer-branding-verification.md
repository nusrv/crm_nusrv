# Multi-issuer invoice presentation verification

Date: 2026-11-18. Starting HEAD: 3021264fdc9d1b5b9d5381593a3ba4bc79ac99d7.
The only pre-existing local addition was the owner's Future logo reference; its bytes were preserved.
Workstation source: G:\Projects\Customer_Renewal_CP_Codex_Pack_NODEJS.
Dependency-backed verification: C:\sgv\phase4b_verify only. No source-folder dependency installation.

## Result and model

One InvoiceRenderer continues to implement the approved A4 layout for NUSRV, Future, personal,
custom and no-logo issuers. BillingEntity remains the legal owner; existing identity/email/tax/address
fields are reused, with additive COMPANY/INDIVIDUAL type, Arabic legal name and ISO country code.
InvoiceBrandingProfile is 1:1 with the issuer, storing revisioned visibility, presentation contact/bank
fields and an optional immutable logo reference. No second financial-owner domain or credential model.

Invoice creation derives the issuer from its customer/subscription, locks that issuer through the
existing counter update and copies coherent identity/presentation defaults. The invoice JSON and logo
FK retain its original type, country, details, visibility, profile revision and asset version. There is
no live profile lookup for historical rendering. Accepted branding is locked. Direct visibility-only
updates preserve all invoice lines/IDs/amounts and legal data; combined draft edits keep the existing
controlled draft behavior. Both override paths audit old/new presentation state.

Logo uploads are ADMIN-only PNG, 256 KiB maximum and 4096px dimension maximum, with full decode/CRC
validation. Assets are immutable/deduplicated per issuer/SHA-256 in MariaDB, not copied into invoice
JSON. RESTRICT FKs preserve versions. Logo replacement/removal affects future invoices, not old ones.
Detail GET returns a data URL from the retained asset; no developer filesystem/docs/runtime asset URL
is required. The optional logo element is absent entirely when not configured/hidden; custom logo
height is bounded and long presentation text wraps within the A4 layout.

Visibility covers every requested identity/contact/bank group, plus fax. Official output forces the
canonical full seller name, address and tax/national identifier visible; server final-output readiness
requires those values. Drafts may hide them, with UI explanations. ISTD source: question 7 at
https://www.istd.gov.jo/Ar/Pages/fawateery . The source requires a full name, not specifically English;
this application uses its existing canonical legal-name field. Serial/date/items/totals/official QR
remain mandatory layout elements. UBL is unaffected by visibility, proven with exact XML comparison.

ADMIN edits identity, profile defaults and logo versions. ACCOUNTANT has read-only master access and
allowed DRAFT visibility overrides. A personal issuer uses its own BillingEntity/customer/ACTIVE
subscription. No ad hoc legal-issuer switching, free-price policy or new invoice workflow was added.
JoFotara connections/gateway/submission/credentials remain separate and their implementations unchanged.

## Approved data and deployment initialization

All initial identity and financial fields are preserved by the migration; only additive columns/tables
and a COMPANY default are introduced. No production IDs, default currency/type, taxpayer number or
preset branding are silently backfilled. ADMIN configures the profile once after deployment.

Stable-code New Serve/Future buttons explicitly load an approved reference into a reviewable form;
Save is required to update identity/defaults. New Serve uses the existing approved logo/HTML data.
Future uses the owner's exact future-foresight-logo-transparent.png, copied byte-for-byte to a public
bootstrap reference. The runtime invoice uses the persisted DB image once uploaded/saved. Future's
provided legal names, address, bank/branch/SWIFT, three IBANs and phone/fax/email/website are included.
No Future account number was inferred from its IBAN. No preset contains taxNumber, invoice type or
currency; customer sample 40231089 is not assigned as issuer identity. If no authoritative issuer
identifier is stored, Future remains unconfigured and preflight blocks official readiness/submission.

New personal/custom issuers can omit logo, Arabic name, contacts and banks. Official required fields
still apply. Existing pre-profile records use their recorded identity/bank data, with the previous
frozen NUSRV logo compatibility reference only for stored NEW_SERVE_LOCAL invoices. Other issuers do
not inherit that brand. New invoices explicitly snapshot no-logo state and never acquire a later logo.
Opaque legacy bank text is displayed only when no structured bank data is present and all bank groups
are visible, preventing partial visibility from leaking an unparsed account. Configure structured
profile bank fields for complete per-field control.

## Checks

- Prisma validate/generate: PASS.
- Strict workspace typecheck: PASS.
- Workspace lint: PASS.
- API / Next web / shared production builds: PASS.
- Focused branding: 12 passing tests, including a real React SSR renderer check with seven cases.
- Existing invoice focused suite plus extensions: 85 passing tests.
- New real-MariaDB branding tests: 4 passed.
- Full regression executed ONCE at the end: 1,201 passed, 120 existing gated tests skipped;
  131 passed suites, 11 skipped suites, 1,321 total tests. The two phase-4 live suites were enabled.
- Final logo-height/text-wrap CSS safeguards: fresh web production build and compiled-CSS/PDF checks PASS.
- Final source vs verification-copy comparison: matching code/assets after line-ending normalization.
- Approved Future reference and bootstrap PNG: byte-identical.

Actual compiled Next CSS and Chrome were used for NUSRV, Future, personal/no-logo, generic with bank
fields hidden, historical branding, and draft examples. Every example is one A4 page, all intended
images load, and personal/generic/draft have no logo element. PNG/PDF/HTML QA artifacts stay under
C:\sgv\branding-visuals; no generated artifacts are committed. These are synthetic examples, not
commercial invoices or production data. Actual owner print approval remains a deployment review step.

## Disposable migration verification

Additive migration: 20261118020000_multi_issuer_invoice_branding.
Standalone MariaDB 11.4.7, loopback port 33317, disposable *_test databases only.
Prisma migrate deploy successfully applied all 16 migrations to fresh branding_deploy_test.
The new live tests exercised actual profile/asset/invoice services, snapshot cloning, same-issuer
asset restrictions, immutable history after master changes/deactivation, invoice-only override audits,
unchanged line/financial data, retaining FK deletion rejection and accepted snapshot locking.
No production database or real taxpayer credentials were used.

Database/schema comparison shows no branding/invoice drift. The five pre-existing unrelated
updated_at SQL-default differences remain untouched. MariaDB DDL still requires normal backed-up
maintenance-window deployment; no prisma migrate dev was used. Backups must include logo assets.

## Security/deployment follow-up

The current and baseline 3021264 lockfiles were audited independently: both report the same 80
advisories (13 moderate, 62 high, 5 critical). Existing critical package names are concurrently,
handlebars, next, proxy-addr and shell-quote. No pngjs advisory was reported. No new advisory was
introduced by this pass, and no unrelated audit fix/upgrade was performed. Review/remediate the
existing critical advisories before production rollout; this is a separate security item, not a
branding test failure.

Before issuing: owner reviews/saves each issuer profile, uploads/chooses its logo if wanted, verifies
its legal taxpayer/national identifier (especially Future), bank accounts and country, then uses that
issuer's own JoFotara device with production submission separately enabled by ADMIN. Adding an
individual requires explicit customer ownership under that legal issuer. Retain encryption keys and
DB/asset backups; profile configuration never changes credentials or sends an invoice.

Payment Receipt remains deferred; future receipt must omit the source seal/stamp.
No push. No deployment. ZERO real JoFotara requests. No real credentials were requested/read/used.
