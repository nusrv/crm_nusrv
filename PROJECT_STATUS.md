# Project Status

## Current status

- Phase 0: COMPLETE / OWNER APPROVED
- Phase 1: COMPLETE / OWNER APPROVED
- Phase 2: COMPLETE / OWNER APPROVED
- Phase 2.1 Operational Data Correction: LIVE on `crm.nusrv.com` — code complete; 129 of 214
  legacy rows still await the owner's package-classification decisions
- Phase 2.2 Canonical Data & Migration Finalization: LIVE on `crm.nusrv.com` — see
  `PHASES/PHASE_02_2_CANONICAL_DATA_MIGRATION.md`
- Dashboard UI/UX overhaul (modal edit forms, dedicated customer page, collapsible sidebar,
  Legacy Import batch-list redesign and card sizing, sidebar toggle button redesign, subscription
  deep-linking, viewport-fixed sidebar toggle, Legacy Import customer combobox, shared
  SubscriptionModal popup, code/name display fix): code complete, committed on `main`
  (`80591fb`..`2540803`), not yet deployed — see "Dashboard UI/UX overhaul and collapsed-sidebar
  layout fix" below
- **High-impact fix**: every text search in the app (Customers, Subscriptions, Renewal Cases,
  Communication Outbox, Legacy Import rows) was silently or explicitly failing due to a
  Postgres-only Prisma filter used against this app's MariaDB datasource — see "Fixed a 500 error
  on every text search in the app" below. Commit `86c4ef7`, not yet deployed.
- Deployment model: the owner deploys to `crm.nusrv.com` manually after reviewing each GitHub
  change; Claude Code has no direct Plesk/SSH/database access and does not deploy
- **Subscription Code redesign** (`<CUSTOMER_CODE>-S<NN>`, replacing `LEG-S-*`, existing data
  backfilled in place, no re-import): code complete; owner review of the migration SQL caught 3 real
  production-safety bugs (LPAD truncation, missing transaction wrapping, unproven temp-namespace
  collision-safety) plus a 4th (the new FK would have broken existing customer deletion), all fixed
  and re-verified against a real local MariaDB; committed locally as four commits, **pushed to
  `origin/main`** — see "Subscription Code redesign" below
- **Create/Edit Subscription workflow redesign** (locked/searchable Customer selection depending on
  entry point; one coherent Start Date + Renewal Interval → Renewal Date model, enforced
  server-side, not just in the UI): code complete, no database migration needed, not yet
  committed — see "Create/Edit Subscription workflow redesign" below
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

Committed and deployed to `crm.nusrv.com`, in response to an owner request covering three points:
original subscription amount/currency with an automatic JOD equivalent, verifying that adding a new
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

## Canonical-import billingFrequency fix, phone types, and bulk customer delete

After Phase 2.2 was deployed and the owner began approving canonical rows, editing an already
live subscription failed with `billingFrequency must be one of the following values: MONTHLY,
QUARTERLY, SEMI_ANNUAL, ANNUAL, BIENNIAL, CUSTOM`. Root cause: `createCanonicalBatch()` set
`billingFrequency` from the package classifier's suggestion, which is always `undefined` for
canonical rows (the classifier never receives frequency free text for them), and clean rows route
straight to `READY_FOR_APPROVAL` — bypassing the only screen with an editable form — so there was
no way to fix it in the UI at all once created. Fixed by deriving `billingFrequency` directly from
`renewalIntervalMonths` via the existing `intervalToFrequency` helper instead of the classifier's
suggestion. Verified against all 214 real workbook rows: 166 `CUSTOM`, 45 `ANNUAL`, 3 `BIENNIAL`,
zero undefined. Commit `80591fb`.

Separately, the owner asked why customers with several phone numbers couldn't be marked
Mobile/Landline/Fax, why there was no way to edit or deactivate an existing contact channel, why
customer search seemed unavailable, and why there was no way to bulk-delete approved customers.
Customer search was already implemented (the customers list already queries company name, code,
email, and phone) — no code change needed there. The rest were real gaps: `phoneType` had been
added to the schema in Phase 2.2 but was never exposed on `CreateCustomerPhoneNumberDto` /
`UpdateCustomerPhoneNumberDto`, so a number could never be marked as Fax through the UI; the
contact-channels panel only supported adding new emails/phones, with no edit or
deactivate/reactivate controls. Both DTOs now expose `phoneType`, and the panel gained a Type
selector plus Edit/Deactivate/Reactivate actions per channel. Also added an Admin-only multi-select
bulk-delete to the customers list (checkboxes + "Delete N selected"), a general-purpose feature
usable for both import cleanup and ordinary housekeeping, alongside the existing per-row delete.
Commit `5381563`.

No schema or migration changes in either fix.

## Dashboard UI/UX overhaul and collapsed-sidebar layout fix

The owner requested a systemic UX change: every edit screen must open as a popup instead of
appearing inline at the end of the current page; clicking a customer must show a dedicated page for
only that customer, not an inline panel below the still-visible customer list; the main navigation
sidebar needs a collapse/expand arrow to reclaim screen width; and the Legacy Import staged-rows
table needed to stop requiring horizontal scrolling to read a row's data.

Built a shared `Modal` popup component and converted every manager's create/edit form to it:
Currencies, Billing Entities, Service Types, Package Catalog, Technical Connections, Subscriptions,
Customers, and — in a follow-up pass after the owner reported some forms were still inline — the
customer contact-channel email/phone forms and the legacy-contact "add contact" form, which had
predated the Modal conversion. Customer detail moved to a dedicated `/dashboard/customers/[id]`
route. The main sidebar and the Legacy Import batch-list panel each gained a collapse/expand arrow
(persisted in `localStorage`), and the staged-rows table gained Start/renewal-date and price
columns so a row's key data is visible without opening the inspector. Commits `895fa79`, `9366a5c`.

Two real bugs surfaced once the owner tested the deployed change, both fixed by commits `5270fb0`
and `6869b13`:

1. **Collapsed-sidebar layout bug.** The collapsible shell used CSS Grid with an explicit two-track
   `gridTemplateColumns` (`'0px 1fr'` when collapsed). `display:none` and `position:fixed` siblings
   are excluded from CSS Grid's item-placement algorithm, so once the sidebar was hidden, the main
   content became the *first* auto-placed grid item and was placed into the sidebar's now-empty
   `0px` track instead of the `1fr` track — even though the container itself still reported two
   tracks correctly. This squeezed all page content into a near-zero width: word-by-word title
   wrapping, overlapping text, and collapsed stat cards/tables, most visible on Legacy Import.
   Fixed by switching the shell from CSS Grid to Flexbox (sidebar conditionally rendered with a
   fixed `flex-basis`, main content `flex-1 min-w-0`), which has no equivalent placement ambiguity;
   applied the same fix to the Legacy Import batch-list panel.
2. **Selected-batch-lost-on-refresh bug.** The Legacy Import page's selected batch and staged rows
   were pure in-memory state with nothing restoring them on mount, so refreshing the page reset the
   view to "Select an import batch" even though the uploaded file was still present in the reloaded
   batch list — reported by the owner as the file "disappearing." Fixed by persisting the selected
   batch id in the URL (`?batchId=`) and restoring it once the batch list loads, matching the
   `?edit=`/`?customerId=` convention already used elsewhere in the app.

The owner then reported the Legacy Import "Import batches" list looked ugly — a long, mostly-empty
column with one filename squeezing the detail view beside it — and asked for it as a single row of
batches with the selected batch's data shown beneath it once clicked. Replaced the two-column grid
with one panel where batch cards wrap left-to-right in a row, followed by the selected batch's
detail/staged-rows table stacked full-width beneath it. The batch-list collapse/hide toggle from
the previous pass was removed entirely (state, `localStorage` key, buttons) since it only existed
to reclaim width from the two-column grid, which no longer exists in this single-column layout.
Commit `b2d4761`.

The batch-list redesign's `.batch-card` CSS then turned out to still cap card width at 320px
(`max-width: 320px`, plus `flex: 1 1 240px` stretching every card to fill its row evenly regardless
of content), so a long filename wrapped into two lines despite ample free horizontal space. Fixed
by changing `.batch-card` to `flex: 0 1 auto` with `width: max-content; max-width: 100%`, so each
card sizes to its own filename's natural width and only wraps once it genuinely reaches the
container's edge, plus `overflow-wrap: anywhere` on the filename as a fallback for names with no
natural break points. Commit `94d08c3`.

The sidebar collapse toggle button itself then turned out to be visually cropped: it was a child of
`<aside>`, and `<aside>` carried `lg:overflow-y-auto` for its scrollable nav content. Setting
`overflow-y` to anything other than `visible` computes `overflow-x` to `auto` too, so the aside was
clipping in both axes, cropping the button positioned half outside its right edge. Fixed by moving
`overflow-y-auto` onto a new inner wrapper `<div>` holding only the scrollable nav content, leaving
`<aside>` as `relative` with no overflow so the button (still a direct child of `<aside>`) can
render outside its bounds. Also bumped both toggle buttons from 28px to 32px (offset adjusted to
exactly half the button width), added a box shadow, and raised their `zIndex` to 50. Commit
`d106e33`.

The owner then asked to stop positioning the toggle on the sidebar edge/scrollbar entirely and gave
a specific two-state design: the collapse button now lives inside the sidebar's own header, in
normal flex flow beside the "Control Panel" heading (`flex items-center justify-between`, no
absolute positioning); the collapsed-state expand button sits inside `<main>` (now `relative`),
absolutely positioned in a left gutter reserved by widening `<main>`'s left padding to `lg:pl-16`
only while collapsed (`lg:pl-9` otherwise, matching the original `lg:p-9` left value) — guaranteed
not to overlap any page's heading text, since every page's content now starts to the right of that
reserved gutter. Sidebar width, the dashboard flex layout, and sidebar scroll behavior are
unchanged. Commit `eecee31`.

No schema or migration changes in any of this work — deployment is `npm run build` plus restarting
the API/web/worker processes. Per the owner's explicit instruction during the layout-bug
investigation, this work was reviewed and fixed by static code inspection only; no local
typecheck/lint/test/build was run for six commits (`5270fb0`, `6869b13`, `b2d4761`, `94d08c3`,
`d106e33`, `eecee31`) because the workspace lives on a cloud-synced drive that cannot run
`npm install` — see the environment note under the 2026-08-31 update in
`SESSION_HANDOFF_2026-08-29.md`.

Commit `7f4c21f` (this constraint was not in effect for this one, so it was fully verified via the
local mirror) added three further, explicitly-scoped improvements: customer subscriptions on the
customer detail page are now `Link`s to `/dashboard/subscriptions?edit=<id>`, which
`subscriptions-manager.tsx` reads on mount to fetch that subscription and auto-open its View/Manage
modal (invalid/deleted IDs surface as a `Notice` error, not a crash); the sidebar toggle button is
now `position: fixed` relative to the viewport in both states (previously in-flow/absolute),
staying reachable through page scroll, with `collapsed` state and its `localStorage` persistence
unchanged; and Legacy Import's separate "Search existing customers" input plus "Existing customer"
`<select>` under Attach existing customer are merged into one new `CustomerCombobox` component
(`apps/web/components/customer-combobox.tsx`) that reuses the existing debounced server-side
`/customers` search, shows `code · company · email` per result, and sets `candidateCustomerId`
exactly as before — `review()` now explicitly validates that field is set for `ATTACH_EXISTING`
since a free-text input can't carry native `required` semantics the way the removed `<select>`
could.

The owner has not yet deployed or tested any of this dashboard UI/UX work on `crm.nusrv.com`.

## Fixed a 500 error on every text search in the app

Every text search across the app — Customers, Subscriptions, Renewal Cases, Communication Outbox,
and Legacy Import row search — used Prisma's `mode: 'insensitive'` filter on `contains`. That
option is valid only for the Postgres/MongoDB connectors; against this app's `mysql` (MariaDB)
datasource, Prisma Client throws a validation error ("Unknown argument `mode`") the instant a
search term is present, surfacing as an unhandled 500. TypeScript didn't catch it at compile time
(the `where` object is assembled loosely, so excess-property checking never inspected the inner
`mode` field), and unit tests didn't catch it either since they mock Prisma rather than hitting real
MariaDB. This was almost certainly present since Phase 0/1 and had been silently failing
everywhere; it was only surfaced now because the new Legacy Import customer combobox (see above)
added proper error handling to its search request, where the old separate search input had none.

Fixed by removing `mode: 'insensitive'` from all 16 occurrences across 5 service files. Every
affected column lives in a `utf8mb4_unicode_ci` table (per the Phase 0/1 migration), and that
collation is already case-insensitive, so a plain `contains` behaves identically — this is a pure
bug fix, not a behavior change. Commit `86c4ef7`. Verified: Prisma generate, strict typecheck,
lint, 161 tests / 42 suites, both production builds. No schema/migration change.

**This is likely the highest-impact fix in this session** — every text search box in the live app
has probably been silently broken until now. After deploying, specifically retest search on the
Customers list, Subscriptions list, and Renewal Cases/Communication Outbox screens, not just the
Legacy Import combobox that surfaced it.

## Subscription popup on the customer page, and code/name display fix

The owner asked why subscription "codes" show as `LEG-S-<16 hex chars>` and why clicking a
subscription from the customer detail page navigated to `/dashboard/subscriptions` instead of
staying put. The code is intentional (a deterministic hash of the source row in
`legacy-import.service.ts`'s `generatedCode()`, ensuring re-importing the same workbook is
idempotent) but was wrongly shown as the primary label — swapped emphasis in the Subscriptions
table and customer detail subscription list so the descriptive `name` leads and the generated code
is small/secondary underneath. The navigation issue was fixed properly: extracted the entire
create/view/manage subscription modal (form, technical mappings, all fetch/save logic) out of
`subscriptions-manager.tsx` into a new shared `SubscriptionModal` component
(`apps/web/components/subscription-modal.tsx`) that any page can render without navigating away.
`customer-detail.tsx` now opens this modal in place for both viewing an existing subscription and
adding a new one; `subscriptions-manager.tsx` shrank to just its list/search/filter plus the same
shared modal, with its `?customerId=`/`?edit=` deep-link support unchanged. Commit `2540803`.

Verified: strict typecheck, lint, 161 tests / 42 suites, both production builds. No schema/
migration change; not yet deployed or tested by the owner.

The owner then asked to remove the generated code from list screens entirely, not just
de-emphasize it. Removed it from the Subscriptions table (column header renamed `Code / name` →
`Name`) and the customer detail subscription list. Inside `SubscriptionModal`, the modal title and
"Technical mappings for ..." heading now use the subscription's `name` instead of the code; the
code itself moved to a small muted `Code: ...` line under the title, visible only when the
subscription's own popup is open. Commit `07c14a9`. Display-only, no backend/search change.
Verified: strict typecheck, lint, both production builds. Not yet deployed or tested by the owner.

The owner then reported the code was "still there" after deploying — on the **Customers** list, a
different, untouched screen. Customers get their own analogous generated code (`LEG-C-<hash>`) in
its own "Code" column. Removed that column from `customers-manager.tsx`, switched the edit modal's
title from the code to the company name, and kept the code as a small muted reference line under
the title — same treatment as the subscription modal. The customer detail page's heading still
shows the code (consistent with "only inside a customer's own page" being acceptable). Commit
`5f2baa7`. No backend change. Verified: strict typecheck, lint, web production build.

Also noted: the owner separately hit `npm ci` failing on the server due to local npm cache
corruption at `/var/www/vhosts/nusrv.com/.npm/_cacache` (hundreds of "tarball ... corrupted"
warnings, then an `ENOENT` on a specific cache file) — unrelated to this repo's code. Recommended
`rm -rf /var/www/vhosts/nusrv.com/.npm/_cacache` then retry `npm ci`; check disk space if it
recurs. Not yet confirmed resolved by the owner.

The owner then asked to confirm whether the code should also be hidden from Legacy Import's
"Attach existing customer" combobox — it should: `optionLabel()` and the dropdown row still showed
`customerCode` as the bolded leading text for every result. Switched both to `companyName` only,
keeping `primaryEmail` as the secondary disambiguating line (the original reason the code was shown
there). Commit `4ab9873`. No backend change. Verified: strict typecheck, lint, web production
build.

## Customer phone validation and errors hidden behind every edit popup

Two bugs reported together: creating a customer failed with a phone regex error, and separately the
error wasn't visible on the Create Customer popup at all — only on the page behind it.

**Validation bug**: `CreateCustomerDto`/`UpdateCustomerDto`'s `phone` and
`phoneCountryCallingCode` fields had no normalization `@Transform` before their strict regex
checks, unlike the newer `CustomerPhoneNumber` DTOs which already strip spaces/dashes/parentheses.
Typing a phone with ordinary formatting (e.g. `+962 79 000 0000`) failed even though the number was
valid. Added the same transform used elsewhere to both DTOs, both fields.

**Hidden-error bug**: the same bug already fixed once for the Legacy Import row-inspector popup —
error/success `<Notice>` components rendered at the page level, behind the `Modal`'s opaque
backdrop, invisible while any Modal-based form was open. `SubscriptionModal` accounted for this
from the start, but it was never applied to the other 8 `Modal` conversions from the original UI/UX
overhaul (Customers, Currencies, Billing Entities, Service Types, Package Catalog, Technical
Connections, the customer detail "Add contact" popup, both contact-channel popups). All eight now
also render `<Notice>` inside the `Modal` itself.

Commit `3a880fe`. Verified: Prisma generate, strict typecheck, lint, 161 tests / 42 suites, both
production builds. Not yet deployed or tested by the owner. **Note for future work**: any new
`Modal`-based form must duplicate its page's error/success `<Notice>` inside the `Modal` — this has
now been missed twice.

**Follow-up (still-visible-behind-modal bug, commit `acdb80c`)**: the owner tested `3a880fe` and the
error still appeared "behind the popup screen, in the customer main page." That fix only added the
Notice inside the Modal — it never hid the original page-level copy, so both rendered at once and
the page-level one lingered as stale content after the modal closed (nothing ever cleared
`error`/`message` on close). Fixed by gating each page-level Notice pair behind its own modal-closed
condition (e.g. `{!formOpen && (...)}`) across the same 9 files. Verified: strict typecheck, lint,
161 tests / 42 suites, both production builds; `git diff` reviewed by hand to confirm only the
intended gating change landed (Prettier's full reformat of `legacy-import-manager.tsx`, driven by
that file's known pre-existing formatting debt, was discarded rather than propagated). Not yet
deployed or tested by the owner. **Note for future work**: fixing "Notice hidden behind Modal" is
two steps, not one — render it inside the Modal AND hide the page-level copy while that Modal is
open. Doing only the first step still leaves a stale/duplicate message on the page behind the modal.

**The phone validation error itself was still unfixed (commit `78dfedd`)**: the earlier fix only
stripped whitespace from an already-complete E.164 string; it never combined the form's two
separate inputs ("Phone" local number + "Phone country calling code"), so any phone typed the
normal way (e.g. `0799442940` / `+962`) could never pass `E164_PHONE`, which requires a leading
`+`. `customers-manager.tsx` now composes the full E.164 number from both fields before submitting.
Also fixed: `customers.service.ts` `update()` was re-validating the calling-code prefix on every
PATCH even when `phone` was unchanged from the edit form's own defaults, so editing any other field
on a customer who already had a phone on file failed unless the calling code was retyped every
time — now only re-checks when the phone value actually changes. Verified: strict typecheck, lint,
161 tests / 42 suites, both production builds. Not yet deployed or tested by the owner.

**A third, distinct create error surfaced next (commit `d1419f3`)**: "A record with this identifier
exists." on a genuinely first attempt. Cause: `create()` inserts `primaryEmail` and `secondaryEmail`
as two separate `CustomerEmailAddress` rows unique on `(customerId, email)` — typing the same
address into both fields collides with itself on a brand-new customer, no prior data involved. The
generic `throwMappedPrismaError()` mapper turns every P2002 into that same flat message with no
field context, which is why it looked meaningless. Fixed with an explicit pre-check that rejects a
duplicate secondary email before any DB write, with a clear message. Legacy Import's approval path
was checked and does not have this bug (dedupes via a `Map` keyed by address); `update()` doesn't
touch the `emailAddresses` relation so has no equivalent risk. **Open item**: `throwMappedPrismaError`
still maps every P2002 across every service to that same generic message — other duplicate-key
scenarios elsewhere in the app can still produce equally confusing reports until it's enriched with
constraint context, or each call site adds its own pre-check as this one did.

## Billing-Entity customer codes, bilingual names, deactivation cascade (commit `647461a`)

Large, explicit spec from the owner covering four related business rules, implemented in full —
see `SESSION_HANDOFF_2026-08-29.md`'s matching update for the complete breakdown:

- **Customer deactivation suspends every ACTIVE subscription** in the same transaction (via
  `/deactivate` or a direct status edit — both go through `CustomersService.update()`).
  Reactivation never touches subscriptions; reactivating a suspended subscription stays manual and
  individual. The renewal engine's reminder query already filtered `customer.status: ACTIVE`, so no
  change was needed there — confirmed and regression-tested.
- **Customer Codes (`FF0001`, `NS0001`, ...) are now system-generated**, one independent sequence
  per Billing Entity (new `CustomerCodeSequence` model + `CustomerCodeService`, the single
  authoritative generator for both manual creation and Legacy Import), never client-supplied,
  never reused after delete, concurrency-safe via a transactional row-lock increment.
  `BillingEntity` gained a required, immutable, unique `customerCodePrefix`.
- **Customer names are now bilingual**: `companyName` replaced by nullable `nameEn`/`nameAr`, at
  least one required (service-layer validation). Legacy Import auto-classifies the single source
  name column by Arabic-script detection (`name-language.util.ts`), not translation. Duplicate
  detection now compares both name fields and is scoped to the row's own Billing Entity — a name
  match across different Billing Entities is no longer a duplicate candidate at all.
- Schema/migration `20260908000000_customer_code_sequences_and_bilingual_names`. No renumbering of
  existing `LEG-C-*`/`LEG-S-*` codes, per explicit owner instruction (customers are being deleted
  and re-imported after this ships).

Verified: `prisma validate` + `db:generate`, strict typecheck, lint, 174 tests / 44 suites, both
production builds. **Not yet deployed.** Unlike other recent updates, this one requires
`db:migrate:deploy` before the app will even start against the live schema — see the deploy
sequence below.

## Legacy Import audit after the bilingual-name/customer-code change (commit `196f8f1`)

The owner asked for a focused audit of Legacy Import specifically. The frontend/backend bilingual
name contract was already fully consistent (`nameEn`/`nameAr` everywhere, no stale `companyName`)
— confirmed by grep and by reading every file the owner named. Two real bugs found and fixed
instead:

- **Mixed Arabic+English source names** (e.g. "Khayrat Al Shobak خيرات الشوبك") previously landed
  entirely in `nameAr` (any Arabic character present -> whole string classified Arabic).
  `name-language.util.ts`'s `splitBilingualName()` now safely splits a clean one-sided "Latin
  block, then Arabic block" (or reverse) into both fields; anything structurally ambiguous
  (interleaved scripts, a Latin-Arabic-Latin sandwich) still preserves the whole original string
  unsplit — no translation, nothing invented or discarded.
- **Canonical customer identity ignored Billing Entity (the critical one)**:
  `createCanonicalBatch()`'s customer-reuse reference was keyed on source `Customer_ID` alone, so
  a canonical customer with subscriptions under *both* Billing Entities (a real case in the
  workbook: `CUST-0005` / `mpr.com.sa`) would have its second Billing Entity's subscription
  silently reuse the first Billing Entity's customer on approval — merging what must be two
  separate `FFxxxx`/`NSxxxx` customers into one. Fixed by folding the row's resolved Billing Entity
  into that reference. `ATTACH_EXISTING` was already fully exempt (verified with a test); Customer
  Codes still come only from the existing shared `CustomerCodeService`, no second generator.

Also fixed two small UI-wording gaps in the same area: `customerCombinedLabel()`'s separator ("/" ->
"·") and the Attach Existing Customer combobox now shows the Customer Code alongside the name
(similarly-named customers across Billing Entities are expected and valid). Duplicate detection's
Billing-Entity scoping was reviewed and confirmed already correct from the prior update — a
regression test was added since none existed for that specific case.

Verified: strict typecheck, lint, 183 tests / 44 suites (12 skipped live-DB specs, unaffected — no
schema touched), both production builds. **Not yet deployed or tested by the owner.**

## Filters on Customers and Subscriptions pages (commit `796620f`)

Customers gained a Billing Entity filter (backend already supported it, just wasn't in the UI) and
a new created-date range. Subscriptions had Service Type and renewal-date-range support in the
backend but not the UI — exposed both — and gained three new filters: Package (cascades from the
selected Service Type), Billing Entity (via the customer relation), and Currency. Both pages got a
"Clear filters" button, matching the filter-bar pattern already used on Renewal Cases. Verified:
strict typecheck, lint, 186 tests / 45 suites, both production builds. **Not yet deployed.**

## Resolved — Renewals page crash (commit `8283162`)

The reported "not working from the beginning" was an actual browser crash: `Uncaught TypeError:
Cannot read properties of undefined (reading 'map')`. Root cause: `renewal-cases-manager.tsx`
called `GET /service-types` expecting a paginated `{ data, meta }` response (like `/renewal-cases`
and `/communication-outbox`, which genuinely are paginated) and read `.data`, but that endpoint
returns a **plain array** — `apiRequest<T>()` has no runtime validation, so the wrong generic type
silently produced `undefined`, and the crash only surfaced later at `.map()` in render.
`subscriptions-manager.tsx` already called the same endpoint correctly, which is how the owner
found the mismatch. Fixed the call/consumption, and added a defensive `?? []` fallback on all three
array-typed state setters in that component. `apps/web` has no test runner configured at all, so
instead of introducing one, added an API-side contract test pinning `/service-types`'s actual
(unpaginated) response shape. Verified: strict typecheck, lint, 187 tests / 46 suites, web
production build. Not yet confirmed fixed by the owner in the browser.

This was unrelated to the bilingual-name/migration work from a few updates ago — that "not yet
migrated" hypothesis was reasonable given the evidence at the time but wasn't the actual cause;
this bug predates that work entirely.

## Renewals page turned into an operational workspace (commit `835f7d1`)

Full 26-point rework, delivered after the crash fix above: overview cards (due within 7/30 days,
overdue, awaiting customer, on hold — RenewalCase-based, not raw subscriptions, and independent of
the table's filters); richer filters (search now covers Customer Code too; a new urgency filter
replaced the old exact-day `daysBeforeDue` dropdown with proper overdue/today/week/month range
buckets; new Package and Billing Entity filters; Clear filters); a much richer table
(Due/Days-left/Customer/Subscription/Service+Package/Amount/Billing-Entity/Status/Reminder/Actions,
with clickable Customer and Subscription links reusing the existing `?edit=` deep-link); a new
detail modal (`renewal-case-detail.tsx`) with customer/subscription sections, direct navigation
links, a renewal timeline built from the *actual configured* `ReminderRule`s (not hardcoded),
full communication history, and the hold/mark-* workflow actions; the Communication Outbox kept
but collapsed by default with its own filter, explicitly secondary. New backend:
`GET /renewal-cases/summary` and four intentional workflow-action endpoints
(mark-awaiting-customer/accepted/do-not-renew/fulfilled — not a generic status editor; Phase 3
invoice/payment states deliberately not exposed). No schema change. RenewalCase stayed the core
entity throughout, per explicit instruction — never became a second subscriptions page.

**Confirmed, unfixed (reported, not silently changed) renewal-engine limitation**: `evaluateAll()`'s
own subscription query only considers `renewalDate >= today`, so a subscription that's already
overdue *before the engine ever evaluates it* never gets a `RenewalCase` created and never appears
on this page at all. A case created while still upcoming, that later becomes overdue, is never
hidden or deleted — it correctly shows as "N days overdue," exactly as specified. See
`SESSION_HANDOFF_2026-08-29.md` for the exact query location if this needs a fix later.

Verified: strict typecheck, lint, 202 tests / 46 suites, both production builds. **Not yet tested
by the owner.**

## Subscription Code redesign — `<CUSTOMER_CODE>-S<NN>`, replacing `LEG-S-*` (pushed to `origin/main`, not yet deployed)

Same treatment the Customer Code work gave `customerCode`, now applied to `subscriptionCode`: a new
`SubscriptionCodeSequence` model + `SubscriptionCodeService` (one row per Customer, concurrency-safe
via a locked `upsert` inside the caller's transaction — direct structural mirror of
`CustomerCodeSequence`/`CustomerCodeService`) is now the single generator for both manual creation
(`SubscriptionsService.create()`) and Legacy Import (`LegacyImportService.approveRow()`, both
`CREATE_NEW` and `ATTACH_EXISTING`), producing `FF0001-S01`, `FF0001-S02`, ... — the sequence is
per-Customer, not global or per-Billing-Entity. `subscriptionCode` was removed from
`CreateSubscriptionDto` entirely (the API rejects a caller-supplied one, via the existing
`whitelist: true` validation pipe — not just a hidden frontend field) and `customerId` was removed
from `UpdateSubscriptionDto` (a subscription's Customer is now immutable after creation, since the
code encodes it). **Unlike the Customer Code work, this one migrates existing data in place** — the
owner explicitly required no re-import: migration
`20260909000000_subscription_code_sequences_and_backfill` deterministically backfills every existing
subscription's code (ordered per-Customer by `created_at` then `id`), preserving every Subscription
id and every foreign-key relationship (`RenewalCase`, `CommunicationOutbox`,
`LegacyImportSubscriptionLink`, etc. all key off the id, never the code). Verified end-to-end against
a real local MariaDB 12.1 database in-session (seeded mixed old-format codes, applied the migration,
confirmed exact expected ordering/ids/sequence-seeding), not just reasoned about. The old
`LEG-S-<hash>` generator (`generatedCode()` in `legacy-import.service.ts`) is deleted; `LEG-S` no
longer appears anywhere except historical `sourceLegacyReference`/`AuditEvent` data (untouched, on
purpose) and comments/test names documenting the removal. UI: every ambiguous "Code:" label (the
direct cause of the owner's "why does the customer have Code: LEG-S-..." report — the Renewal Case
detail modal showed a bare "Code:" under both its Customer and Subscription sections) now says
"Customer Code:" or "Subscription Code:" explicitly.

Verified: `prisma validate`/`generate`, strict typecheck, lint (both packages, zero warnings), 222
tests / 50 suites (210 passed, 12 skipped — live-DB suites only), both production builds, and the
migration itself against a real MariaDB as described above.

**Owner review round (same day) caught 3 real production-safety bugs in the migration SQL before
allowing a push**: `LPAD` silently truncating past 2 digits (would have collided subscription #100
with #10), the data rewrite not being wrapped in a transaction (a mid-failure would have left
production on temporary codes), and the temporary rename namespace not being provably collision-safe
against historical free-text codes. All three fixed (the migration now does a preflight
validate-and-guard pass via two temporary mapping tables — real `UNIQUE`/`CHECK`/`PRIMARY KEY`
constraints proving no collision or length overflow is possible — then wraps the actual rename in an
explicit transaction) and re-verified against a real MariaDB, including deliberately reproducing each
original bug first to confirm the fix actually addresses it, not just re-running the happy path. See
`SESSION_HANDOFF_2026-08-29.md`'s "2026-09-09 (same day, follow-up)" entry for the full detail.

A fourth review round then caught the new `subscription_code_sequences` FK being `ON DELETE
RESTRICT`, which would have broken the existing, unmodified `CustomersService.deleteCustomer()` flow
for every customer with a subscription. Fixed to `ON DELETE CASCADE ON UPDATE CASCADE` (schema +
migration), with a new live-DB test proving both that deleting one Subscription never touches the
sequence and that a Customer with a generated sequence still deletes cleanly through the real
`deleteCustomer()` workflow.

**Committed locally as four commits and pushed to `origin/main`** (`a3e73b6..190a11b`) after the
owner's review. **Not yet tested by the owner in the browser** and **not yet deployed** — see
`SESSION_HANDOFF_2026-08-29.md` for exact deployment steps (this one needs a real
`db:migrate:deploy` — it rewrites data, not just schema).

## Create/Edit Subscription workflow redesign — locked/searchable Customer selection, one coherent date model (not yet committed)

Two problems fixed: (1) "Add another subscription to this customer" from Customer Details still
showed a full Customer dropdown instead of using the already-known customer; (2) Start Date, Renewal
Interval, and Renewal Date could be filled in as three independent, contradictory fields.

Customer selection now has two modes on the shared `SubscriptionModal`: a `lockedCustomer` prop
(opened from Customer Details, or the Subscriptions page with `?customerId=` in the URL) renders the
Customer read-only using its real database id — no dropdown, no re-selection; without it, the
**existing** `CustomerCombobox` (already used by Legacy Import, reused as-is) provides searchable
selection by Customer Code, English name, or Arabic name. The old 500-row customer-list fetch that
powered the giant dropdown is gone.

Renewal Date is no longer independently enterable: a new shared `addCalendarMonths(date, months)`
helper (`packages/shared`, imported by both frontend and backend — one algorithm, not two) computes
it from Start Date + Renewal Interval, calendar-month-accurate with end-of-month clamping (31 Jan + 1
month → last day of Feb). `CreateSubscriptionDto` no longer accepts a `renewalDate` field at all —
the server always derives it — and `renewalIntervalMonths` is now required. `SubscriptionsService.
update()` only recalculates when Start Date or Renewal Interval actually change; opening Edit and
saving unrelated fields never touches a historical Renewal Date. Billing Frequency remains fully
independent (verified via a parametrized test across all six values). Legacy Import, the Renewal
Engine, and `contractTermMonths`/`ServicePackageTerm` were inspected and confirmed unaffected/unused
respectively — none were touched.

No database migration — none was needed. Verified: `prisma validate`, strict typecheck and lint
across all three packages (`@cp/shared`/`@cp/api`/`@cp/web`), 264 tests / 54 suites (242 passed, 22
skipped — live-DB-only), both production builds. **No browser-automation tool is available in this
session, so the UI was not manually clicked through** — disclosed rather than claimed as tested. See
`SESSION_HANDOFF_2026-08-29.md`'s "2026-09-09 (later same day)" entry for full detail.

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

1. **This deploy requires a migration** (unlike the last several): `git pull`, `npm ci`,
   `npm run db:migrate:deploy`, `npm run db:generate`, `npm run build`, restart the API/web/worker
   processes. The migration drops `customers.company_name` (copying it into `name_en` first) and
   adds a required `customer_code_prefix` to `billing_entities` (auto-backfilled `FF`/`NS` for the
   two existing entities). After deploying, create a test customer under each Billing Entity and
   confirm it gets `FF0001`/`NS0001`; deactivate a customer with an active subscription and confirm
   the subscription flips to `SUSPENDED`.
2. Deploy the current `main` branch and test the dashboard UI/UX overhaul and the collapsed-sidebar
   layout fix described above, especially on the Legacy Import page. This has not been tested
   against a live deployment yet. **Priority**: retest text search on Customers, Subscriptions,
   Renewal Cases, and Communication Outbox — all were likely silently broken (500 or no results)
   until the `mode: 'insensitive'` fix above.
3. Add `USD`, `SAR`, and `EUR` in Currencies / Rates with real rates before approving any row
   priced in them, if not already done.
4. Approve the rows that land at `READY_FOR_APPROVAL` directly; work through the remainder's
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
