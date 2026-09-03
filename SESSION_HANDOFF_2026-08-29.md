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
