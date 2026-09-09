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

## Update — 2026-09-08 the duplicated Notice was still leaking onto the page behind the modal

The owner tested the previous fix and reported the error "still appear behind the popup screen, in
the customer main page." The previous fix (commit `3a880fe`) only *added* a `<Notice>` inside each
`Modal` — it never removed or hid the original page-level copy, so the message rendered in both
places at once, and the page-level copy kept showing (visibly, once the modal closed) because
nothing ever cleared `error`/`message` state on close. Fixed properly this time: each page-level
`<Notice>` pair is now gated behind its own "no modal is open" condition, e.g.
`{!formOpen && (<><Notice .../><Notice .../></>)}`, across the same 9 files from the previous fix
(`customers-manager.tsx`, `currencies-manager.tsx`, `billing-entities-manager.tsx`,
`service-types-manager.tsx`, `service-packages-manager.tsx`, `technical-connections-manager.tsx`,
`customer-detail.tsx` gated on `contactFormOpen`, `customer-channels-manager.tsx` gated on
`emailFormOpen && phoneFormOpen`, and `legacy-import-manager.tsx` gated on `editing`). The Notice
inside each Modal is unchanged and remains the only copy visible while that modal is open.
`subscriptions-manager.tsx`/`subscription-modal.tsx` were confirmed to already use fully
independent error/message state and needed no change. Commit `acdb80c`.

Verified via the local mirror: strict typecheck, lint, 161 tests / 42 suites, and both production
builds all pass. Prettier was run on all 9 files; only `legacy-import-manager.tsx` reported a diff,
but it was a full-file reformat driven by that file's known pre-existing formatting debt (see the
"never blanket-format legacy-import-manager.tsx" note from the 2026-09-03 update) — discarded, and
the surgical `git diff` was verified by hand to contain only the intended gating change in all 9
files. Not yet deployed or tested by the owner.

**Note for future sessions**: the fix for "Notice hidden behind Modal" is two-part, not one — (1)
render the Notice inside the Modal, AND (2) hide the page-level Notice while that Modal is open.
Only doing (1) still leaves stale/duplicate messages on the page behind the modal, as happened here.

## Update — 2026-09-08 the phone validation error itself was still not actually fixed

The owner correctly pushed back after the previous update ("didn't you fix the phone number
issue!!!!!!") — the earlier `3a880fe` fix only stripped stray whitespace/dashes/parens from an
already-complete E.164 string. It never addressed the real defect: the Create/Edit Customer form
has two separate inputs — "Phone" and "Phone country calling code" — and a normal person fills them
the way the owner did (`0799442940` / `+962`), but the backend DTO validates `phone` alone against
`E164_PHONE` (`/^\+[1-9]\d{7,14}$/`), which a bare local number without a leading `+` can never
match. The two fields were never being combined anywhere.

Fixed properly this time: `customers-manager.tsx` now composes the full E.164 number from the two
fields before sending (`composePhone()` — strips formatting, and if the "Phone" value doesn't
already start with `+`, prepends the calling code and drops a leading trunk `0` from the local
part). Left an already-complete `+...` value in "Phone" untouched, in case anyone pastes one
directly. Also relabeled/placeholder'd both fields ("Phone (local number)" / "e.g. 0799442940" and
"e.g. +962") so the split is no longer ambiguous.

While tracing this, found and fixed a second, related defect in `customers.service.ts`: `update()`
enforced "phone must start with its calling code" unconditionally on every PATCH, even when `phone`
in the payload was just the unchanged value from the edit form's own defaults and the calling-code
field (never persisted, only ever a write-time consistency check) was left blank — meaning editing
*any other field* on a customer who already had a phone number on file would fail unless the owner
re-typed the calling code every single time. Now only re-checks when `input.phone !==
oldState.phone`.

Commit `78dfedd`. Verified via the local mirror: strict typecheck, lint, 161 tests / 42 suites
(customers.service tests still pass unchanged — no test covered this update-unless-changed edge
case explicitly, worth adding if this area gets touched again), both production builds, Prettier
(no reformatting needed on either touched file). Not yet deployed or tested by the owner — this is
the fix to retest for the exact repro from the last update: create a customer with Phone
`0799442940` and calling code `+962`.

## Update — 2026-09-08 a *third*, different customer-create error: "A record with this identifier exists."

The owner retested (rightly frustrated: "what is the meaning of this!!!!!!!!! i didn't add anything
before this is my first try") and hit a new, generic conflict error on their very first create
attempt. Root cause: they had typed the same address into both Primary email and Secondary email
(`jarrar.film@gmail.com` in both). `CustomersService.create()` inserts `primaryEmail` and
`secondaryEmail` as two separate `CustomerEmailAddress` rows for the new customer, and that table
has a unique constraint on `(customerId, email)` — two rows with the same brand-new `customerId`
and the same email address collide with each other on first insert, no prior data involved at all.
The generic `throwMappedPrismaError()` mapper (`apps/api/src/common/prisma-errors.ts`) turns *any*
P2002 unique-constraint violation into the same flat "A record with this identifier exists."
message regardless of which field or constraint actually collided, which is why it looked like
nonsense: the owner hadn't created anything to conflict with — they'd just entered the same email
twice, and the system gave no clue which field or why.

Fixed by validating this case explicitly before any DB write is attempted:
```
if (input.secondaryEmail && input.secondaryEmail === input.primaryEmail) {
  throw new BadRequestException('Secondary email must be different from the primary email.');
}
```
in `customers.service.ts` `create()`, right next to the existing phone-country-code check. Confirmed
the Legacy Import approval path (`legacy-import.service.ts` around line 976) does not have this bug
— it builds its email rows via a `Map` keyed by address, which naturally dedupes an identical
primary/secondary pair instead of inserting both. `update()` was also checked and does not touch the
`emailAddresses` relation at all, so it has no equivalent crash risk to fix.

Commit `d1419f3`. Verified via the local mirror: strict typecheck, lint, 161 tests / 42 suites, API
production build, Prettier (unchanged). Not yet deployed or tested by the owner.

**Note for future sessions**: `throwMappedPrismaError()` is still a blunt instrument — it maps
every P2002 across every service to the exact same generic message with no field/constraint
context. This will keep producing confusing reports like this one for any other duplicate-key
scenario across the app (billing entities, service types, currencies, technical connections,
subscriptions, etc.) until someone either enriches that mapper with the Prisma error's constraint
target or each call site adds its own pre-check the way this fix did. Flagging rather than fixing
now to stay scoped to the reported bug.

## Update — 2026-09-08 major feature: Billing-Entity customer codes, bilingual names, deactivation cascade

The owner sent a large, explicit 26-section spec covering customer deactivation, Customer Code
generation, bilingual (English/Arabic) customer names, and Legacy Import consistency. Implemented
in full; commit `647461a`. This is the biggest single change of the session — read the commit
message for the complete breakdown; summarized here:

**Customer deactivation suspends subscriptions.** `CustomersService.update()` now suspends every
ACTIVE subscription (`SUSPENDED`) in the same transaction whenever `status` transitions to
`INACTIVE` — whether via the dedicated `/deactivate` endpoint or a direct edit-form status change,
since `deactivate()` just calls `update()`. Reactivation deliberately does **not** touch
subscriptions (manual reactivation only — an already-suspended-for-another-reason subscription must
not be silently reactivated). Confirmed `renewal-engine.service.ts`'s `evaluateAll()` already
filters `status: ACTIVE` AND `customer.status: ACTIVE` server-side, so reminder exclusion needed no
code change — just new regression-test coverage locking that behavior in.

**Customer Codes are now system-generated, `FFxxxx`/`NSxxxx`, per-Billing-Entity.** New
`CustomerCodeSequence` model (one row per Billing Entity, monotonic, never reused after delete) and
`CustomerCodeService.next()` — the single authoritative generator, used by both manual creation and
Legacy Import approval (no separate numbering paths). Concurrency-safe: `next()` runs inside the
caller's transaction; the row-level lock from the `UPDATE` on that entity's sequence row serializes
concurrent creates under the *same* entity while different entities proceed in parallel.
`BillingEntity` gained a required, unique, immutable-after-creation `customerCodePrefix`.
`customerCode` was removed entirely from `CreateCustomerDto` (server-generated) — it was already
absent from `UpdateCustomerDto` (immutable). Legacy Import's `ATTACH_EXISTING` path is untouched: no
code is ever generated when attaching to an existing customer, only for `CREATE_NEW`.

**Bilingual names.** `Customer.companyName` is replaced by nullable `nameEn`/`nameAr`. "At least one
required" is enforced in the service layer (not a DB `CHECK`, to match this codebase's established
pattern of cross-field validation in services — see the phone/calling-code and duplicate-email
checks from two updates ago). Legacy Import classifies the single source name column via new
`name-language.util.ts` (Arabic-script Unicode-range detection — classification, not translation),
applied when staging both the flat legacy workbook and the canonical workbook. Duplicate detection
now compares both name fields **and is scoped to the row's own Billing Entity** — per the owner's
explicit business rule, the same company legitimately has one customer record per Billing Entity, so
a name match across different entities is no longer even considered a duplicate candidate. Every UI
surface that showed `companyName` (customers list/detail/forms, the customer combobox, subscription
forms/lists, renewal cases/communication outbox, Legacy Import's review form and duplicate-candidate
list) now shows `nameEn`/`nameAr` through two new shared display helpers —
`apps/web/lib/customer-name.ts` (frontend) and `apps/api/.../customers/customer-name.util.ts`
(backend, used in the renewal reminder template's `customerCompany` merge tag).

**Schema/migration**: `20260908000000_customer_code_sequences_and_bilingual_names`. `customers`:
drops `company_name` (its value is copied into `name_en` first, unconditionally, as a safety-net
fallback — not a language-aware migration, since the owner is deleting and re-importing all
customers after this ships anyway), adds `name_en`/`name_ar` + indexes. `billing_entities`: adds
required unique `customer_code_prefix`, backfilled `FF`/`NS` for the two existing entities by
`code`. New `customer_code_sequences` table, seeded at 0 for every existing entity. No renumbering
of existing `LEG-C-*`/`LEG-S-*` codes was built, per the owner's explicit instruction not to.

**Verification**: `prisma validate` + `db:generate`, strict typecheck, lint (found and fixed one
`no-irregular-whitespace` hit — the Arabic-script regex's upper bound accidentally included U+FEFF,
the zero-width-no-break-space/BOM character, which isn't a real Arabic letter anyway; narrowed the
range by one codepoint), 174 tests / 44 suites passing (new: `customer-code.service.spec.ts`,
`name-language.util.spec.ts`, a deactivation-cascade suite in `customers.service.spec.ts`; updated
fixtures/mocks in `customers.service.spec.ts` and `legacy-import.service.spec.ts` for the new
`CustomerCodeService` constructor dependency), both production builds. The three live-DB-gated specs
(`mariadb-*-live.spec.ts`, skipped without `MARIADB_TEST_DATABASE_URL`) were updated for
type-correctness only (they still construct their test schema from only the very first
`20260823000000` migration, a pre-existing gap unrelated to this change — not attempted here).

**Not yet deployed or tested by the owner.** This needs a real migration run (`db:migrate:deploy`)
against the live database before anything else — unlike prior updates this session, this one cannot
be smoke-tested without applying the schema migration first. See the implementation report delivered
in-chat for full manual testing steps.

## Update — 2026-09-08 Legacy Import fixes after the bilingual-name/customer-code change

The owner asked for a focused audit of the Legacy Import flow specifically, after the feature
above landed, with three named concerns. Commit `196f8f1`. No schema change.

**Audited first, as asked.** Grepped the whole repo and read every file the owner named
(`CustomerDraft`, `DuplicateCandidate`, `CustomerOption`, `approvedCustomer`, the review form, the
rows table, `CustomerCombobox`). The bilingual-name frontend/backend contract was already fully
consistent on `nameEn`/`nameAr` — no stale `companyName` remained anywhere in Legacy Import's own
code. The `companyName` grep hits that do remain are all the canonical/flat parsers' own raw
single-string field (`CanonicalCustomer.companyName`, `LegacySuggestions.companyName`) which is
correct and unrelated to the DB schema — confirmed and left alone. Found and fixed two smaller,
real gaps in that area instead: `customerCombinedLabel()` used "/" as the separator where the owner
now explicitly wants "·"; and the Attach Existing Customer combobox didn't surface the Customer
Code, which the owner asked for since similarly-named customers under different Billing Entities
are expected. Both fixed in `apps/web/lib/customer-name.ts` / `apps/web/components/customer-combobox.tsx`.

**Real bug #1 — mixed Arabic+English source names.** `splitBilingualName()` (added last update)
classified a value as Arabic whenever it contained *any* Arabic character, so a name like "Khayrat
Al Shobak خيرات الشوبك" landed entirely in `nameAr`, burying the English portion inside it.
Rewrote it in `name-language.util.ts`: it now safely splits a clean "Latin block, then Arabic
block" or "Arabic block, then Latin block" into both fields (locating the first/last Arabic
character and requiring the Arabic span itself be free of Latin letters, and the remainder be a
genuine one-sided Latin name — never a Latin-Arabic-Latin sandwich, which would require reordering
text rather than just classifying it). Anything structurally ambiguous still falls back to
preserving the whole original string unsplit, exactly the prior behavior — no translation, no
invented text, nothing discarded.

**Real bug #2 — the critical one — canonical customer identity ignored Billing Entity.**
`createCanonicalBatch()` in `legacy-import.service.ts` keyed its sibling-row customer-reuse
reference (`sourceLegacyReference`, looked up later in `approveRow()`) on the source `Customer_ID`
alone: `` `${file}#Customers!${customerId}` ``. The owner's own workbook has at least one customer
(`CUST-0005` / `mpr.com.sa`) with subscriptions recorded under *both* Billing Entities. Under the
old key, whichever Billing Entity's subscription got approved first would create the customer, and
the *other* Billing Entity's subscription — approved later — would find that same reference and
silently reuse it, merging what must be two separate CRM customers (`FFxxxx` and `NSxxxx`) into
one. Fixed by moving the existing `billingEntity` resolution earlier in the loop and folding its id
into the reference: `` `${file}#Customers!${customerId}#BillingEntity!${billingEntity?.id ?? ...}` ``.
`ATTACH_EXISTING` was already fully exempt (it never touches this reference or generates a code —
verified with a new test) and needed no change. Customer Codes still come only from the existing
`CustomerCodeService` — no second generator was introduced, per the owner's explicit instruction.

Duplicate detection was reviewed too: already Billing-Entity-scoped from the prior update (a name
match under a different Billing Entity was already excluded from candidates) — confirmed correct,
no code change, added a regression test since none existed for that specific negative case.

**Tests added**: 8 new cases in `name-language.util.spec.ts` (Arabic-only, English-only, both
worked examples from the owner split correctly, reverse order, dash-separator cleanup, two
ambiguous-fallback cases); 4 new cases in `legacy-import.service.spec.ts` (two Billing Entities for
one canonical `Customer_ID` produce two distinct references while two subscriptions under the same
entity still share one; the resulting `approveRow()` behavior creates two separate customers via
two separate `CustomerCodeService.next()` calls with the correct per-row Billing Entity; explicit
`ATTACH_EXISTING` creates no customer and never calls the code service; the cross-entity
duplicate-detection negative case). One pre-existing test's hardcoded reference string was updated
to the new format (its actual behavior — same customer, same Billing Entity, shares one reference —
is unchanged and still asserted).

Verified: strict typecheck, lint, 183 tests / 44 suites (12 skipped live-DB specs, unaffected — no
schema touched this update), both production builds, Prettier (only whitepace/line-wrap changes on
3 files, reviewed by hand and accepted). **Not yet deployed or tested by the owner.**

## Update — 2026-09-08 filters on Customers and Subscriptions pages

The owner asked for "every kind of filtration from our system, like currency, date, name,
package" on the Customers and Subscriptions pages. Commit `796620f`. No schema change.

**Customers** (`customers-manager.tsx`): added a Billing Entity filter dropdown (the backend's
`CustomerListQueryDto.billingEntityId` already supported this — it just wasn't exposed in the UI)
and a new created-date range (`createdFrom`/`createdTo`, new on both the DTO and
`CustomersService.list()`'s `where.createdAt`). Search (code/name EN+AR/email/phone) and status
already existed. Added a "Clear filters" button that appears once any filter is active.

**Subscriptions** (`subscriptions-manager.tsx`): the backend already supported `serviceTypeId` and
`renewalFrom`/`renewalTo` in `SubscriptionListQueryDto`, but neither was exposed in the UI —
exposed both. Added three genuinely new filters, on both the DTO and `SubscriptionsService.list()`:
`servicePackageId`, `currency`, and `billingEntityId` (the last one via a nested `customer: {
billingEntityId }` relation filter, added only when set — verified with a test that it's omitted
entirely rather than passed as `undefined` when no Billing Entity filter is chosen, since Prisma
treats an explicit `undefined` key differently in some contexts). The Package dropdown narrows to
the selected Service Type, mirroring the same cascading pattern already used in the subscription
create/edit form. Also added a "Clear filters" button, same pattern as Customers.

Both pages follow the existing filter-bar visual/interaction pattern already established on the
Renewal Cases page (dropdowns + date-range `<input type="date">` pairs, reloading on every change
— no debounce, matching how every other filtered list page in this app already works).

**Tests added**: `customers.service.spec.ts` (Billing Entity + created-date-range where-clause
shape) and a new `subscriptions.service.spec.ts` (all five new/newly-exposed filters' where-clause
shape, plus a regression test confirming the Billing Entity relation filter is omitted entirely —
not passed as an explicit `undefined` — when no Billing Entity is selected).

Verified: strict typecheck, lint, 186 tests / 45 suites, both production builds, Prettier (line-wrap
only on 3 files, reviewed and accepted). **Not yet deployed or tested by the owner.**

## Open — Renewals page ("not working from the beginning")

The owner separately reported the Renewals page (`/dashboard/renewals`,
`renewal-cases-manager.tsx`) has never worked, without describing the exact symptom. Investigated
thoroughly before touching anything (nothing changed yet — **this is diagnostic notes, not a
fix**):

- Routing, RBAC (`RolesGuard` allows any authenticated user through when no `@Roles()` decorator is
  present, matching `RenewalCasesController`'s unguarded `GET` endpoints), the controller, the
  service's `list()` where-clause construction, and `BusinessTimeService`'s date math were all read
  end-to-end and are structurally correct — no crash-causing bug found by static analysis.
- `RenewalCase` rows are only ever created by `RenewalEngineService.evaluateAll()`, which only runs
  when a BullMQ job on the `RENEWAL_QUEUE` is processed by the separate **worker** process
  (`worker-main.ts` / the `customer-cp-worker` systemd service — confirmed distinct from the API
  process). A daily cron job is registered (`RenewalQueueService.onModuleInit()`, `0 5 0 * * *` in
  the business timezone) and there's a manual "Run renewal evaluation" trigger, but it's on the
  **Renewal Settings** page (ADMIN-only), not on the Renewals page itself — easy to have never
  found.
- Even when the engine does run, it only creates a `RenewalCase` for a subscription once its
  `renewalDate` falls within the configured reminder window (up to 30 days out by default, from the
  seeded `ReminderRule`s). A freshly imported/renewed book of subscriptions with renewal dates
  further out than that will show **zero rows on this page by design** — which looks identical to
  "broken" from the owner's side.

**Leading hypotheses, in order of likelihood**: (1) the worker process was never actually running on
the server, so the daily job queued but never executed and `renewal_cases` has stayed empty since
day one; (2) it does run, but no subscription has yet entered its 30-day reminder window; (3) an
actual runtime error only visible in the browser/API logs that this session's static code reading
couldn't surface without live access. Asked the owner directly what "not working" looks like
(blank page, error message, wrong/missing data, or something else) before changing any renewal
logic — this is business-critical and a wrong guess here would be costly. **Next session: read
their answer first, do not re-guess.**

## Resolved — Renewals page crash root-caused and fixed (commit `8283162`)

The owner came back with the actual browser error: `Uncaught TypeError: Cannot read properties of
undefined (reading 'map')`, and had already root-caused it themselves by inspecting the contract —
correctly. `renewal-cases-manager.tsx` called `apiRequest<PageResult<ServiceTypeOption>>('/service-types?pageSize=100')`
and then read `.data`, but `GET /service-types` (`ServiceTypesService.list()` →
`prisma.serviceType.findMany()`, no `@Query()` DTO on the controller, no pagination) returns a
**plain array**, unlike `/renewal-cases` and `/communication-outbox` (both genuinely paginated
`{ data, meta }`, verified). `apiRequest<T>()` does a blind `as T` cast with zero runtime
validation, so the wrong generic type produced `serviceTypeResult.data === undefined` silently at
the network layer — the crash only surfaced later, at `serviceTypes.map(...)` during render.
`subscriptions-manager.tsx` already called the same endpoint correctly
(`apiRequest<ServiceTypeOption[]>('/service-types')`) — that's how the owner found the mismatch.

This retroactively explains the original "not working from the beginning" / "whole tab blank or
browser error" report from a few updates ago: this was **not** the migration-not-applied hypothesis
from that investigation (this bug predates the bilingual-name work entirely and is unrelated to it)
— it was this exact contract mismatch, present since whenever the Service Type filter was first
wired into this specific component.

Fixed: corrected the call and its consumption to the real contract, and added a defensive `?? []`
fallback on all three array-typed `setX(...)` calls in this component (cases, outbox, service
types) so a future contract drift of the same kind degrades to an empty list instead of crashing
the page. `apps/web` has **no test runner configured at all** (no Jest/RTL/Vitest, no `test` script
in its `package.json`) — introducing one just for this one regression check would be well beyond a
focused fix, so instead added the practical equivalent on the API side: a new
`service-types.service.spec.ts` pinning `ServiceTypesService.list()`'s actual contract (plain
array, not `{ data, meta }`), so an accidental future change to that shape is caught immediately
rather than silently reaching a consumer again.

Verified: strict typecheck, lint, 187 tests / 46 suites, web production build. **Not yet tested by
the owner in the browser** — this was diagnosed and fixed from the reported error text and a static
read of the actual contract, not reproduced live.

## Update — 2026-09-09 Renewals turned into a full operational workspace (commit `835f7d1`)

Once the crash was fixed, the owner asked for a much bigger follow-up: the Renewals page loaded
but didn't give enough context to actually manage renewals — no price, no package, no Billing
Entity, no reminder history, no way to see what happens next. Delivered a 26-point spec in full.
Investigated everything listed (RenewalCase model, RenewalCaseStatus, Subscription, Customer,
ServicePackage, BillingEntity, CommunicationOutbox, the renewal engine, ReminderRule/
NotificationRule config, the existing hold flow, the subscription `?edit=` deep-link, the
`customer-name.ts` bilingual helpers) before writing anything, per the owner's explicit "before
coding" checklist. **RenewalCase stayed the core entity throughout** — this is still an ops layer
over the existing engine, never a raw subscription list; a subscription approaching renewal with no
case yet still correctly shows zero. No schema/migration change.

**Backend** (`renewal-cases.service.ts`/`.controller.ts`/`.dto.ts`):
- Enriched the existing `renewalCaseInclude`: customer gains `phone`/`contactName`, subscription
  gains its `servicePackage` relation, plus the single most recent `communicationOutbox` row
  (bounded `take: 1`, no N+1) for a cheap list-view reminder signal — all other fields the table
  needed (price, currency, code, name, status) were already coming back from the existing include,
  just not typed on the frontend yet.
- New `GET /renewal-cases/summary` (must be declared before `:id` in the controller — verified
  this ordering matters and got it right): due-within-7/30-days, overdue, awaiting-customer,
  on-hold. Independent of the table's own filters, like a dashboard header. Found
  `DashboardService.summary()` already computes `awaitingCustomer`/`renewalCasesOnHold` with the
  *exact same query shape* I'd independently written — confirmed consistency rather than
  refactoring to share code (dashboard's "renewals within N days" counts raw ACTIVE subscriptions,
  a deliberately different, broader concept than this page's RenewalCase-only due/overdue counts,
  so they aren't the same computation and don't call each other). Due/overdue excludes terminal
  statuses (`CLOSED`/`FULFILLED`/`REJECTED`/`DO_NOT_RENEW`) — a FULFILLED case isn't "due" anymore
  no matter its stored `dueDate`.
- `RenewalCaseListQueryDto` gained `servicePackageId` and `billingEntityId` filters; search now
  also matches Customer Code (previously just subscription code/name and customer name EN/AR).
- Four new, intentional, single-purpose workflow actions — explicitly **not** a generic status
  editor, per the owner's own instruction: `POST :id/mark-awaiting-customer`, `mark-accepted`,
  `mark-do-not-renew`, `mark-fulfilled`. Each only fires from a non-terminal status (else 409) and
  sets the one matching field the schema already had for that decision (`acceptedAt`/
  `doNotRenewAt`/`fulfilledAt`) — same pattern `createHold`/`releaseHold` already use for their own
  fields. Phase 3's invoice/payment/collection states (`INVOICE_DRAFT` through `PAYMENT_CONFIRMED`)
  are deliberately **not** exposed as actions — that workflow is still locked and unbuilt; these
  four are just what the current Phase 2 model already supports. Same RBAC as the hold endpoints.

**Frontend**:
- New `apps/web/lib/renewal-timing.ts`: `daysUntilDue`/`daysLeftLabel` ("6 days" / "Today" / "3
  days overdue" — deliberately mirrors `business-time.service.ts`'s own calendar-day-diffing
  style, but does it client-side without trying to replicate the server's business-timezone
  awareness, matching how every other date cell in this app already just does `.slice(0, 10)`),
  `urgencyOf` (overdue/today/week/month), `reminderStatusLabel`.
- New `apps/web/components/renewal-case-detail.tsx`: a `Modal` (the same pattern used everywhere
  else in this app for "view/edit one record") showing the full customer + subscription context
  with direct links to Customer Details and the exact Subscription (reusing the existing `?edit=`
  deep-link — no new navigation mechanism invented), a renewal timeline built from the *actual
  configured* `ReminderRule`s (fetched from the already-existing `/renewal-configuration` endpoint
  — never hardcoded `[30,21,14,7,2,0]`) cross-referenced against that case's own communication
  history and `evaluationDecisions` (so a milestone that was skipped for a hold shows "Skipped — on
  hold" rather than just "Pending"), the full communication history table for that case, and the
  hold/mark-* action buttons.
- `renewal-cases-manager.tsx` reworked: overview cards reusing the **existing**
  `.metric-grid`/`.metric-card` CSS already established by `dashboard-summary.tsx` (found this
  while investigating, used it instead of inventing new card styling); richer filters (search now
  covers Customer Code + both names + subscription code/name; status; hold state; a new
  urgency filter that replaced the old exact-single-day `daysBeforeDue` dropdown with proper
  overdue/today/week/month range buckets computed from the existing `dueFrom`/`dueTo` params —
  editing the date fields manually clears the urgency selection since they'd otherwise silently
  disagree; Service Type; Package, cascading from Service Type; Billing Entity; due-date range) and
  a "Clear filters" button; the table now shows Due/Days-left/Customer (code + bilingual name,
  clickable)/Subscription (code + name, clickable, deep-links to the exact subscription)/Service +
  Package/Amount + currency/Billing Entity/Status/Reminder status/Actions; row actions are View
  (opens the detail modal) plus the existing inline Hold/Release; the Communication Outbox section
  is kept but now collapsed by default with its own search + status filter and framed explicitly as
  a secondary/debugging view, not the primary way to understand a renewal; empty states now
  distinguish "no cases exist" from "no matches for these filters"; the defensive `?? []` fallback
  from the earlier crash fix is kept on every array-typed state and extended to every new fetch
  (service types, packages, billing entities, summary) so a future contract mismatch on any of them
  degrades to an empty state instead of crashing the page again.

**Tests**: `renewal-cases.service.spec.ts` gained coverage for `summary()` (terminal-status
exclusion verified via the exact `where` clause, direct count assertions), all four mark-* actions
(one success-path test per action asserting the exact `data` written, plus a parameterized test
confirming all four refuse to fire from any of the four terminal statuses), and a `list()`
filter-shape test for the two new filters plus Customer-Code search. `phase-2-rbac.spec.ts`
extended to cover the four new endpoints (same role set as hold actions) and `GET summary` (no
role restriction, like `list`).

Verified: strict typecheck, lint, 202 tests / 46 suites, both production builds, Prettier
(line-wrap only across 3 files, reviewed by hand and accepted). **Not yet tested by the owner in
the browser.**

**Open items worth knowing about, not fixed here (none required by the task)**:
- `reminderStatusLabel()` deliberately does not attempt an accurate "N queued" count — only the
  single most-recent outbox message's own status is cheaply/reliably knowable without a second,
  unbounded query per row. If a precise queued-count ever becomes worth the extra cost, Prisma 7's
  filtered relation `_count` (`_count: { select: { communicationOutbox: { where: {...} } } }`)
  would be the way to add it without N+1.
- **Confirmed, real renewal-engine limitation, deliberately not changed** (the owner asked for this
  to be reported rather than silently fixed as part of a UI task): `RenewalEngineService.evaluateAll()`'s
  own subscription query filters `renewalDate: { gte: businessDate(asOf), lte: addBusinessDays(asOf, maxDays) }`
  — the `gte: today` means a subscription whose renewal date is already in the past by the time the
  engine first evaluates it will **never** get a `RenewalCase` created for it at all, and will never
  appear on the Renewals page. This only affects subscriptions that become overdue *before* the
  engine ever ran for them (e.g. freshly imported historical data with a past renewal date, or a
  long worker outage spanning a renewal date) — a case that was already created *before* going
  overdue is never deleted or filtered out by date direction anywhere, so it correctly keeps
  showing as "N days overdue" on the new page exactly as the spec asked. If genuinely-overdue
  subscriptions ever seem to be silently absent from the Renewals page entirely (not just
  displaying without the "overdue" styling), this query is where to look — not a bug introduced or
  fixed this session.

## 2026-09-09 — Subscription Code redesign: `<CUSTOMER_CODE>-S<NN>`, replacing `LEG-S-*`, existing data backfilled in place

The owner noticed subscriptions still showed `Code: LEG-S-<hash>` and asked why, given the earlier
Customer Code redesign (`FF0001`/`NS0001`). Root cause: that earlier work only ever touched
**Customer** codes — `LEG-S-*` is the **Subscription** code, generated by a separate SHA-256-hash
generator (`generatedCode('LEG-S', ...)`) in `legacy-import.service.ts`, explicitly out of scope for
every prior task this session. This task redesigns Subscription Codes the same way, with one
non-negotiable constraint: **no re-import** — every existing Customer and Subscription stays exactly
where it is (same ids, same relationships), only `subscriptionCode` values change, in place.

**New format**: `<CUSTOMER_CODE>-S<NN>` (e.g. `FF0001-S01`, `FF0001-S02`), zero-padded to at least 2
digits, uncapped beyond that (`FF0001-S100` is valid). The sequence is per-Customer (not global, not
per-Billing-Entity) — `NS0007-S01` and `FF0001-S03` coexist independently.

**New: `SubscriptionCodeSequence` model + `SubscriptionCodeService`**
(`apps/api/src/modules/subscriptions/subscription-code.service.ts`) — a direct structural mirror of
the existing `CustomerCodeSequence`/`CustomerCodeService` pattern: one row per Customer, `lastValue`
only ever increments, `next(tx, customerId)` does a `customer.findUnique` (for the code prefix) then
a `subscriptionCodeSequence.upsert` **inside the caller's transaction** — the `UPDATE` takes an
exclusive row lock on that Customer's sequence row until commit, so concurrent creates for the same
Customer serialize instead of racing (no duplicate codes possible), while different Customers proceed
in full parallel. `SubscriptionsModule` now exports this service (mirroring how `CustomersModule`
already exports `CustomerCodeService`); `LegacyImportModule` now imports `SubscriptionsModule` to
reach it.

**One authoritative generator, two call sites, both inside their creating transaction:**
- `SubscriptionsService.create()` — was: caller supplied `subscriptionCode` directly in
  `CreateSubscriptionDto` (a plain required string field, with a matching manual text input in
  `SubscriptionModal`). Now: `CreateSubscriptionDto` no longer has a `subscriptionCode` field at
  all — removing it from the DTO (not just the UI) is what makes the API itself refuse a
  caller-supplied code, since the global `ValidationPipe` runs with `whitelist: true,
  forbidNonWhitelisted: true` (verified in `main.ts`): an unknown `subscriptionCode` property in the
  request body now gets a 400, not silently ignored. The service calls
  `this.subscriptionCode.next(tx, input.customerId)` inside its `$transaction` and writes the result
  onto the create payload.
- `LegacyImportService.approveRow()` — the `generatedCode('LEG-S', ...)` call in the per-subscription
  create loop is replaced with `this.subscriptionCode.next(tx, customerId)`, using the same
  `customerId` local the surrounding code already resolves for both `CREATE_NEW` (a customer just
  created earlier in the *same* transaction — reading it back via `tx.customer.findUnique` inside the
  same transaction sees the uncommitted row, same as the existing `CustomerCodeService` call a few
  lines above it already relies on) and `ATTACH_EXISTING` (the selected existing customer). The
  now-dead `generatedCode()` private method and its only call site are removed entirely — `LEG-S` no
  longer exists anywhere in the codebase except in comments/test names documenting the removal and
  the historical `sourceLegacyReference` provenance data, which is explicitly untouched (see below).

**Customer immutability on existing subscriptions** — since the code now encodes the owning
Customer, reassigning a subscription's Customer through a normal edit would make its own code lie.
`UpdateSubscriptionDto` no longer has a `customerId` field (same whitelist-rejection mechanism as
above); `SubscriptionsService.update()`'s parent-resolution logic now always uses `oldState.customerId`
rather than an input value. `SubscriptionModal`: when editing, the Customer field is now a read-only
`<strong>` display (not a `<select>`) with an explanatory note that a future "Transfer Subscription"
workflow (not built — out of scope) would be needed to move it; when creating, the `<select>` and
`customerId` submission are unchanged. Subscription Code itself was already read-only in the edit
form (there was never an editable input for it) and is now additionally impossible to *create* one
for, since the manual "Subscription code" text input was removed and replaced with a note that it's
generated automatically.

**Migration — `20260909000000_subscription_code_sequences_and_backfill`** — creates
`subscription_code_sequences` (`customer_id` PK, `last_value`, `updated_at`, FK to `customers`), then
a single `UPDATE ... JOIN (SELECT ... ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY created_at
ASC, id ASC) ...)` backfills **every** existing subscription's `subscription_code` in place —
deliberately not scoped to only `LEG-S-*` rows, since the goal is one canonical scheme for every
Subscription regardless of its prior code's origin. This cannot violate the `subscription_code`
unique constraint: every prior code (hash-based or free-text-entered) is structurally disjoint from
the new `<customer_code>-S<NN>` shape, and `customer_code` is itself unique, so the full target set is
guaranteed collision-free. A second statement seeds each Customer's `subscription_code_sequences.last_value`
to its post-backfill subscription count, so the next created subscription continues the numbering
rather than restarting at `-S01`. `ROW_NUMBER() OVER (...)` requires MariaDB 10.2+; this project's
documented minimum supported server is 10.6 (`ADR-003-MARIADB-RETARGET.md`), so this is safe for
`prisma migrate deploy` in production — no shadow database involved (that's a `migrate dev`-only
concept). **This was verified end-to-end against a real local MariaDB 12.1 instance in this
session**, not just reasoned about: deployed all prior migrations to a throwaway database, seeded
customers/subscriptions with mixed `LEG-S-*`/free-text codes and deliberately out-of-order
`created_at` values (including two rows sharing an identical `created_at`, to exercise the `id`
tie-breaker), applied this migration, and confirmed the exact expected `-S01`/`-S02`/`-S03` assignment
in `created_at`-then-`id` order, unchanged subscription ids, and correctly seeded sequence rows —
then dropped the throwaway database.

**UI label clarity** (this is also the direct fix for the owner's original confusion): every "Code:"
label that could be ambiguous between a Customer's own code and a Subscription's code now says which
one it is — `customers-manager.tsx`'s edit-modal label is now "Customer Code:"; the two adjacent
labels in the Renewal Case detail modal (`renewal-case-detail.tsx`, one under the Customer section,
one under the Subscription section — the single most likely source of the original "why does the
customer have Code: LEG-S-..." report, since both used to just say "Code:") are now "Customer Code:"
and "Subscription Code:" respectively; `SubscriptionModal`'s edit view shows both together as
`Customer Code: FF0042 · Subscription Code: FF0042-S03`. Also added: a Subscription Code column on
the Subscriptions list table, and the Subscription Code prefixed onto each row of a Customer's
subscription list in `customer-detail.tsx` — both were previously not shown there at all.

**Not touched, on purpose**: `sourceLegacyReference` (historical provenance — untouched, per the
same reasoning as the Customer Code work); `AuditEvent` history (old audit rows recording a
subscription's original `LEG-S-*` code stay exactly as written — only the *current* Subscription
record's code changed, history is not rewritten); `RenewalCase`/`CommunicationOutbox`/
`LegacyImportSubscriptionLink`/`SubscriptionIdentifier`/`SubscriptionConnection` — all key off
`subscriptionId` (the database id), never off the textual code, and no id changed, so every
relationship and every existing deep link keeps working unmodified; the existing
`subscriptionCode: { contains: search }` search clause in `SubscriptionsService.list()` needed no
change — it already matched on whatever string was stored, and now that string is just a different,
more useful shape.

**Tests**: new `subscription-code.service.spec.ts` (direct structural mirror of
`customer-code.service.spec.ts`: correct `-S01`/`-S02` formatting, uncapped growth past 2 digits,
"Customer not found" rejection). `subscriptions.service.spec.ts` gained a `create()` test proving the
code comes from `SubscriptionCodeService.next(tx, customerId)` rather than the caller, and an
`update()` test proving a raw object with an extra `customerId` field (simulating a caller bypassing
the DTO type) still cannot redirect which Customer `requireParents` resolves against — it always uses
`oldState.customerId`. `legacy-import.service.spec.ts`: all 11 existing `LegacyImportService`
constructor call sites updated for the new 5th constructor argument; the 4 tests that actually
execute `approveRow()`'s subscription-creation loop now assert against a working
`SubscriptionCodeService` mock instead of an inert stub; two new dedicated tests confirm `CREATE_NEW`
calls `subscriptionCode.next(tx, <newly-created-customer-id>)` and produces a code that does **not**
match `/^LEG-S-/`, and `ATTACH_EXISTING` calls it with the selected existing customer's id and never
touches `CustomerCodeService`. `phase-1-services.spec.ts` and `phase21-subscriptions.service.spec.ts`
updated for the new constructor shape and the removed `subscriptionCode` DTO field.

Verified: `prisma validate`, `prisma generate`, strict typecheck (both packages), lint (both
packages, zero warnings after fixing 4 `@typescript-eslint/no-unnecessary-type-assertion` findings in
test files — replaced redundant `as never` casts with proper `BillingFrequency`/`SubscriptionStatus`
enum imports), 222 Jest tests / 50 suites (210 passed, 12 skipped — the 3 skipped suites are the
`mariadb-*-live.spec.ts` files that require a live database connection via env flag, unrelated to
this change), both production builds (API `nest build`, web `next build` — 16 routes, unchanged route
list), and the migration itself end-to-end against a real MariaDB as described above. **Not yet
tested by the owner in the browser** — recommend opening a Subscription's edit view and the Renewal
Case detail view after deploying to confirm the new labels and generated-code behavior look right.

**Production deployment** (the schema changed — a new table, and `CreateSubscriptionDto`/
`UpdateSubscriptionDto` changed shape — so this is a full deploy, not a code-only restart):
1. `npm ci` (no new dependencies were added, but keep this in the routine as always).
2. `npm run db:migrate:deploy` — applies `20260909000000_subscription_code_sequences_and_backfill`.
   This is a real data migration (rewrites every `subscriptions.subscription_code` value and creates
   `subscription_code_sequences`), but it does **not** delete or recreate any Customer or Subscription
   row, and does not touch any other table — take the same DB backup precaution as any migration
   deploy, but there is nothing here beyond a normal `migrate deploy`.
3. `npm run db:generate` — regenerates the Prisma client for the new `SubscriptionCodeSequence`
   model (needed before the API build, since the API imports the generated client).
4. `npm run build` (both `@cp/api` and `@cp/web`) — required: `CreateSubscriptionDto` dropped a
   field, `SubscriptionsService`/`LegacyImportService` constructors changed shape, and
   `SubscriptionModal`/`customers-manager.tsx`/`renewal-case-detail.tsx`/`subscriptions-manager.tsx`/
   `customer-detail.tsx` all changed — a stale build would serve the old contract.
5. Restart the application (API process + whatever serves the Next.js build) via Plesk as usual.

No `.env` changes, no new environment variables, no Redis/worker changes, no changes to any other
migration.

### 2026-09-09 (same day, follow-up) — Owner review caught 3 real production-safety bugs in the migration; fixed and re-verified

The owner reviewed the migration SQL above before allowing a push and found genuine correctness
issues my earlier "verified end-to-end" claim had missed — each one was reproduced against a real
local MariaDB, fixed, and re-verified, not just reasoned about a second time:

1. **`LPAD(..., 2, '0')` truncates rather than pads** — MariaDB's `LPAD` shortens a source string
   that's *longer* than the target length, so `LPAD('100', 2, '0')` returns `'10'`, not `'100'`.
   Subscription #100 for a customer would have collided with #10. Fixed by replacing the padding
   with `CASE WHEN rn < 10 THEN CONCAT('0', rn) ELSE CAST(rn AS CHAR) END`, which only prepends a
   zero when needed and never truncates, for any row count. Reproduced the bug and the fix against
   a real MariaDB with 101 subscriptions for one customer, asserting the exact `S09`/`S10`/`S11` and
   `S98`/`S99`/`S100`/`S101` boundary values and zero duplicate codes.
2. **The data rewrite wasn't wrapped in a transaction** — a failure between phase 1 (temp rename)
   and the sequence-seeding step would have left production subscriptions stuck on
   `__scode_migrating__<id>` codes. Fixed by wrapping phase 1 + phase 2 + sequence seeding in an
   explicit `START TRANSACTION` / `COMMIT` (the two `CREATE TABLE`/`CREATE TEMPORARY TABLE`
   statements stay outside it, since DDL implicitly commits in MariaDB regardless). Verified by
   splicing a deliberately-failing statement into a *copy* of the real migration SQL in place of the
   real phase-2 rename, applying it, confirming the failure, then reconnecting with a **fresh
   session** (so the check can't be fooled by reading the failed session's own uncommitted writes)
   and confirming the original codes were completely untouched.
3. **The temporary namespace wasn't provably collision-proof against historical free-text codes** —
   my original claim that `CONCAT('__scode_migrating__', id)` "cannot collide" was only true among
   the temp codes themselves (each is a function of a unique id); it did not rule out an existing,
   historical free-text code already equalling *another* row's computed temp code. Fixed with an
   explicit preflight guard, using the same `utf8mb4_unicode_ci` collation as
   `subscriptions.subscription_code` itself: every current code and every computed temp code are
   inserted into a `PRIMARY KEY`-constrained temporary table before phase 1 runs; a collision throws
   a duplicate-key error there, before any real `subscriptions` row is touched. This also folded in
   the requested final-code length guard (item 4 of the owner's list): the same preflight step
   materializes every computed `final_code` into a temporary mapping table with `UNIQUE` and
   `CHECK (CHAR_LENGTH(final_code) <= 191)` constraints, so a final code that wouldn't fit
   `subscription_code`'s actual column type (confirmed `VARCHAR(191)` against the original phase-0
   migration) or that collides with another subscription's final code aborts before phase 1 too —
   rather than being asserted safe in a comment. Reproduced the temp-prefix collision scenario
   (an existing subscription's code deliberately set to another subscription's would-be temp code)
   against real MariaDB and confirmed the migration aborts with the original codes fully intact.

The migration is now: two temporary mapping/guard tables built and validated first (real DB
constraints, not comments, proving no collision and no length overflow is possible) → a
`START TRANSACTION` block doing phase 1 (rename to temp) → phase 2 (rename to final) → sequence
seeding → `COMMIT` → temp table cleanup.

`apps/api/prisma/mariadb-subscription-code-backfill-live.spec.ts` (the permanent live-DB regression
test, gated behind `MARIADB_TEST_DATABASE_URL` like the project's other live suites) was rewritten
to cover all 8 scenarios the owner asked for: the collision/swap scenario, the deliberate temp-code
collision (preflight guard), 101 subscriptions for one customer (the `S99`/`S100`/`S101` boundary),
createdAt ties broken by id, transactional rollback on an injected phase-2 failure, unchanged
subscription ids throughout, correct sequence seeding, and — using the real
`SubscriptionCodeService` against the post-migration database, not a reimplementation — that the
first subscription created after a 101-subscription backfill gets `S102`. All 8 pass against a real
local MariaDB 12.1 instance (verified in-session; cleaned up afterward). Full API suite (230 tests /
51 suites, 210 passed / 20 skipped — live-DB-only), typecheck, and lint all still clean on both
packages.

**Still not pushed** — a second local commit was created on top of the first with these fixes, at
the owner's explicit request to review the actual migration file before any push or deployment.

### 2026-09-09 (same day, second follow-up) — Two more precise fixes from a direct review of migration.sql

The owner reviewed the fixed migration file itself (not just my description of it) and asked for
two changes, both purely to the migration SQL — no change to the two-phase rename logic, the
`ROW_NUMBER()` ordering, the `CASE`-based padding, the transaction wrapping, or the test file:

1. **Move `CREATE TABLE subscription_code_sequences` to after preflight validation succeeds, still
   before `START TRANSACTION`.** Previously it ran first, so a preflight failure (the temp-code
   collision guard, or the final-code uniqueness/length checks) would still have left this
   permanent table behind — harmless (empty, and the next deploy attempt would just reuse it), but
   not the "leaves nothing behind" guarantee the owner wanted. Reordered so the two temporary
   tables (and their validating `INSERT`s) run completely first; the permanent table is only
   created once both have succeeded. Verified directly: reproduced the temp-prefix collision
   scenario from the prior round again, confirmed the migration still aborts the same way, and
   confirmed with `SHOW TABLES LIKE 'subscription_code_sequences'` that the table **does not exist
   at all** afterward (previously it would have).
2. **Corrected an inaccurate comment.** The prior version claimed `CREATE TEMPORARY TABLE` "is DDL
   and implicitly commits in MariaDB" the same way a normal `CREATE TABLE` does — the owner
   corrected this: temporary-table DDL does **not** cause the same implicit commit in MariaDB. The
   temp tables' placement before `START TRANSACTION` was already correct (per the owner: "the
   current placement is fine"), just for a different reason than the comment gave — they run first
   so preflight can complete and potentially fail before the permanent table is created, not because
   of an implicit-commit concern. Comment corrected to say so, and to correctly attribute the actual
   implicit-commit behavior to the (now-relocated) permanent `CREATE TABLE` statement instead, which
   really does cause one.

Re-ran the full live-DB test suite (all 8 scenarios from the prior round, file itself untouched)
against a real local MariaDB — all pass. Re-ran the full API suite, typecheck, lint, and
`prisma validate` — all clean (230 tests / 51 suites, 210 passed / 20 skipped). Committed locally as
a third commit on top of the previous two. **Still not pushed.**

### 2026-09-09 (same day, third follow-up) — Owner review found the new FK would have broken existing customer deletion

The owner reviewed the migration file again and caught a real regression: `subscription_code_sequences.customer_id`'s FK was `ON DELETE RESTRICT`. `CustomersService.deleteCustomer()` — existing, unmodified, already-audited code — explicitly deletes a customer's subscriptions and other dependents and then calls `tx.customer.delete()`, but has no reason to know about this brand-new table. After this migration, every customer with a subscription gets a sequence row, so deleting such a customer would have hit the new FK and failed outright — a real production break, not a hypothetical one.

Fixed exactly as scoped, nothing else touched:
- `schema.prisma`: `SubscriptionCodeSequence.customer` relation changed from `onDelete: Restrict` to `onDelete: Cascade`.
- `migration.sql`: the FK's `ON DELETE RESTRICT` → `ON DELETE CASCADE` (`ON UPDATE CASCADE` was already there — Prisma's own default for MySQL/MariaDB `onUpdate`, matching the `CustomerCodeSequence` precedent, which is why it required no explicit `onUpdate` in the schema either).

This is a schema-level fix only — no change to `CustomersService.deleteCustomer()` itself was needed or made; the database now handles removing the now-orphaned sequence row automatically as part of the customer `DELETE` statement's own cascade.

The rule the owner explicitly wanted preserved was already true by construction and needed no code change: there is no FK between `subscriptions` and `subscription_code_sequences`, so deleting an individual Subscription can never touch the sequence row regardless of how it's deleted.

New live-DB test, `apps/api/prisma/mariadb-subscription-code-sequence-delete-live.spec.ts` (the already-reviewed backfill/preflight/transaction test file was left completely untouched, per instruction), proves both required behaviors against a real MariaDB:
- Creates 3 subscriptions for a customer via the real `SubscriptionCodeService` (`S01`/`S02`/`S03`), deletes `S03` directly, confirms the sequence's `last_value` is still `3`, then creates another subscription and confirms it gets `S04` — never reusing `S03`.
- Creates a customer with subscriptions (and therefore a sequence row), then calls the real, unmodified `CustomersService.deleteCustomer()` — not a reimplementation — and confirms it resolves cleanly, the customer is gone, and the sequence row is gone too (cascaded, not orphaned).

Sanity-checked the test has real teeth the same way as the prior rounds: temporarily reverted the FK to `RESTRICT` in the mirror only, re-ran, and got the exact real failure — `Foreign key constraint violated` inside `customers.service.ts:377`, the actual `tx.customer.delete()` call — confirming this is the precise bug the owner described, then restored the fix and re-confirmed green. Also re-ran the previously-reviewed backfill/preflight/transaction live test file (untouched) to confirm the FK change doesn't affect it — all 8 still pass.

Full verification: `prisma validate`, typecheck, lint — all clean. Full API suite: 232 tests / 52 suites (210 passed, 22 skipped — 5 live-DB-only suites now, since this adds one). Production build succeeds. Committed locally as a fourth commit on top of the previous three. **Still not pushed.**

## 2026-09-09 (later same day) — Create/Edit Subscription workflow redesign: locked/searchable Customer selection, and one coherent Start Date + Renewal Interval → Renewal Date model

New task, no schema/migration change — the Subscription Code work above is untouched. Two problems: (1) "Add another subscription to this customer" from Customer Details still showed a full Customer dropdown instead of using the already-known customer, which matters more now that Subscription Code depends on Customer; (2) the create/edit form let Start Date, Renewal Interval, and Renewal Date be filled in as three independent, potentially contradictory fields (e.g. a 60-month interval with a Renewal Date one day after Start Date).

**Customer selection, two modes**: `SubscriptionModal` now takes `lockedCustomer?: CustomerComboboxOption` instead of `defaultCustomerId?: string`. When present (opened from Customer Details, or from the Subscriptions page with a `?customerId=` in the URL), the Customer renders as a read-only `<strong>` — no dropdown, no re-selection — using that customer's real database id. When absent (Subscriptions page's own "+ Create subscription"), the modal renders the **existing** `CustomerCombobox` (`apps/web/components/customer-combobox.tsx`, already used by Legacy Import's Attach-Existing flow — reused as-is, no new component) wired to the same debounced `/customers?search=` pattern already established there, which already searches Customer Code, English name, and Arabic name server-side. The old `/customers?pageSize=500` fetch that powered the giant dropdown is gone entirely. `customer-detail.tsx` passes `lockedCustomer={detail}`-shaped data (id/customerCode/nameEn/nameAr it already has, zero extra fetch); `subscriptions-manager.tsx`'s `?customerId=` path now does one `/customers/:id` GET (not the list) to get that customer's label before locking it.

`customer-detail.tsx` also now deep-links the create modal onto its own URL (`?newSubscription=1` via `router.replace`, stripped on close) so a refresh while it's open reopens it with the same Customer context — `customerId` itself was already sourced from the route and already survived refresh on its own; this just makes the modal's open state survive too.

**One canonical calendar-month helper**: `addCalendarMonths(date, months)` added to `packages/shared/src/index.ts` — genuinely shared, imported by both the backend (`SubscriptionsService`) and the frontend (`subscription-modal.tsx`'s live preview), not two separate implementations of the same algorithm. Calendar-month arithmetic (not `months * 30 days`), UTC-only (date-only fields never shift by timezone), end-of-month clamped via the "day 0 of next month" trick (31 Jan + 1 month → last day of Feb, 28 or 29 depending on leap year — verified both).

**Backend enforcement, not just a UI convenience**: `CreateSubscriptionDto` no longer has a `renewalDate` field at all (same pattern as `subscriptionCode` — the global `whitelist:true` ValidationPipe rejects one if sent) and `renewalIntervalMonths` changed from optional to required. `SubscriptionsService.create()` always computes `renewalDate = addCalendarMonths(startDate, renewalIntervalMonths)` server-side — a caller cannot submit a contradictory combination because there is nothing to submit. `SubscriptionsService.update()` recalculates only when the caller intentionally changes `startDate` or `renewalIntervalMonths` (ignoring any `renewalDate` also present in that same request — the computed value always wins); when neither changes, an explicitly supplied `renewalDate` is still accepted as a direct historical correction, and when nothing at all is supplied, dates are left completely untouched — verified this doesn't silently corrupt a historical record where Start Date moves with no interval to recompute from (rejects via the existing `validateDates` check, now run against the *final* effective combination, not just what changed).

**Billing Frequency deliberately stays fully independent** — never read when computing Renewal Date; a dedicated parametrized test creates the same subscription under all six `BillingFrequency` values and asserts the Renewal Date is identical every time.

**Field semantics found by inspection (section 15/16 of the owner's spec), not guessed**:
- `renewalIntervalMonths` — already read by the existing (untouched) `cycleStartDate()` in `renewal-policy.ts`, working *backward* from `renewalDate` to compute a RenewalCase's `cycleStartDate`, falling back to a Billing-Frequency-derived month count only when null. This task's *forward* computation (Start Date + Interval → Renewal Date) is the natural complement of that existing backward one — fully compatible, confirmed via a test that feeds a freshly `create()`d subscription's derived `renewalDate` straight into the real, unmodified `cycleStartDate()`.
- `renewalDate` — the one field `RenewalEngineService` actually queries and reads (`ensureCase()`'s `dueDate: subscription.renewalDate`); nothing about its shape or type changed, only how `SubscriptionsService.create()` computes it — so the engine needed zero changes, confirmed by every existing engine test still passing untouched.
- `contractTermMonths` — a separate, "Historical contract term (months)" field on the form, referenced nowhere else in application logic; left completely alone, never equated with Renewal Interval.
- `currentTermEndDate` — already kept in lockstep with `renewalDate` by a pre-existing "Phase 2.2 transitional mapping" comment in `SubscriptionsService`; that lockstep behavior is preserved exactly, just now fed the *derived* value instead of a caller-supplied one.
- `billingFrequency` — independent business concept (how often billed) from Renewal Interval (when the term ends); the schema's `CUSTOM` value has no accompanying "custom billing frequency in months" field anywhere in the data model — a pre-existing gap, reported rather than invented into being, and explicitly out of this task's scope (the required "Custom" behavior was for Renewal Interval, not Billing Frequency).

**`ServicePackageTerm` (termMonths/currency/standardSellingPrice/standardSupplierCost)**: inspected — `SubscriptionModal` already fetches `servicePackage.terms` into its `PackageOption` type but has never actually read or displayed them anywhere in the form; this was true before this task too. Left exactly as-is (dead-but-harmless fetched data); no package/pricing redesign attempted, per explicit instruction.

**Legacy Import: confirmed untouched and unaffected.** It never calls `SubscriptionsService.create()` — `LegacyImportService.approveRow()` writes subscriptions directly via `tx.subscription.create()` with its own `renewalDate: subscriptionRow.currentTermEndDate ?? subscriptionRow.startDate` (source-workbook-derived) and its own pre-existing `contractTermMonths: subscriptionRow.renewalIntervalMonths` equation — neither of which this task's new DTO/service changes can reach, since the DTO changes only constrain the public `/subscriptions` HTTP contract. No Legacy Import file was modified.

**Editing historical subscriptions**: `renewalIntervalMonths: null` (predates this concept — some imports have it, some don't) makes the edit form fall back to the *old* two-independent-date-fields UI verbatim (Start Date + Renewal Date, both directly editable, no derivation attempted) rather than forcing every historical record through the new interval model. A subscription that *does* have an interval gets the same derived-date UX as create, but the frontend only includes `startDate`/`renewalIntervalMonths` in the PATCH body when the user actually changed them from the values the record loaded with — so opening Edit and only changing Selling Price sends neither field, and the backend's own "only recalculate when they're present" logic leaves the historical Renewal Date exactly as it was.

**Customer immutability on edit**: unchanged from the Subscription Code work — `UpdateSubscriptionDto` still has no `customerId` field, and edit mode still renders Customer as the same read-only `<strong>` it already did.

**Tests**: `apps/api/src/common/calendar-months.spec.ts` (new — the shared helper directly: 12/60/18-custom months, end-of-month non-leap and leap, multi-year rollover, "not months×30", timezone-independence). `subscriptions.dto.spec.ts` (new — `class-validator` `validate()` against `CreateSubscriptionDto`: rejects 0, negative, non-integer, and missing `renewalIntervalMonths`; accepts a valid payload with no `renewalDate` field). `subscriptions.service.spec.ts` gained: a `create()` Renewal Date derivation suite (12/60/18-custom/end-of-month/leap-year, plus the six-Billing-Frequency-independence parametrized test, plus the Renewal-Engine-compatibility test against the real `cycleStartDate()`); an `update()` Renewal Date handling suite (price-only edit preserves dates; Start Date change recalculates; Renewal Interval change recalculates; a caller-supplied conflicting `renewalDate` is ignored when start/interval also change; an explicit `renewalDate` is accepted as a historical correction when neither changes; Start Date moving past an untouched Renewal Date with nothing to reconcile it is rejected). `phase-1-services.spec.ts` and `phase21-subscriptions.service.spec.ts` updated for the new `CreateSubscriptionDto` shape (both now also assert the derived `renewalDate`, not just that the call succeeded).

Verified: `prisma validate` (no-op — no schema change), strict typecheck (all three packages: `@cp/shared`/`@cp/api`/`@cp/web`), lint (all three, zero warnings after the same established `react-hooks/set-state-in-effect` false-positive fix applied twice more), 264 tests / 54 suites (242 passed, 22 skipped — live-DB-only), both production builds (API `nest build`, web `next build` — same 16 routes). **No database migration** — confirmed not needed, per the owner's explicit expectation; `renewalIntervalMonths`/`renewalDate` already existed as the right shape. **Could not manually click through the UI in a browser** — no browser-automation tool is available in this session; this is disclosed rather than claimed as tested. Committed locally (`3824e36`), not pushed.

### 2026-09-09 (later same day, follow-up) — Owner asked for code-only verification of 3 specific properties; found and fixed a real gap

The owner correctly flagged that my manual test step assumed a specific current `NS0007` sequence
number, which I have no way to know without production DB access — corrected to describe the
*next* number relative to whatever `SubscriptionCodeSequence` state already exists, not a literal
example value. Then asked me to verify three things from code and tests only (no DB access needed):

1. **Legacy free-date mode is reachable only when editing an existing subscription with
   `renewalIntervalMonths: null`.** Confirmed by inspection: `subscription-modal.tsx`'s
   `hasIntervalModel = !editing || editing.renewalIntervalMonths != null` — the `!editing` short-
   circuit makes legacy mode structurally unreachable during create, regardless of any other state.
2. **A new manual subscription cannot be saved without a positive interval and a server-derived
   date.** Confirmed: `hasIntervalModel` is always `true` when `!editing`, so the frontend's
   pre-submit guard (`if (hasIntervalModel && (!startDateValue || !(effectiveIntervalMonths > 0)))`)
   always applies to create; and independently, authoritatively, `CreateSubscriptionDto` has no
   `renewalDate` field at all and requires a positive `renewalIntervalMonths`
   (`@IsInt() @Min(1) @Max(120)`, no `@IsOptional()`) — already covered by
   `subscriptions.dto.spec.ts`.
3. **An existing modern subscription cannot clear its interval to fall back into legacy mode —
   this one was actually FALSE before this fix.** `UpdateSubscriptionDto.renewalIntervalMonths` had
   plain `@IsOptional()`, and class-validator's `@IsOptional()` treats an explicit `null` exactly
   the same as "omitted" (skips the rest of the validator chain either way) — proved this concretely
   with a `validate()` test before touching any code, confirming `{ renewalIntervalMonths: null }`
   passed DTO validation with zero errors. Traced it further into `SubscriptionsService.update()`:
   `intervalChanged` becomes `true` (since `null !== undefined`), but the recalculation branch's
   `&& effectiveIntervalMonths` guard is falsy for `null`, so it's skipped — yet the raw
   `...subscriptionInput` spread (which still contains `renewalIntervalMonths: null` from the
   original request) flows straight into the Prisma `update()` call with nothing downstream
   overriding it, which would have written `NULL` to the column. **Fixed**: the field now uses
   `@ValidateIf((dto) => dto.renewalIntervalMonths !== undefined)` instead of `@IsOptional()` — a
   genuinely omitted field still leaves the existing value untouched (validation skipped, same as
   before), but an explicit `null` now runs `@IsInt()` against it and is rejected. Re-ran the exact
   same `validate()` test after the fix — now returns the expected validation error.

New tests in `subscriptions.dto.spec.ts` covering `UpdateSubscriptionDto.renewalIntervalMonths`
directly: omitted (passes), a positive value (passes), `0` (rejected), negative (rejected), and the
specific `null` case (rejected, proving the fix). Full API suite re-run: 269 tests / 54 suites (247
passed, 22 skipped), typecheck and lint clean. No web files changed in this round — the frontend
never sends `renewalIntervalMonths: null` (only a positive computed number, or omits the field
entirely), so this was purely a backend contract gap, now closed at the same layer.

### 2026-09-09 (later same day, second follow-up) — Owner's 5-property check found a second real gap: a modern subscription could still be given an arbitrary Renewal Date

The owner asked for code+test-only verification of 5 specific backend properties. Traced each one
through `SubscriptionsService.update()` by hand before writing anything:

1. A modern subscription (non-null `renewalIntervalMonths`) cannot have `renewalDate` independently
   set — **this was false.** `PATCH { renewalDate: '2099-01-01' }` alone (no `startDate`, no
   `renewalIntervalMonths`) hit the `else if (input.renewalDate)` branch unconditionally — it only
   checked whether *this request* changed start/interval, never whether the subscription *already
   had* an interval on record. A modern subscription's own existing interval was never consulted
   before accepting a direct override.
2. Start Date change on a modern subscription recalculates from the existing interval — confirmed
   already correct (existing test).
3. Renewal Interval change on a modern subscription recalculates from the effective Start Date —
   confirmed already correct (existing test).
4. Start Date and Renewal Interval both omitted, an unrelated field (price) changes → Renewal Date
   preserved exactly — confirmed already correct (existing test, using a *non-null* interval, i.e.
   already exercising the "modern" case despite its literal test name).
5. Only a subscription whose *stored* `renewalIntervalMonths` is null may use the legacy
   manual-date path — confirmed correct for the accept side (existing test); the reject side for a
   modern subscription was the same gap as #1.

**Fixed** with one condition change: `else if (input.renewalDate)` → `else if (input.renewalDate &&
!effectiveIntervalMonths)`. `effectiveIntervalMonths` already resolves to the *old* record's
interval when the request doesn't change it, so gating on it (rather than on "did this request touch
start/interval") is what makes the legacy-override path unreachable for any subscription that
already has an interval, regardless of what else a given request does or doesn't include. Comments
on both the DTO field and the service method updated to state this precisely instead of the
previous, incomplete "only used when the caller isn't also changing start/interval" description.

New test: seeded a modern subscription (`renewalIntervalMonths: 12`), sent `{ renewalDate:
'2099-01-01' }` alone, asserted the persisted `renewalDate` is `undefined` (Prisma's "leave this
column alone," not merely "not 2099"). Verified the test has real teeth the same way as every prior
round this session: reverted just the condition back to the buggy version in the mirror, re-ran,
confirmed the exact failure (`renewalDate` came back as `2099-01-01T00:00:00.000Z`), then restored
the fix and re-confirmed green.

**`UpdateSubscriptionDto` still declares `renewalDate?: string`** (unchanged) — it is not removed,
but per the above it is now a no-op for any subscription that already has a Renewal Interval,
covering both ways a request could try to use it (alongside a start/interval change, where the
recalculated value already won; and alone, where it's now ignored instead of accepted).

Full suite re-run: 270 tests / 54 suites (248 passed, 22 skipped), typecheck and lint clean. No web
changes — the frontend's interval-driven create/edit path never constructs a request shaped like the
one this test reproduces.

### 2026-09-09 (later same day, third follow-up) — Semantic hardening: nullish gate, and silent-ignore replaced with an explicit reject contract

Two changes, both to `SubscriptionsService.update()` and `UpdateSubscriptionDto`'s comments only:

1. **`!effectiveIntervalMonths` → `effectiveIntervalMonths == null`.** The owner pointed out the
   falsy check treats a stored `0` the same as `null`, which is wrong — `0` isn't a valid interval,
   but it also isn't "no interval," and the rule is specifically about null/absent. New test seeds a
   subscription with `renewalIntervalMonths: 0` (not producible by current DTO validation, but not
   impossible in already-existing data predating these rules) and confirms it does **not** enter
   legacy free-date mode.
2. **Silent-ignore replaced with an explicit reject.** The owner reconsidered the previous round's
   fix: a modern subscription (effective interval non-null) receiving an explicit `renewalDate`
   used to have that field silently discarded. Preferred contract instead:
   - modern + explicit `renewalDate` → `BadRequestException`, unconditionally (regardless of
     whether `startDate`/`renewalIntervalMonths` are also present in the same request)
   - legacy (`renewalIntervalMonths == null`, effective) + explicit `renewalDate` → accepted as
     before (unchanged)
   - modern + `startDate`/`renewalIntervalMonths` change, no `renewalDate` → derived as before
     (unchanged)

   The `update()` method now computes `isModern = effectiveIntervalMonths != null` once and branches
   on it directly: reject up front if modern and `renewalDate` is present at all; otherwise derive
   when modern and start/interval changed; otherwise (legacy) accept an explicit `renewalDate` as
   before. Two existing tests that asserted the old silent-ignore behavior were rewritten to assert
   rejection instead (`rejects.toThrow(...)`, and `expect(update).not.toHaveBeenCalled()` to prove
   the Prisma call itself never happens, not just that its result was discarded).

   **Confirmed by inspection, no frontend change needed**: `subscription-modal.tsx`'s `save()` only
   ever sets `body.renewalDate` in its `else` branch, which is reached exactly when
   `!hasIntervalModel` — i.e. only for a subscription that already has no interval (the legacy
   case). Both the create path and the interval-driven edit path never include `renewalDate` in the
   request body at all, so this backend change has no observable effect on the current UI.

Both changes verified to have real teeth the same way as every prior round: reverted each in the
mirror in turn, confirmed the exact expected test failures (a resolved promise where a rejection was
expected, showing the pre-fix persisted values), restored, re-confirmed green. Full suite: 271 tests
/ 54 suites (249 passed, 22 skipped), typecheck and lint clean.
