# Session Handoff — 2026-08-29

## Start here

1. Read `AGENTS.md` and `PROJECT_STATUS.md`.
2. Read this handoff completely.
3. Run `git status -sb` and confirm the current branch before editing.
4. Keep Phase 3 locked. Only Phase 2.1 data completion and staging-readiness work is authorized.

## Owner decisions that override older planning text

- Application database: MariaDB, not PostgreSQL.
- Prisma datasource provider: `mysql` with Prisma 7 and `@prisma/adapter-mariadb`.
- Staging runtime: Node.js 22.23.2, MariaDB 11.4.7, Redis 7.4.11, Plesk 18.0.80.
- Production CAPTCHA may be disabled with `CAPTCHA_PROVIDER=none` for this internal staff-only CP.
- Phase 0, Phase 1, and Phase 2 are owner approved.
- Phase 3 is locked and has not started.

## Git state at handoff creation

- Branch: `main`
- Remote tracking branch: `origin/main`
- HEAD: `20039c686c0c718abba5dc6b33272e49e1d4acc8`
- HEAD subject: `Limit legacy review to active subscriptions`
- Branch was synchronized with `origin/main` before this handoff file was added.
- This handoff file itself is intentionally a new local file and has not been committed or pushed.

Recent implementation commits:

- `20039c6` — Limit legacy review to active subscriptions
- `8b47131` — Fix MariaDB Phase 2.1 constraint name
- `f31497d` — Implement Phase 2.1 operational data correction
- `5a08fd9` — Bind API to localhost for Plesk staging
- `7b4b290` — Make CAPTCHA optional for internal control panel

## Current product status

- Phase 0: OWNER APPROVED
- Phase 1: OWNER APPROVED
- Phase 2: OWNER APPROVED
- Phase 2.1: implemented; data decisions and staging verification remain
- Staging Runtime Gate: blocked pending real deployment/access
- Phase 3+: locked

The Phase 2.1 code includes the package catalog and term model, subscription snapshots,
deterministic legacy classification, structured import review, MariaDB migrations, RBAC, audit,
and preservation of the approved renewal engine.

## Canonical MariaDB migrations

- `apps/api/prisma/migrations/20260823000000_mariadb_phase_0_1_foundation/migration.sql`
- `apps/api/prisma/migrations/20260824000000_phase_2_renewal_engine/migration.sql`
- `apps/api/prisma/migrations/20260827000000_phase_2_1_operational_data/migration.sql`
- `apps/api/prisma/migrations/20260827010000_scope_legacy_import_active_sheet/migration.sql`

Do not rewrite these migrations merely for deployment. The latest active-sheet migration keeps all
604 source rows traceable while limiting operational review to 214 `Active_Subscriptions` rows.

## Private workbook artifacts

All files below are under Git-ignored `dont_push_to_git/`. They contain private operational data and
must never be committed or printed into logs/chat in bulk.

- Original source: `dont_push_to_git/Project20report20Filled.xlsx`
- Package source: `dont_push_to_git/Packages.docx`
- Catalog output: `dont_push_to_git/Available_Packages_Catalog.xlsx`
- Dry-run report: `dont_push_to_git/Phase_2_1_Dry_Run_Report.json`
- Repeat dry-run: `dont_push_to_git/Phase_2_1_Dry_Run_Report_repeat.json`
- Existing review workbook: `dont_push_to_git/Phase_2_1_Human_Review.xlsx`
- Latest date-completed copy: `dont_push_to_git/Project20report20Filled_With_Start_End_Dates.xlsx`

## Latest completed task: calculated date workbook

The owner asked for a new copy of the original workbook with exactly two columns inserted at the
beginning of `Active_Subscriptions`:

- Column A: `Start Date`
- Column B: `End Date`

Every original column remains present. The original `Renewal date (-15days)` column moved from A to
C and was not deleted or overwritten.

Calculations applied to all 214 active subscription rows:

```text
End Date = Renewal date (-15days) + 15 days
Start Date = End Date - renewal interval months + 1 day
```

The one-day adjustment represents an inclusive subscription term. Renewal intervals came from the
deterministic Phase 2.1 dry run: 12, 24, 36, or 60 months.

Verification results:

- 214 rows populated
- 0 date-calculation errors
- All five original worksheets preserved in their original order
- 8,346 original populated cells compared
- 0 original value/type differences
- Excel adjusted formula references after inserting two columns, as expected; cached formula results
  remained unchanged
- Original workbook SHA-256 remained:
  `78F6B8A8CB6CA33038310BB61EDFD764DB4DD2F745A7D51DFAA4A816B501C73B`
- Output workbook is ignored by Git
- Git working tree was clean before adding this handoff

## Important importer caveat for the next session

The current importer preserves the new `Start Date` and `End Date` cells as raw source values, but
the approved Phase 2.1 parser deliberately does not yet treat source dates as confirmed normalized
subscription dates. The structured review draft still starts with null `startDate`/`renewalDate`
until a human confirms them.

If the owner's next request is for the newly generated workbook to pre-populate dates automatically
in the import-review screen, implement the smallest Phase 2.1 patch to:

1. recognize the new `Start Date` and `End Date` headers after the two-row header normalization;
2. preserve both as explicit source evidence;
3. prefill, but do not auto-approve, the structured subscription draft dates;
4. continue requiring human approval for package ambiguity, conflicts, splits, duplicates, and any
   invalid date/term relationship;
5. add parser, import-service, UI, idempotency, audit, and 214-row workbook regression tests;
6. keep the old reminder column as evidence and never reinterpret it silently;
7. keep Phase 2 renewal behavior and Phase 3 lock unchanged.

Do not assume that uploading the new workbook alone will remove all manual-review requirements.
Package decisions and normal approval controls remain separate from date completion.

## Phase 2.1 reconciliation snapshot

The last deterministic dry run over all 214 active rows reported:

- 85 suggested official-package matches
- 72 suggested Custom classifications
- 57 ambiguous/conflicting classifications
- 0 live Customer/Subscription records written by the dry run

All 214 rows still require human approval by design. The 388 suspended rows and two miscellaneous
rows are retained as raw traceability records and marked out of the active import scope.

## Last recorded verification baseline

`PROJECT_STATUS.md` records:

- Prisma generation passed
- strict typecheck passed
- lint passed
- formatting check passed
- NestJS production build passed
- Next.js production build passed
- 119 default tests passed across 38 suites
- 12 guarded live-MariaDB tests remain skipped unless `MARIADB_TEST_DATABASE_URL` points to a
  disposable MariaDB database
- repeated 214-row dry run was identical

Re-run the relevant checks after any new code patch. Never claim a live MariaDB or staging test
passed unless a real MariaDB/staging environment was actually used.

## Staging/runtime status

Target environment:

- Hostname: `crm.nusrv.com`
- Plesk: 18.0.80
- Node.js: 22.23.2
- MariaDB: 11.4.7
- Redis: 7.4.11

No staging installation should be started without explicit owner authorization and access. The
runtime gate remains blocked pending deployment credentials/access, actual migration execution,
Redis/worker verification, UI/RBAC/security smoke tests, and renewal idempotency checks.

## Security and scope reminders

- Never commit anything under `dont_push_to_git/`.
- Never log or reproduce workbook credentials or other sensitive cells.
- Do not weaken RBAC, audit immutability, encryption, authentication, lockout, cookies, origin/CSRF,
  or Technical Connection masking.
- Technical Connection inventory remains visible only to Admin and IT.
- No SMTP, IMAP, LLM, Fawtara, payment, suspension/reactivation, provider action, MCP, or other Phase
  3+ work is authorized.

## Update â€” 2026-08-30 explicit-date importer patch

Released to GitHub main as commit cc8427c24e57079195f20c26b98a7730ce46f03.

The importer caveat above has now been addressed in the working tree:

- `Start Date` and `End Date` are recognized from the two-row workbook headers.
- Valid dates prefill the structured subscription review while human approval remains mandatory.
- Excel calendar dates no longer shift backward through UTC conversion.
- The old `Renewal date (-15days)` remains separate source evidence.
- Re-uploading an identical workbook refreshes only untouched `REQUIRES_MANUAL_REVIEW` rows;
  corrected, ready, and approved rows are preserved.
- The real 214-row dated workbook dry run reports 214 date-prefilled rows and zero date-validation
  issues; package results remain 85 official, 72 Custom, and 57 classification conflicts.

After this patch is deployed, the owner should upload the exact same dated workbook again. The CP
will reuse the existing batch and report how many untouched rows were refreshed. Phase 3 remains
locked.

## Update — 2026-08-30 Admin batch deletion

Released to GitHub main as commit 2131bd7.

No migrations, no dependency changes, no schema changes. After `git pull` on the server: rebuild
both workspaces (`npm run build`) and restart the API process in Plesk. Nothing else required.

Changes:

- `DELETE /legacy-import/batches/:id` — Admin-only endpoint; refuses if any row is approved or
  live-linked to a customer/subscription; otherwise deletes all staging rows and the batch in one
  transaction and records a `legacy_import.batch_deleted` audit event.
- CRM UI — "Delete staged batch" button visible to Admin only, with a confirmation prompt. On
  success it clears the batch panel and refreshes the batch list. Error from the API (e.g. approved
  rows present) surfaces as an inline notice.
- Tests — deletion happy path, approved/live-linked guard, RBAC enforcement (Admin only), and UI
  contract assertions all added.

## Next owner action

The existing stuck import batch (dates still empty) needs to be deleted from the CRM:
Legacy Import → select the batch → "Delete staged batch" → confirm.
Then re-upload `dont_push_to_git/Project20report20Filled_With_Start_End_Dates.xlsx`.
The CP will create a fresh batch with `Start Date` and `End Date` prefilled from the workbook
columns. Package decisions and all other approval controls remain unchanged.

## Update — 2026-08-31 subscription currency conversion and customer contact channels

Owner requested three things in one message: (1) subscriptions billed in a currency other than JOD
must keep the original contract amount/currency untouched while showing an automatically calculated
JOD equivalent, with an admin-managed exchange-rate settings page; (2) confirm that adding another
service/subscription to an existing customer does not create a duplicate customer record; (3)
customers need multiple emails and multiple E.164-ready phone numbers, each with its own holder
name and department/type, ready for future messaging integrations.

This was implemented across two back-to-back sessions on the same day: a prior session built the
schema, migration, backend services, and UI; this session found and fixed real defects the prior
session left behind, added the missing test coverage, ran full verification, and pushed to GitHub
main. See `PROJECT_STATUS.md` → "Subscription currency conversion and customer contact channels"
for the full feature description; the short version:

- New `Currency` table (`1 X = Y JOD` direction, dated rate, active flag) with an Admin-only
  settings page at `/dashboard/currencies`. Subscription `sellingPrice`/`currency` are never
  overwritten by a rate change; a rate snapshot is taken at create/edit time
  (`exchange_rate_to_jod`, `selling_price_jod`, `exchange_rate_effective_date`), and every read also
  recomputes a live "current JOD equivalent" from the currency's latest rate.
- Confirmed one customer already supports many subscriptions; added a one-click "Add another
  subscription to this customer" link from the customer detail view.
- New `CustomerEmailAddress` / `CustomerPhoneNumber` tables: any number of channels per customer,
  each with holder name, department/type, optional label, and an exclusive primary flag. Phone
  numbers are DB- and DTO-validated as E.164. Existing single-value `Customer.primaryEmail` /
  `secondaryEmail` / `phone` fields stay in sync with whichever channel is marked primary.

Fixed during this session's pass: an audit-log bug where the exchange-rate direction metadata
literally recorded the text `"rateToJod"` instead of the real rate; a stray `?` character in the
subscription currency dropdown label; a missing country-calling-code validation on customer phone
_updates_ (creation already had it); two existing test suites that would have crashed because the
new currency lookup wasn't mocked; and no test coverage at all for the two new services/RBAC/parser
behavior. Full local verification (Prisma generate, strict typecheck, lint, Prettier, 135 tests
across 40 suites, both production builds) passes clean.

Known, intentional follow-up: legacy-import customer creation does not yet auto-populate the new
phone-channel table from the workbook's free-text phone column (only email is auto-seeded) — a
human adds the E.164 number afterward through the contact-channels panel, same as every other
ambiguous legacy value.

Environment note for whoever works on this repo next: this working copy lives on a cloud-synced
drive (`G:\Other computers\...`) that cannot run `npm install` — it does not support the symlinks or
sustained file writes npm's workspace install needs (confirmed `EISDIR`/`EPERM`/`TAR_ENTRY_ERROR`
failures). This is almost certainly why the prior session's `node_modules` ended up broken/partial.
This session verified by mirroring the repo (excluding `node_modules`/`.git`/`dont_push_to_git`)
into a local NTFS path and running `npm install`/verification there instead. For real day-to-day
development, move the project to a local disk rather than working around this each time.

Deployment note: this is a schema-changing release (`3cc765d` → `ad0dac9`). No `package.json` or
lockfile changes shipped, so `npm install` is not required. On the live server:

1. `git pull origin main`.
2. `cd apps/api && npm run db:generate` — regenerates the Prisma client for the new `Currency`,
   `CustomerEmailAddress`, and `CustomerPhoneNumber` models. The generated client is Git-ignored, so
   this must run after every pull that touches `schema.prisma`.
3. `npm run db:migrate:deploy` — applies `20260831000000_currency_and_contact_channels`. Additive
   and non-destructive: creates the new tables/columns, seeds `JOD` (rate 1, active), and backfills
   existing customers' legacy email/phone/contact values into the new channel tables without
   deleting or altering anything existing.
4. `cd ../.. && npm run build` — rebuilds both workspaces.
5. Restart the API, web, and renewal-worker Node processes in Plesk (all three share the rebuilt
   `dist/`/Prisma client).
6. Immediately after restart, before anyone edits a subscription priced outside JOD: log in as
   Admin → Currencies / Rates → set a real rate and effective date for every currency the live
   subscriptions actually use. The migration seeds every non-JOD currency already in use as
   **inactive with no rate configured**, so until an Admin sets one, those subscriptions show "rate
   unavailable" for their JOD equivalent, and the API refuses to create/edit a subscription priced
   in that currency. To find exactly which currencies need a rate, run against the live database:
   `SELECT DISTINCT currency FROM subscriptions WHERE currency <> 'JOD';`

## Update — 2026-08-31 legacy-import parser: combined "real price" column

The owner's real active-subscriptions workbook stores the original amount and currency together in
one free-text cell headed "real price" (e.g. `1250 SAR`, `875 JOD`), not as two separate columns.
`legacy-workbook.parser.ts` did not recognize that header at all, so uploading that workbook as-is
would have silently ignored the column and priced every one of the 214 rows in JOD from the legacy
`Price JD` column instead — 177 of the 214 rows are genuinely JOD, but 18 are USD, 17 are SAR, and 2
are EUR.

Fixed: the parser now also matches any header containing "real price" and parses a combined
`"<amount> <CCY>"` cell into the same `sellingPrice`/`currency` suggestion fields used by the
existing two-column and legacy Price JD/USD paths. It only falls back to this combined-cell format
when no dedicated amount/currency columns exist at all, so it cannot change behavior for any
workbook that already used the two-column format. Verified against the owner's real workbook
(structure/counts only, no customer data): all 214 rows now resolve a currency — 177 JOD, 18 USD, 17
SAR, 2 EUR — versus 214/214 JOD before the fix. Added a regression test
(`legacy-workbook.parser.spec.ts`) covering the `"1250 SAR"` shape. Full verification (typecheck,
lint, 136 tests / 40 suites, both production builds) passes.

Operational note for the next real import: `USD`, `SAR`, and `EUR` do not exist in the `currencies`
table yet (only `JOD` is seeded). Uploading and reviewing the workbook works regardless, but
approving a row priced in one of those currencies will be refused until an Admin adds that currency
with a real rate in Currencies / Rates first.

## Update — 2026-09-03 legacy-import "Approve" popup silently hid errors

The owner deployed the `20260831000000_currency_and_contact_channels` release, approved one
JOD-priced legacy row successfully (now a live active subscription), then hit a second row that
appeared to do nothing on Approve: the confirmation dialog closed, no error appeared, and the row
just reverted to `READY_FOR_APPROVAL` with no customer/subscription created.

Root cause was two separate things stacking:

1. **Expected backend refusal.** `approveRow()` looks up the subscription's currency and refuses to
   approve (`BadRequestException`) unless that currency is active with a configured rate. The
   owner's second row is priced in a non-JOD currency from the real workbook (see the update above)
   and, per that same update, `USD`/`SAR`/`EUR` are not yet configured on the live server. The whole
   approval runs in one transaction, so on failure everything rolls back cleanly, including the
   temporary status flip used to claim the row — which is exactly why the row lands back at
   `READY_FOR_APPROVAL` with nothing else changed.
2. **Real UI bug.** The row-inspector popup in `legacy-import-manager.tsx` is a full-screen
   `position: fixed` overlay (`zIndex: 50`) rendered _after_ the page's error/success banner in the
   DOM. Any error set while that popup is open — including this exact currency refusal — was being
   set correctly in state but rendered behind the popup's dark backdrop, so it was completely
   invisible. This affected every action available from inside that popup (Approve, and the earlier
   review/validate submit), not just the currency case.

Fixed: the error/success banner (`<Notice>`) now also renders inside the popup itself, so any
failure from an action taken there is immediately visible without closing the popup. Verified:
typecheck, lint, and the Next.js production build pass; this is a `web`-only change, no API/schema
change, no migration.

Immediate unblock for the owner (no deploy required): add the needed currency (likely `USD` or
`SAR`) in Currencies / Rates with a real rate, then re-open the stuck row and click Approve again.

## Update — 2026-09-06 Phase 2.2: canonical data & migration finalization

Full detail in `PHASES/PHASE_02_2_CANONICAL_DATA_MIGRATION.md` and the matching `PROJECT_STATUS.md`
section — this entry is a pointer, not a duplicate. The owner completed an external data-cleaning
pass over the 214-row legacy workbook and handed back an approved, pre-reviewed, multi-sheet
relational export (`CRM_Canonical_Import_v4_Approved_Phone_Corrections_2026-09-06.xlsx`). This
phase built what the application needed to safely consume that format: additive schema (customer/
subscription source ordering, phone/email contact linkage and decomposition, `currentTermEndDate`,
`paidLabel`), a standalone rule-based phone normalizer covering every documented pattern and all
five manually approved corrections (Sami Kashkol, the `079821889` removal, Khalil Hdaib, the
doubled-6 landline typo, Dr. Eyad Shahrouri), a new canonical-workbook importer reusing the
existing review/approve pipeline with idempotent customer resolution across a customer's multiple
subscription rows, and legacy-import UI fixes (currency dropdown, searchable customer selector,
read-only multi-channel display).

Also fixed during this pass: the first draft of the canonical importer fed the reused package-
classification engine a synthetic row with no date/interval fields, which made it falsely flag
every single row as missing dates and needing interval confirmation regardless of real data
quality — caught by a structural dry run against the real approved workbook (no live database
available in this environment), fixed, and locked in with a regression test.

Verified: typecheck, lint, both production builds, and 161 tests / 42 suites pass. The dry run
reproduced the workbook's own counts exactly (124 customers, 214 subscriptions, 374 phones, 205
emails, 275 identifiers) and the historical classification baseline exactly (85 `MATCHED_OFFICIAL`
/ 72 `CUSTOM` / 57 `MANUAL_REVIEW`) — meaning 85 rows land at `READY_FOR_APPROVAL` on upload and
129 need the same package-classification decisions Phase 2.1 already identified. Not yet run
against a live database, and not yet deployed.

## Update — 2026-09-06 canonical-import billingFrequency fix

The owner deployed Phase 2.2, then hit a live error while editing a subscription: `billingFrequency
must be one of the following values: MONTHLY, QUARTERLY, SEMI_ANNUAL, ANNUAL, BIENNIAL, CUSTOM`,
with "there is no option i can edit." Root cause: `createCanonicalBatch()` set `billingFrequency:
suggestions.billingFrequency`, which is always `undefined` for canonical rows because the package
classifier never receives frequency free text for them — and since clean rows route straight to
`READY_FOR_APPROVAL`, bypassing the only screen with an editable form, there was no way to fix it
in the UI at all once the row was created. Fixed by exporting `intervalToFrequency` from
`legacy-workbook.parser.ts` and deriving `billingFrequency` directly from
`renewalIntervalMonths` instead of the classifier's suggestion. Verified against all 214 real
workbook rows: 166 `CUSTOM`, 45 `ANNUAL`, 3 `BIENNIAL`, zero undefined. Commit `80591fb`. No schema
change; `npm run build` plus a restart is sufficient.

## Update — 2026-09-06 phone types, contact-channel editing, and bulk customer delete

The owner asked in one message: why can't customers with several phone numbers be marked
Mobile/Landline/Fax; why can't an existing email/phone be edited or deactivated instead of only
adding new ones; why does customer search seem unavailable; and why is there no way to bulk-delete
approved customers. Customer search turned out to already work (the customers list already queries
company name, code, email, and phone) — nothing to fix there. The rest were real gaps:

- `phoneType` had been added to the schema in Phase 2.2 but was never exposed on
  `CreateCustomerPhoneNumberDto` / `UpdateCustomerPhoneNumberDto`, so a number could never be
  marked as Fax through the UI. Both DTOs now expose `phoneType`.
- The contact-channels panel only supported adding new emails/phones. It now has a Type selector
  plus Edit/Deactivate/Reactivate actions per channel.
- Added an Admin-only multi-select bulk-delete to the customers list (checkboxes + "Delete N
  selected"). The owner was asked whether this should be import-cleanup-specific or general-purpose
  and chose general-purpose, so it sits alongside the existing per-row delete for ordinary
  housekeeping too.

Commit `5381563`. No schema/migration change; `npm run build` plus a restart is sufficient.

## Update — 2026-09-06 dashboard UI/UX overhaul: modal edit forms, dedicated customer page, collapsible sidebar

The owner asked for a systemic UX change, verbatim: edit screens must open as a popup instead of
appearing inline at the end of the current page; clicking a customer must show a dedicated page for
only that customer instead of an inline panel below the still-visible customer list; the main
navigation sidebar needs a collapse/expand arrow to reclaim screen width; and the Legacy Import
staged-rows table needed to stop requiring horizontal scrolling to read a row's data, "maybe you
can make it in a new full screen."

Built a shared `Modal` popup component (`apps/web/components/modal.tsx`) and converted every
manager's create/edit form to it: Currencies, Billing Entities, Service Types, Package Catalog,
Technical Connections, Subscriptions, and Customers. Customer detail moved to a new dedicated
`/dashboard/customers/[id]` route (`customer-detail.tsx`). The main sidebar and the Legacy Import
batch-list panel each gained a collapse/expand arrow toggle (persisted in `localStorage`), and the
staged-rows table gained Start/renewal-date and price columns so a row's key data is visible
without opening the inspector. Commit `895fa79`.

The owner then reported edit screens were still inline in places, and that hiding the Legacy Import
batch list collapsed the remaining content to a tiny width. The first report was real:
`customer-channels-manager.tsx` (the customer detail page's email/phone contact forms) predated the
Modal conversion above and had been missed — its add/edit forms, plus the "add legacy contact"
form, were still rendered inline. All three converted to the same Modal pattern. The second report
led to a genuine CSS bug (see below) plus a hardening fix: the Legacy Import batch-list grid was
switched from a display:none-based hide to conditionally unmounting the panel, with an explicit
`grid-cols-1` base so sub-`xl` viewports get a real `1fr` track instead of the implicit
shrink-to-fit default. Commit `9366a5c`.

## Update — 2026-09-06 collapsed-sidebar layout bug and selected-batch-lost-on-refresh bug

The owner then reported, with unusual precision, that collapsing the sidebar caused: a narrow
column on the left, page titles wrapping word-by-word, overlapping text, collapsed stat cards, and
staged-rows tables only a few pixels wide — most visible on Legacy Import — and explicitly noted
"after previous fixes, some outer containers became wide but child elements still remain collapsed
or overlap." That last detail was the key clue.

**Root cause**, found by static CSS/Grid-spec reasoning (no browser/build tooling was available —
see below): the collapsible shell used CSS Grid with an explicit two-track `gridTemplateColumns`
(`'0px 1fr'` when collapsed). Per the CSS Grid spec, `display:none` and `position:fixed` elements
are excluded from grid item placement entirely. Once the sidebar (`display:none`) and the floating
collapse button (`position:fixed`) were both excluded, `<main>` became the *first* auto-placed grid
item and was placed into the sidebar's now-empty `0px` track instead of the `1fr` track — even
though the grid container itself still correctly reported two tracks (exactly matching "outer
containers became wide but children remain collapsed"). This squeezed all page content into a
near-zero-width column, producing every symptom reported.

**Fix:** switched the app shell (`app-shell.tsx`) from CSS Grid to Flexbox. The sidebar is now
conditionally rendered (unmounted, not `display:none`) with a fixed `flex-basis`
(`lg:w-[270px] lg:flex-none`), and `<main>` is `flex-1 min-w-0`, so it always absorbs 100% of the
freed space regardless of how many siblings exist or are hidden — flexbox has no equivalent
placement ambiguity. Applied the identical fix to the Legacy Import batch-list panel. Commit
`5270fb0`.

Separately, the owner asked why an uploaded Legacy Import file "disappears" on page refresh.
`selectedBatch`/`rows` were pure in-memory React state with nothing restoring them on mount, so a
refresh reset the detail view to "Select an import batch" even though the file was still present in
the reloaded batch list. Fixed by persisting the selected batch id in the URL (`?batchId=`) and
restoring it once the batch list loads, matching the `?edit=`/`?customerId=` convention already
used elsewhere in the app. Commit `6869b13`.

**Process note for whoever works on this next:** for the two commits above, the owner explicitly
required *no* local `npm run build`/`test`/`lint`/`typecheck`, no dev server, and no browser/E2E
testing, because of the cloud-synced-drive constraint (see the 2026-08-31 environment note above) —
fixes were made and reviewed by static code/diff inspection only. This is a deliberate deviation
from this project's normal full-verification standard for every other change in this file; treat
these two commits as code-reviewed but **not locally verified**, and prioritize testing them for
real once deployed.

No schema or migration changes across any of the four updates above. All are on `main`; none have
been deployed or tested by the owner yet. Deploy with `git pull`, `npm ci`, `npm run db:generate`,
`npm run build`, then restart the API/web/worker processes — no `db:migrate:deploy` needed for this
batch.

## Update — 2026-09-06 Legacy Import batch-list redesign

The owner reported the "Import batches" list looked ugly: a long, mostly-empty column with one
filename, sitting beside and visually squeezing the detail columns next to it — exactly the old
two-column sidebar-style layout from the earlier UX overhaul. Asked for it as a single row of
batches instead, with the selected batch's real data showing beneath it once clicked.

Replaced the two-column grid (`batch list | batch detail`) with a single "Import batches" panel
where batch cards wrap left-to-right in a row (`flex flex-wrap`, each card `flex: 1 1 240px` with a
320px max width instead of the old fixed-width vertical stack), followed by the selected batch's
detail/staged-rows table stacked full-width beneath it. Also removed the batch-list collapse/hide
toggle (state, `localStorage` key, and buttons) added in the previous UX-overhaul pass: it only
existed to reclaim width from the old side-by-side grid, which no longer exists in this
single-column layout, so keeping it would have been dead code. Commit `b2d4761`.

No schema/migration change; `npm run build` plus a restart is sufficient. Reviewed by static code
inspection only (same drive-mounted-workspace constraint as the previous two updates); not yet
deployed or tested by the owner.

## Update — 2026-09-06 Import batches card sizing

The batch-list redesign above (`b2d4761`) had left `.batch-card` with `max-width: 320px` and
`flex: 1 1 240px` in `globals.css`. The owner reported a long filename
(`CRM_Canonical_Import_v4_Approved_Phone_Corrections_2026-09-06.xlsx`) wrapping into two lines
despite plenty of free horizontal space, and asked specifically for the actual width constraint to
be found and removed rather than patched around. `max-width: 320px` was exactly that constraint;
`flex: 1 1 240px` was a second, related problem — it stretches every card to fill its row evenly
regardless of its own content length, which also fights "short filename → compact card, long
filename → wide card."

Fixed: `.batch-card` is now `flex: 0 1 auto` with `width: max-content; max-width: 100%`, so each
card sizes to its own filename's natural width and only wraps once it genuinely hits the
container's edge, plus `overflow-wrap: anywhere` on the filename `<strong>` as a fallback for names
with no natural break points. The parent chain (`section.panel` → `div.flex.flex-wrap` →
`button.batch-card`) has no other width/max-width/basis constraint. Commit `94d08c3`.

No schema/migration change; `npm run build` plus a restart is sufficient. Reviewed by static code
inspection only (same drive-mounted-workspace constraint); not yet deployed or tested by the owner.

## Update — 2026-09-06 cropped sidebar collapse toggle button

The owner reported the circular sidebar collapse toggle was partially cropped, overlapping the
sidebar's own scrollbar/overflow area. Root cause, found in `app-shell.tsx`: the button was a
child of `<aside>`, and `<aside>` itself carried `lg:overflow-y-auto` for its scrollable nav
content. Per the CSS overflow spec, setting `overflow-y` to anything other than `visible` computes
`overflow-x` to `auto` too (when it would otherwise be `visible`) — so the aside was clipping in
both axes, cropping the button, which was absolutely positioned half outside the aside's right edge
(`right: -14px`) to sit on the border.

Fixed by moving `overflow-y-auto` off `<aside>` onto a new inner wrapper `<div>` that now holds only
the scrollable nav content; `<aside>` stays `relative` with no overflow set, so the button (still a
direct child of `<aside>`, not inside the scrollable wrapper) can render outside its bounds without
being clipped. Also bumped both the collapse and expand buttons from 28px to 32px with the offset
adjusted to `-16px` (exactly half the button width sits outside the edge), added a subtle box
shadow, and raised `zIndex` from 10 to 50, matching the owner's requested visual spec. No change to
page widths, the dashboard grid, or sidebar scroll behavior otherwise. Commit `d106e33`.

No schema/migration change; `npm run build` plus a restart is sufficient. Reviewed by static code
inspection only (same drive-mounted-workspace constraint); not yet deployed or tested by the owner.

## Update — 2026-09-06 sidebar toggle redesigned as two in-flow buttons

The owner asked to stop positioning the toggle on the sidebar edge/scrollbar entirely (the fix
above reduced the crop but the owner wanted a structurally different, more robust approach) and
gave a specific two-state design instead:

- **Expanded**: the collapse button now lives inside the sidebar's own header, in normal flex flow
  beside the "Control Panel" heading (`flex items-center justify-between`) — no absolute
  positioning, nowhere near the scrollable nav container.
- **Collapsed**: a small expand button sits inside `<main>` (now `relative`), absolutely positioned
  in a left gutter reserved by widening `<main>`'s left padding to `lg:pl-16` only while collapsed
  (`lg:pl-9` otherwise, matching the original `lg:p-9` left value) — guaranteed not to overlap any
  page's heading text, since every page's content now starts to the right of that reserved gutter
  instead of at the same x-coordinate as a floating button.

Sidebar width, the dashboard flex layout (from the earlier CSS-Grid-to-Flexbox fix), and sidebar
scroll behavior are all unchanged. Commit `eecee31`.

No schema/migration change; `npm run build` plus a restart is sufficient. Reviewed by static code
inspection only (same drive-mounted-workspace constraint); not yet deployed or tested by the owner.

## Update — 2026-09-08 subscription deep-linking, fixed sidebar toggle, customer combobox

Owner requested three specific UI/UX improvements in one detailed message, each with explicit
acceptance criteria and edge cases to check. This session had normal build/test/lint access (no
drive-mounted-workspace restriction this time), so all three were fully verified via the local
mirror, not just statically reviewed. Commit `7f4c21f`.

1. **Clickable customer subscriptions.** `customer-detail.tsx`'s subscription rows (previously
   plain `<div>`s) are now `Link`s to `/dashboard/subscriptions?edit=<subscriptionId>`.
   `subscriptions-manager.tsx` reads that `edit` query param on mount, fetches the subscription by
   its real ID, and opens the existing View/Manage modal automatically — no manual search required.
   An invalid or deleted ID surfaces as a `Notice` error instead of crashing. The existing
   `?customerId=` create-flow and normal navigation to `/dashboard/subscriptions` are unaffected
   (separate query param, separate effect).
2. **Viewport-fixed sidebar toggle.** The owner explicitly asked to stop relying on in-flow/
   absolute positioning (which the two prior fixes used) and make the toggle
   `position: fixed` relative to the browser viewport in both states, so it survives page scroll.
   Both buttons (collapse and expand) are now top-level `position: fixed` siblings of `<aside>`/
   `<main>` at `top: 1.25rem`, `left: 254` (sidebar edge) or `left: 10` (collapsed). `collapsed`
   state, `toggleCollapsed`, and its `localStorage` persistence are untouched. `<main>`'s
   conditional left padding (`lg:pl-16` only while collapsed, from the previous fix) is kept as-is
   since it still reserves the gutter the fixed expand button needs to avoid overlapping content.
3. **Merged Legacy Import customer combobox.** New `apps/web/components/customer-combobox.tsx`
   (`CustomerCombobox`) replaces the separate "Search existing customers" input +
   "Existing customer" `<select>` under Attach existing customer with one control: focusing shows
   the current result set (browsable), typing re-triggers the *existing* debounced server-side
   `/customers` search unchanged (now also tracked with a loading state and wrapped in error
   handling it previously lacked), and each result row shows `code · company name` plus email on a
   second line to distinguish similar names. Selecting sets `candidateCustomerId` exactly as
   before. Native `required` on the old `<select>` doesn't carry over cleanly to a free-text input,
   so `review()` now explicitly validates `candidateCustomerId` is set before submitting when
   `resolution === 'ATTACH_EXISTING'`. `inspect(row)` now also resets the search box and
   best-effort resolves a label for any already-set `candidateCustomerId` from the row's
   `duplicateCandidates`, so reopening a row or switching resolutions doesn't leave a stale label
   next to a different underlying selection — the edge case the owner specifically flagged.

Verified: Prisma generate, strict typecheck, lint (including `jsx-a11y` combobox/listbox role
requirements — fixed one warning by adding `aria-controls`/`role="listbox"`/`role="option"`), 161
tests / 42 suites, and both production builds all pass. No schema/migration change. Not yet
deployed or tested by the owner.

## Update — 2026-09-08 fixed a 500 error on every text search in the app

The owner tested the new combobox and reported the filter "not working" plus a browser console
error. The console error (`Cannot assign to read only property 'open' of object '#<Window>'... at
blockPopupsFunc`) is a third-party browser-extension popup blocker, unrelated to this app — told
the owner to disregard it. The real bug: typing a search term returned "internal server error."

**Root cause**, affecting far more than the combobox: every text search across the app —
Customers, Subscriptions, Renewal Cases, Communication Outbox, and the Legacy Import row search —
used Prisma's `mode: 'insensitive'` filter on `contains`. That option is valid only for the
Postgres/MongoDB connectors. Against this app's `mysql` (MariaDB) datasource, Prisma Client throws
a `PrismaClientValidationError` ("Unknown argument `mode`") the instant a search term is present,
which surfaces as an unhandled 500. TypeScript never caught this at compile time because `where` is
assembled as a loose local object (not assigned directly into a typed parameter position), so
TypeScript's excess-property check never inspected the inner `mode` field. Unit tests didn't catch
it either — they mock Prisma rather than hitting real MariaDB, and the live-MariaDB test suites are
skipped by default in every session (see the 2026-08-31 environment note). This bug had almost
certainly been present since Phase 0/1 — the just-added combobox's new `.catch()` on the search
request is what finally surfaced it; the old separate search input had no error handling at all, so
the exact same request was already silently failing there, just presenting as "the filter does
nothing" instead of an explicit error.

**Fix**: removed `mode: 'insensitive'` from all 16 occurrences across 5 service files
(`customers.service.ts`, `subscriptions.service.ts`, `legacy-import.service.ts`,
`communication-outbox.service.ts`, `renewal-cases.service.ts`). Every affected column lives in a
`utf8mb4_unicode_ci` table (per the Phase 0/1 migration's `COLLATE` clause), and that collation is
already case-insensitive, so a plain `contains` behaves identically to what `mode: 'insensitive'`
would have done on Postgres — this is a pure bug fix, not a behavior change. Commit `86c4ef7`.

Verified: Prisma generate, strict typecheck, lint, 161 tests / 42 suites, and both production
builds all pass. No schema/migration change; `npm run build` plus a restart is sufficient. This is
almost certainly the single highest-impact fix in this whole UI/UX session — **every text search
box in the live app has likely been silently broken** until now. Recommend the owner specifically
retest search on the Customers list, Subscriptions list, and Renewal Cases/Communication Outbox
screens after deploying, not just the Legacy Import combobox that surfaced it.

## Update — 2026-09-08 subscription popup on the customer page, and code/name display

The owner asked two things: why subscription "codes" show as `LEG-S-<16 hex chars>`, and why
clicking a subscription from the customer detail page navigates away to
`/dashboard/subscriptions` instead of staying on the customer page.

**The code question** has a real answer, not a bug: `generatedCode()` in
`legacy-import.service.ts` deterministically hashes the source row reference (SHA-256, truncated)
to produce that identifier for every legacy/canonical-imported subscription, specifically so
re-uploading the same workbook is idempotent (same row → same code → no duplicate). It was never
meant to be the primary human-facing label — the real fix was a display one: the Subscriptions
table and the customer detail subscription list both showed the generated code as the prominent
text and the descriptive `name` as the muted secondary line, which is backwards from what's useful.
Swapped the emphasis in both places so `name` leads and `subscriptionCode` is shown small/secondary
underneath.

**The navigation question** was a real, valid UX complaint from the prior session's own work: the
`?edit=<subscriptionId>` deep-link (added two updates ago) opens the Subscriptions page's modal,
but landing on a whole different page just to view one subscription meant a full page navigation
(and a "back" click) to see a different one. Fixed properly rather than patched: extracted the
entire "create/view/manage subscription" modal — form, technical-mappings list, add-mapping form,
and all its fetch/save logic — out of `subscriptions-manager.tsx` into a new shared
`apps/web/components/subscription-modal.tsx` (`SubscriptionModal`). It takes a `subscriptionId`
(`null` means create mode) plus `onClose`/`onSaved` callbacks and owns its own data fetching
(customers/service types/packages/currencies/technical connections, plus the subscription itself
when an id is given), so any page can render it without navigating anywhere.

`customer-detail.tsx`'s subscription list items and its "Add another subscription to this
customer" link now open this same modal in place (local `subscriptionModalOpen`/`subscriptionModalId`
state) instead of linking away — clicking through several of a customer's subscriptions in a row no
longer requires repeated back-navigation. `subscriptions-manager.tsx` itself shrank substantially
(it now owns only the list/search/filter and renders `<SubscriptionModal>` for its own
create/edit button); its `?customerId=`/`?edit=` deep-link support for direct navigation to that
page is unchanged and still works exactly as before. Commit `2540803`.

Verified via the local mirror: strict typecheck, lint (including one more instance of the
`react-hooks/set-state-in-effect` heuristic on a loading-flag effect, fixed the same way as the
earlier app-shell.tsx case — a targeted `eslint-disable-next-line` with a comment explaining why the
synchronous `setLoading(true)` is necessary there), 161 tests / 42 suites, and both production
builds all pass. No schema/migration change. Not yet deployed or tested by the owner.

## Update — 2026-09-08 hid the generated subscription code from list screens entirely

The owner followed up on the code/name display fix above: the generated `LEG-S-<hash>` code still
looked ugly even de-emphasized, and they wanted it gone from every list/search screen, visible only
when actually opening a specific subscription. Removed it entirely from the Subscriptions table
(renamed the `Code / name` column header to just `Name`) and the customer detail page's
subscription list — both now show only the descriptive name. Inside `SubscriptionModal` itself, the
generated code moved out of the prominent modal title (`Edit LEG-S-...`) and the "Technical
mappings for ..." heading — both now use the subscription's `name` — down to a small muted
`Code: ...` reference line under the title, still available when actually looking at that one
subscription's record but no longer the star of any screen. Commit `07c14a9`.

No backend change (this is a display-only change to already-fetched data, not a search/filter
change — `subscriptionCode` remains a legitimate, unexposed server-side search field). Verified:
strict typecheck, lint, both production builds. Not yet deployed or tested by the owner.

## Update — 2026-09-08 the same generated code was also on the Customers list

After deploying, the owner reported the code was "still there" — pasting a screenshot of the
**Customers** list, not Subscriptions. This was a genuinely different, untouched screen: customers
get their own analogous generated code (`LEG-C-<hash>`, same `generatedCode()` mechanism, just a
different prefix) shown in its own "Code" column, which the earlier fix never touched. Removed that
column entirely from `customers-manager.tsx` (company name is already its own clearly-labeled
column) and switched the edit modal's title from the code to the company name, with the code kept
as a small muted reference line under the title — identical treatment to the subscription modal.
The customer detail page's heading still shows the code, which stays consistent with the owner's
own framing that the code is fine "inside a customer data when i click on it," just not on list
screens. Commit `5f2baa7`. No backend change. Verified: strict typecheck, lint, web production
build.

Also worth recording: the owner separately hit `npm ci` failing on the server with hundreds of
"tarball data ... seems to be corrupted" warnings and a final `ENOENT` on a specific npm cache file
under `/var/www/vhosts/nusrv.com/.npm/_cacache/...`. This is an npm local-cache corruption issue on
the server, unrelated to any code in this repo. Recommended fix given to the owner: delete the
cache directory directly (`rm -rf /var/www/vhosts/nusrv.com/.npm/_cacache`) rather than
`npm cache clean --force` (which the owner reported didn't work as expected), then retry `npm ci`.
If it recurs, check server disk space (`df -h`). Not yet confirmed resolved.

## Update — 2026-09-08 the generated code was also in the Legacy Import combobox

The owner then asked directly whether they'd already asked for the code to be hidden from "the
existing customer list in legacy import" too. They effectively had: "I don't want it in search
boxes" reasonably covers the `CustomerCombobox` built two updates ago for Legacy Import's "Attach
existing customer" flow, which still showed `customerCode` as the bolded leading text for every
dropdown result and reused it as the label left in the input after selecting a customer. Fixed:
`optionLabel()` and the dropdown row now use `companyName` only; `primaryEmail` remains as the
secondary line for telling apart similarly-named customers (the original reason the code was shown
there at all). Commit `4ab9873`. No backend change. Verified: strict typecheck, lint, web
production build.

## Update — 2026-09-08 customer phone validation, and errors hidden behind every edit popup

The owner couldn't create a new customer: "phone must match /^\+[1-9]\d{7,14}$/ regular expression"
and — separately — the error wasn't visible on the Create Customer popup at all, only on the
Customers list page behind it.

**Root cause 1 (real validation bug).** `CreateCustomerDto`/`UpdateCustomerDto`'s `phone` and
`phoneCountryCallingCode` fields had no normalization `@Transform` before their strict E.164/
calling-code regex checks — unlike the newer `CustomerPhoneNumber` DTOs (added in the earlier
contact-channels work), which already strip spaces, dashes, and parentheses first. Typing a phone
with any ordinary formatting (e.g. `+962 79 000 0000`, very natural to type) failed validation even
though the number itself was valid. Added the same `.replace(/[\s()-]/g, '')` transform used
elsewhere, to both DTOs, both fields.

**Root cause 2 (the exact bug already fixed once, but not everywhere).** The validation error - and
every error/success message set while any `Modal`-based edit form is open - rendered at the page
level, behind the Modal's opaque backdrop, invisible. This is the identical bug already fixed for
the Legacy Import row-inspector popup back in the 2026-09-03 update, and it was accounted for from
the start when `SubscriptionModal` was built two updates ago — but it was never applied to the
other 8 `Modal` conversions from the original UI/UX overhaul: Customers, Currencies, Billing
Entities, Service Types, Package Catalog, Technical Connections, the customer detail page's "Add
contact" popup, and both contact-channel (email/phone) popups. All eight now also render their
page's `<Notice>` components inside the `Modal` itself, matching the established pattern.

Commit `3a880fe`. Verified via the local mirror: Prisma generate, strict typecheck, lint, 161 tests
/ 42 suites (unaffected by the phone transform), and both production builds all pass. Not yet
deployed or tested by the owner.

**Note for future sessions**: whenever a new `Modal`-based form is added anywhere in this app, its
page-level error/success `<Notice>` components must also be duplicated inside the `Modal` itself -
the Modal is a full-screen overlay and will otherwise silently hide them. This has now been missed
twice; check for it explicitly when reviewing any new Modal usage.
