# Project Status

## Current status

- Phase 0: COMPLETE / OWNER APPROVED
- Phase 1: COMPLETE / OWNER APPROVED
- Phase 2: COMPLETE / OWNER APPROVED
- Phase 2.1 Operational Data Correction: LIVE on `crm.nusrv.com` — code complete; 129 of 214
  legacy rows still await the owner's package-classification decisions
- Phase 2.2 Canonical Data & Migration Finalization: code complete, tests pass, migration
  additive-only and not yet applied to any database — see
  `PHASES/PHASE_02_2_CANONICAL_DATA_MIGRATION.md`
- Deployment model: the owner deploys to `crm.nusrv.com` manually after reviewing each GitHub
  change; Claude Code has no direct Plesk/SSH/database access and does not deploy
- Phase 3: LOCKED
- Phase 4+: LOCKED

## Phase 2.1 operational data correction

The codebase now has a MariaDB package catalog and term model, subscription package/specification
snapshots, explicit renewal intervals, structured customer contacts and subscription identifiers,
deterministic legacy classification, and a structured import review UI. Catalog pricing is separate
from actual subscription selling prices. All classification evidence and original registration
values remain traceable.

The official seed contains 19 offers/add-ons taken from `Packages.docx` plus eight
service-specific Custom templates. Supported standard term choices are 12, 24, 36, and 60 months;
explicit custom intervals from 1 through 120 months are supported.

The non-mutating dry run reconciled all 214 `Active_Subscriptions` source rows:

- 85 suggested official-package matches
- 72 suggested Custom classifications
- 57 ambiguous/conflicting classifications
- 214 rows still require human approval
- 0 rows were written to live Customer/Subscription tables

The operational importer preserves all 604 source rows for traceability while limiting human review
to the 214 `Active_Subscriptions` rows. The 388 `Suspended_Subscriptions` rows and two
miscellaneous-sheet rows are marked `SKIPPED` as out of scope. Migration
`20260827010000_scope_legacy_import_active_sheet` repairs already-staged batches idempotently
without deleting raw data or touching approved rows.

Explicit `Start Date` and `End Date` workbook columns are now preserved as source evidence,
validated against the recorded term, and prefilled into untouched subscription-review drafts. Excel
calendar dates are parsed without an operating-system timezone shift. Missing, invalid, reversed, or
term-conflicting dates remain flagged for human correction. Re-importing the identical workbook
refreshes only untouched manual-review rows and preserves corrected, ready, and approved rows. The
source `Renewal / date (-15days)` value remains separate evidence. The 72 Custom and 57 conflicting
rows still require explicit package decisions; split/merge decisions are never automatic. Private
review artifacts are under the Git-ignored `dont_push_to_git/` directory.

Local verification passes Prisma generation, strict type checking, lint, formatting, the NestJS
production build, the Next.js production build, and 136 default automated tests across 40 suites.
Twelve guarded tests across three live MariaDB suites are skipped unless MARIADB_TEST_DATABASE_URL
targets a disposable test database. The 214-row workbook dry run was repeated with identical results
while the source workbook hash remained unchanged.

Open dependency advisory: a clean npm audit reports three high-severity findings in the Prisma CLI
configuration chain (@prisma/config to deepmerge-ts). Prisma 7.10.0 still uses the affected
dependency, while npm proposes a prohibited forced downgrade to Prisma 6. The lockfile was not
mutated; this upstream Prisma 7 advisory must be monitored before production promotion.

## Subscription currency conversion and customer contact channels

Implemented locally (uncommitted) in response to an owner request covering three points: original
subscription amount/currency with an automatic JOD equivalent, verifying that adding a new
service/subscription to an existing customer does not require a duplicate customer record, and
E.164-ready multi-email/multi-phone contact channels per customer.

**Currency and JOD conversion.** A new `Currency` table (migration
`20260831000000_currency_and_contact_channels`) stores one row per supported currency: ISO code,
name, `rate_to_jod` (always expressed as "1 unit of this currency = X JOD"), the date that rate
became effective, and an active flag. JOD itself is seeded and DB-constrained to stay active with a
rate of exactly 1. A `currencies` module (`ADMIN`-only create/update, read open to all authenticated
roles) backs a new "Currencies / Rates" settings page at `/dashboard/currencies` for adding
currencies and editing/dating rate changes; every change is audited with the `1 X = Y JOD` direction
recorded in the audit metadata.

`Subscription.sellingPrice` and `Subscription.currency` keep storing the contract amount and
currency exactly as entered — never overwritten by a rate change. Three new columns
(`exchange_rate_to_jod`, `selling_price_jod`, `exchange_rate_effective_date`) capture a snapshot of
the rate in effect at the moment the subscription was created or last had its price/currency edited.
Every read additionally recomputes `currentSellingPriceJod`/`currentExchangeRateToJod` from the
currency's _live_ rate, so the JOD figure shown always reflects the latest configured rate without
ever mutating the original contract amount. Creating or editing a subscription now requires
selecting an active currency that has a configured rate; the subscription form's currency field is a
dropdown sourced from `/currencies?active=true`, and both the original amount/currency and the
current JOD equivalent are shown on the list and edit views. Legacy-import approval performs the
same rate lookup/snapshot when materializing a live subscription, and the workbook parser now
recognizes explicit "Original Subscription Amount" / "Original Subscription Currency" columns,
preferring them over the older Price JD / Price USD columns when present. It also recognizes a
single combined column (matched on a header containing "real price") holding both the amount and
currency in one free-text cell, e.g. `"1250 SAR"` — the format used in the owner's real workbook —
and only falls back to it when no dedicated amount/currency columns exist at all.

**Multiple services per customer.** Confirmed the existing one-customer-to-many-subscriptions
schema, and added a "Add another subscription to this customer" link on the customer detail view
that opens the subscription form pre-selecting that customer (`/dashboard/subscriptions?customerId=`),
so an additional service/plan is always attached to the existing customer record rather than
prompting a new one. The subscription form's customer dropdown now loads up to 500 customers
(previously capped at 100).

**Customer contact channels.** New `CustomerEmailAddress` and `CustomerPhoneNumber` tables let a
customer have any number of emails and phone numbers, each with its own holder/contact-person name,
department/type (`PRIMARY`, `BILLING`, `TECHNICAL`, `MANAGEMENT`, `OTHER`), an optional label, and a
primary flag that is exclusive per customer per channel type. Phone numbers are DB- and
DTO-validated as E.164 (`+` plus 8–15 digits, must start with the supplied country calling code),
ready for future messaging/SMTP integrations. A dedicated `customers/:id/channels` module
(`ADMIN`/`SALES_DEVELOPMENT` to mutate, read open to all authenticated roles) backs a contact-methods
panel on the customer detail view; creating a customer still requires one primary email and
optionally one phone, which are also recorded as the first row in the new channel tables so existing
single-value consumers (`Customer.primaryEmail`/`secondaryEmail`/`phone`) stay in sync with whichever
address/number is marked primary. The migration backfills existing customers' legacy
`primary_email`/`secondary_email`/`phone` (and structured `customer_contacts`) values into the new
tables non-destructively; legacy phone values are only copied where they are already unambiguous
E.164 (JO/SA/AE/US) — other legacy numbers stay in the old free-text column pending human
normalization instead of being guessed at.

Verification for this feature: Prisma generation, strict typecheck, lint, Prettier formatting, and
the full test suite (136 tests / 40 suites, including new `currencies.service.spec.ts` and
`customer-channels.service.spec.ts` unit tests, RBAC coverage for both new controllers, and a parser
test for the new workbook columns) all pass, plus both the NestJS and Next.js production builds,
which include the new `/dashboard/currencies` route. This work is committed on `main` and deployed
to `crm.nusrv.com`.

Known follow-up (not blocking, not yet implemented): legacy-import customer creation does not
auto-populate the new `CustomerPhoneNumber` table from the workbook's free-text phone column (only
email addresses are auto-seeded) — a human can add the E.164 number afterward through the contact
channels panel, consistent with how every other ambiguous legacy value already requires confirmation.

## Phase 2.2 canonical data & migration finalization

Full detail: `PHASES/PHASE_02_2_CANONICAL_DATA_MIGRATION.md`. Summary: the owner completed an
external data-cleaning pass over the 214-row legacy workbook, producing an approved multi-sheet
relational export (`CRM_Canonical_Import_v4_Approved_Phone_Corrections_2026-09-06.xlsx`) with its
own customer/contact/phone/email/subscription/identifier sheets, already reviewed and marked
`READY`. This phase adds what the application needed to safely consume it:

- `Customer.sourceSequence` / `Subscription.sourceSequence` — source-appearance order, not
  alphabetical; the customer list's default order changed accordingly.
- `CustomerPhoneNumber`/`CustomerEmailAddress` gained an optional `contactId` link plus
  `phoneType`, decomposed phone parts, and verification tracking.
- `Subscription.currentTermEndDate` and `Subscription.paidLabel` — see the Phase 2.2 doc for the
  documented transitional mapping against the existing `renewalDate` field the renewal engine
  reads.
- A new, independently-tested phone normalizer (dash-split, slash-suffix expansion, shared-prefix
  inheritance, Saudi-hyphen-is-one-number, incomplete-value rejection) plus the five manually
  approved phone corrections as an authoritative override table.
- A new canonical-workbook parser and importer path (auto-detected by sheet names), reusing the
  existing review/approve pipeline and package-classification engine, with idempotent customer
  resolution across a customer's multiple subscription rows.
- Legacy-import UI: currency now a dropdown from the Currency table, a searchable (not
  capped-at-100) existing-customer selector, and a read-only multi-phone/email display in the
  review form.

Migration `20260906000000_canonical_phone_contact_and_source_order` is purely additive. Verified:
typecheck, lint, both production builds, and 161 tests / 42 suites all pass; a structural dry run
of the real approved workbook (parser + reused classification engine, no live database available)
reproduced the workbook's own README counts exactly (124 customers, 214 subscriptions, 374 phones,
205 emails, 275 identifiers) and the historical classification baseline exactly (85
`MATCHED_OFFICIAL` / 72 `CUSTOM` / 57 `MANUAL_REVIEW`). Not yet run against a live database, and
not yet deployed — this is a schema-changing release awaiting the owner's review and deployment.

## Staging CAPTCHA deployment patch

The internal staff-only Control Panel supports `CAPTCHA_PROVIDER=none` in production. Login then
requires only email and password; credential validation, lockout, secure cookies, origin/CSRF
protection, RBAC, and audit behavior remain unchanged. Turnstile and reCAPTCHA retain credential
validation, and mock CAPTCHA remains prohibited in production.

## Phase 2 renewal behavior

The approved deterministic renewal engine remains unchanged except for additive support for an
explicit renewal interval. Existing frequency behavior remains the fallback. Reminder milestones,
outbox idempotency, BullMQ worker separation, business timezone, multi-hold aggregation, RBAC, and
audit behavior remain covered by the full test suite. No SMTP delivery or Phase 3 integration exists.

## Deployment model

Live at `crm.nusrv.com` (Plesk 18.0.80, Node.js 22.23.2, MariaDB 11.4.7, Redis 7.4.11). The owner
deploys manually after reviewing each GitHub change; Claude Code sessions do not have Plesk/SSH/
database access and do not deploy. Every session's own local verification (typecheck, lint, tests,
production builds) is therefore against the code only, never against the live database — MariaDB
constraints, Redis/worker behavior, and a real import approval have only ever been exercised by the
owner directly on `crm.nusrv.com`, not reproduced in a session. Treat any session's "verified"
claim as scoped to that.

## Required owner/operator actions

1. Deploy the Phase 2.2 release (see `PHASES/PHASE_02_2_CANONICAL_DATA_MIGRATION.md` for the exact
   steps) and upload `CRM_Canonical_Import_v4_Approved_Phone_Corrections_2026-09-06.xlsx` through
   Legacy Import.
2. Add `USD`, `SAR`, and `EUR` in Currencies / Rates with real rates before approving any row
   priced in them.
3. Approve the rows that land at `READY_FOR_APPROVAL` directly; work through the remainder's
   package-classification decisions (the same 129-row backlog Phase 2.1 already identified).

## Integration status

- MariaDB: Phase 0–2.2 schema/migrations and guarded tests prepared; live and in use on
  `crm.nusrv.com`, not independently re-verified from inside a session
- Redis/BullMQ: approved Phase 2 scheduler/worker preserved; live runtime not independently
  re-verified from inside a session
- Communication outbox: durable queue records only; no delivery transport
- Technical Connections: secure configuration/mapping only; no external provider calls
- Phase 3 integrations: LOCKED and not started

## Next allowed work

Only Phase 2.1/2.2 human data resolution and their staging/production deployment are allowed.
Phase 3 remains locked until Phase 2.1/2.2 are fully completed, verified, and explicitly authorized
by the owner.
