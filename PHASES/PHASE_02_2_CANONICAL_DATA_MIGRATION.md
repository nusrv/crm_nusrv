# Phase 2.2 — Canonical Data & Migration Finalization

Status: **code complete, tests pass, migration is additive and ready — not yet run against a live
database, and not yet deployed.** See "What's left for the owner" at the end of this document.

## 1. What this phase is

The owner completed an external data-cleaning and canonicalization exercise over the 214-row
legacy `Active_Subscriptions` workbook, producing an approved, pre-reviewed, multi-sheet
relational export:

```
CRM_Canonical_Import_v4_Approved_Phone_Corrections_2026-09-06.xlsx
```

That workbook is not raw legacy data — it is already a normalized relational model (`Customers`,
`Contacts`, `Phone_Channels`, `Email_Channels`, `Subscriptions`, `Subscription_Identifiers`
sheets), with its own `CRM_Import_Schema` sheet stating how each maps onto this application's
tables, and a `Review_Issues`/`Manual_Corrections` trail showing every phone-number problem was
already found and resolved by a human ("Import Gate = READY", 0 blocking issues). Phase 2.2's job
is to change the application/database so it can correctly represent and safely import that
approved dataset — not to redo the data cleaning itself.

## 2. Source-order rule

Customers and subscriptions must list in the order they first appeared in the original Excel
workbook, never alphabetically.

- `Customer.sourceSequence` (nullable `Int`) holds that order. The customer list's default
  `orderBy` is now `[{ sourceSequence: 'asc' }, { createdAt: 'asc' }, { customerCode: 'asc' }]`.
- Every customer always has a value: the canonical importer sets it explicitly from the
  workbook's `Customer_Order` column; `CustomersService.create()` (the manual "add customer" path)
  auto-assigns `MAX(sourceSequence) + 1` so newly created customers append after every imported
  one rather than sorting before them (MySQL sorts `NULL` first in `ASC` order, which would have
  put manually-created customers ahead of the legacy list — auto-assigning avoids that entirely).
  The migration backfills every existing customer's `sourceSequence` from `created_at` order so
  nothing is ever left `NULL`.
- `Subscription.sourceSequence` does the same for subscriptions, sourced from the workbook's own
  `Source_Sequence` column (backfilled the same way for existing subscriptions).

## 3. Customer identity / merge rules

Automatic merging is never performed by this application. `LegacyImportService.findDuplicates()`
only ever produces `duplicateCandidates` — a review signal shown to a human, who must explicitly
choose `CREATE_NEW`, `NOT_DUPLICATE`, or `ATTACH_EXISTING` before a row can be approved. This was
already true before Phase 2.2; it is unchanged and covered by a new test (`legacy-import.service
.spec.ts`: *"stages a canonical workbook: flags a shared email as a review signal without
auto-merging..."*) that proves a shared email against an existing live customer produces a
`REQUIRES_MANUAL_REVIEW` row with no `customerResolution` set — never a silent attach.

The canonical workbook's own merge decisions (`Customer_Merge_Audit`, `Relationship_Signals`
sheets) were made externally by the owner's review process using the conservative rule requested —
exact company identity or exact shared domain only, with shared phone/email explicitly excluded as
merge evidence. The importer trusts that already-made decision: it imports the workbook's
`Customers` sheet as given, one row per canonical customer, and only asks a human when *this
system's* separate duplicate check (against customers already live in the database) finds a
signal the external review didn't have visibility into.

## 4. Phone model

`CustomerPhoneNumber` already supported unlimited phone numbers per customer; Phase 2.2 adds the
remaining canonical fields, all additive/nullable:

| Field | Purpose |
|---|---|
| `contactId` (nullable FK → `CustomerContact`) | Which named person this number belongs to, if any |
| `phoneType` (`MOBILE`/`LANDLINE`/`FAX`/`PHONE`) | Matches the workbook's own type classification |
| `rawValue`, `country`, `areaOrOperatorCode`, `subscriberNumber`, `extension` | The decomposed parts, as the workbook already provides them |
| `verificationStatus` (`UNVERIFIED`/`VERIFIED`/`INVALID`), `verifiedAt` | Whether/when a human confirmed the number is real |
| `metadata` (JSON) | Normalization method, confidence, evidence text, source URL — kept as one flexible bag rather than five more scalar columns |

`CustomerEmailAddress` gained the same `contactId` link plus `verificationStatus`/`verifiedAt`.

## 5. Phone normalization rules

A new, independently-tested module, `apps/api/src/modules/legacy-import/phone-normalizer.ts`,
turns one raw free-text phone/fax cell into zero or more E.164 records. It never invents a missing
digit — anything it cannot confidently resolve is dropped, not guessed. Rules implemented (see
`phone-normalizer.spec.ts` for the exact worked examples, each taken from this phase's brief):

- **Jordan local mobile**: `0776222256` → `+962776222256`.
- **Two full numbers joined by "-"**: `0776222256 - 0745510473` → two independent records, never
  concatenated.
- **Shared fixed-line prefix**: `+962 6 5863101 - 5865712` → the short right-hand fragment
  inherits the left fragment's country/area code: `+96265863101` and `+96265865712`.
- **Shorthand "/"-suffix expansion**: `+962 6 5868440/1/2` → three records, each suffix digit
  replacing the last digit(s) of the base subscriber number.
- **Saudi formatting hyphens**: `0096650-055-9009` stays **one** mobile number
  (`+966500559009`) — the hyphens are pure formatting, not number separators, because neither
  fragment they'd produce is a complete number on its own.
- **Incomplete values**: `Fax: +9626` or `Fax: +` produce **no** phone record at all.

This module is currently wired into nothing but its own tests plus the manual-correction table
below — it exists to (a) prove the rules independently against the exact approved examples, and
(b) be the natural place to plug in when a *future, non-canonical* raw workbook needs multi-phone
splitting from free text. The canonical importer itself doesn't need it: the canonical workbook's
`Phone_Channels` sheet already carries the resolved `E164_Normalized` value directly, already
reviewed, so the importer reads that rather than re-deriving it.

## 6. Manually approved phone corrections

Encoded as an authoritative override table at the top of `phone-normalizer.ts`, checked before any
automatic parsing, and each covered by its own test:

| Legacy value(s) | Result |
|---|---|
| `+06477114466666` **and** `47901511318` (Sami Kashkol — two malformed values) | Both replaced by the single verified `+9647702987851` (Iraq, mobile) |
| `079821889` | Removed — not imported as a phone channel at all |
| `077332511` (Khalil Hdaib) | `+962797024222` |
| `+9626 65536165` | `+96265536165` (Jordan landline) |
| `07778448448` (Dr. Eyad Shahrouri) | `+962778448448` |

## 7. Contact model

New optional link only: `contactId` on both channel tables, pointing at the pre-existing
`CustomerContact` table. Nothing about `CustomerContact` itself changed. The legacy scalar fields
(`Customer.primaryEmail`/`secondaryEmail`/`phone`, `CustomerContact.email`/`phone`) are left in
place, populated for backward compatibility (existing reads, existing exports), but the normalized
channel tables are the source of truth for anything new. No destructive change, no removal.

## 8. Email channels

Already unlimited per customer before this phase (`CustomerEmailAddress`); now also linkable to a
specific contact the same way phone numbers are, with the same verification tracking.

## 9. Subscription model

Confirmed, not changed: one workbook row is one `Subscription` row, always. The canonical importer
enforces this directly — it stages one `LegacyImportRow` per row in the canonical `Subscriptions`
sheet (214 of them), never combining multiple services into one record.

## 10. Subscription dates

`Subscription.currentTermEndDate` (nullable `Date`) is new, and is what the workbook's `Current
Term End Date` / canonical `Current_Term_End_Date` column maps to. **Transitional mapping**,
documented here because it is easy to miss: the Phase 2 renewal engine still reads
`Subscription.renewalDate` for scheduling, and that field is *not* being renamed or removed in
this phase. Every write path (manual create/edit, the legacy importer, and the canonical importer)
now sets `currentTermEndDate` to the same value as `renewalDate` at write time, so the two stay in
lockstep. `currentTermEndDate` is the field future code should read when it means "when does the
current term end"; `renewalDate` remains, for now, the field the renewal engine's scheduling logic
actually consumes. The migration backfills `currentTermEndDate = renewalDate` for every existing
subscription so the field is never left blank on old data.

The legacy 14-day-before-end reminder value remains evidence only (`classificationEvidence
.sourceRenewalReminderDate` on the subscription, `Legacy_Reminder_Date` in the canonical sheet) —
it was never used as a contractual date and still isn't.

## 11. Financial authority

The canonical importer reads `Selling_Price_Original` and `Currency` directly from the canonical
`Subscriptions` sheet as the authoritative contract amount/currency — never the legacy `Price JD`
column, which the workbook itself documents as containing inconsistent historical FX conversions.
This mirrors the existing (already-shipped) rule for the flat single-sheet importer, which prefers
an explicit original-amount/currency signal over the legacy `Price JD`/`Price USD` columns. The
existing currency-conversion architecture is reused unchanged: `sellingPrice` and `currency` are
stored exactly as given, an active `Currency` row's rate is snapshotted into
`exchangeRateToJod`/`sellingPriceJod`/`exchangeRateEffectiveDate` at import/edit time, and every
read additionally recomputes a live JOD equivalent from the currency's current rate.

## 12. Paid labels

`Subscription.paidLabel` (nullable, short string) stores values like `PAID 2025` as legacy
evidence metadata only. Nothing in this phase turns a paid label into an invoice, a payment
record, or a collection transaction — Phase 3+ (Fawtara/collection) remains locked and untouched.

## 13. Subscription identifiers

Already a child-record model (`SubscriptionIdentifier`, many per subscription) before this phase;
unchanged. The canonical parser groups the workbook's `Subscription_Identifiers` sheet by
`Subscription_ID` and imports each distinct domain as its own identifier row — never a
semicolon-joined string.

## 14. Import idempotency

Two independent guarantees, both tested:

1. **Batch-level**: uploading the exact same workbook file twice is detected by its SHA-256 hash
   (`LegacyImportBatch.sourceFileHash`, unique) — the existing batch is reused, nothing is
   re-staged. This is the same mechanism the flat importer already used; the canonical importer
   uses it unchanged.
2. **Customer-level, across sibling rows**: the canonical workbook can (and does) have several
   subscription rows belonging to the same canonical customer. Each such row carries that
   customer's full contact/email/phone payload plus a stable reference,
   `{workbook filename}#Customers!{Customer_ID}`, written to `Customer.sourceLegacyReference`.
   `approveRow()` looks up an existing customer by that exact reference before creating one — so
   no matter which sibling row a human approves first, the customer (and its contacts/emails/
   phones) is created exactly once; every later sibling row finds and reuses it. Proven by a
   dedicated test that approves two rows sharing one canonical customer and asserts
   `tx.customer.create` was called exactly once.

## 15. Import traceability

Every imported record stays traceable to its source:

- `LegacyImportRow.sourceReference` = `{workbook}#Subscriptions!{Subscription_ID}` for canonical
  rows (vs. `{workbook}#{sheet}!{row number}` for the flat format).
- `Customer.sourceLegacyReference` = `{workbook}#Customers!{Customer_ID}`.
- `CustomerContact.sourceLegacyReference` = `{row sourceReference}#contact:{Contact_ID}`, which is
  how the importer maps a canonical `Contact_ID` back to the real database ID it was just given,
  immediately after creation — a plain-string lookup, no schema change needed.
- The full raw canonical row (subscription + its customer) is still encrypted and stored in
  `rawValuesCiphertext`, exactly as the flat importer already does, so nothing is lost even though
  the canonical data itself has already been cleaned once.

## 16. Import review UI

`apps/web/components/legacy-import-manager.tsx`:

- The "existing customer" selector no longer loads a flat `pageSize=100` page. The initial load
  now requests up to 500, and while `ATTACH_EXISTING` is selected a debounced search box re-queries
  `/customers?search=...&pageSize=50` as the reviewer types, so it stays usable regardless of how
  large the customer list grows.
- The subscription currency field is now a `<select>` sourced from `/currencies?active=true`
  (falling back to a clearly-labeled "not yet active" option if the row's own currency isn't
  configured yet), instead of free text.
- A read-only "canonical contact channels" panel now shows every email/phone a canonical row
  carries (with primary/holder-name annotations) inside the review form, so a reviewer can see
  the full multi-channel picture — not just the two legacy scalar fields — before approving. The
  underlying data is carried through the review form unchanged even if the reviewer edits other
  fields, so it is never silently dropped on submit.

## 17. Migration safety

`apps/api/prisma/migrations/20260906000000_canonical_phone_contact_and_source_order/migration.sql`
is purely additive: new columns (all nullable or defaulted), two new indexes, two new foreign keys
(`ON DELETE SET NULL`), and one column widen (`customer_phone_numbers.phone_number` `VARCHAR(16)`
→ `VARCHAR(20)`, headroom only — the existing E.164 `CHECK` constraint, capped at 15 digits, is
untouched and still enforced). No column is dropped, no existing migration file was edited, and
the backfill `UPDATE`s only ever fill currently-`NULL` values. Existing MariaDB migration-contract
tests continue to pass unchanged.

## 18. Verification performed this session

- `npm run db:generate`, `npm run typecheck`, `npm run lint`, and both production builds
  (NestJS + Next.js) all pass, across the whole workspace.
- Full test suite: **161 tests / 42 suites passing** (12 guarded live-MariaDB tests still skipped,
  as always, without a real database configured).
- New tests added this phase: `phone-normalizer.spec.ts` (12 tests — every rule and every named
  manual correction), `canonical-workbook.parser.spec.ts` (9 tests — source order, multi-phone per
  customer *and* per contact, multi-email, multi-domain identifiers, original-currency authority,
  `currentTermEndDate` vs. legacy reminder date, paid-label evidence), plus new/extended tests in
  `legacy-import.service.spec.ts` (sibling-row idempotency, no-auto-merge, multiple subscriptions
  sharing one canonical customer), `customers.service.spec.ts` (source-order default listing,
  auto-assigned sequence), and `phase21-subscriptions.service.spec.ts`
  (`currentTermEndDate` transitional mapping).
- **Structural dry run against the real approved workbook** (`CRM_Canonical_Import_v4_Approved
  _Phone_Corrections_2026-09-06.xlsx`), run through the actual parser and the actual reused
  classification engine — no live database was used or is available in this environment, so this
  validates parsing/classification/staging logic, not a live import:
  - Parsed counts matched the workbook's own README exactly: 124 customers, 214 subscriptions,
    374 phone channels, 205 email channels, 275 subscription identifiers.
  - Currency breakdown matched exactly: 177 JOD, 18 USD, 17 SAR, 2 EUR.
  - Package classification (via the reused engine) matched the historical baseline exactly: 85
    `MATCHED_OFFICIAL`, 72 `CUSTOM`, 57 `MANUAL_REVIEW`.
  - Resulting staging status: 85 rows would land directly at `READY_FOR_APPROVAL` (one-click
    approve), 129 at `REQUIRES_MANUAL_REVIEW` (unresolved package classification — the same 129
    rows this project has tracked since Phase 2.1, unrelated to Phase 2.2).
  - This dry run caught and fixed a real bug: the first draft fed the reused classifier a
    synthetic row with no date/interval fields, which made it falsely flag every single row as
    "missing Start/End Date" and "renewal interval requires confirmation" — silently forcing 100%
    of rows into manual review regardless of real data quality. Fixed by feeding the classifier the
    canonical sheet's own typed date columns and independently trusting its own
    `Renewal_Interval_Months` value; locked in with a new regression test.

## 19. What's left for the owner (staging/deployment — explicitly not done in this session)

1. Deploy per the usual runbook: `git pull`, `npm run db:generate`, `npm run db:migrate:deploy`
   (applies this phase's migration), `npm run build`, restart API/web/worker.
2. Upload `CRM_Canonical_Import_v4_Approved_Phone_Corrections_2026-09-06.xlsx` through Legacy
   Import once deployed — it will be auto-detected as a canonical workbook.
3. `USD`, `SAR`, `EUR` still need real rates in Currencies/Rates before any row priced in them can
   be approved (unchanged prerequisite from the previous currency-conversion phase).
4. Approve the 85 `READY_FOR_APPROVAL` rows (one click each), then work through the 129
   `REQUIRES_MANUAL_REVIEW` rows' package classification — this is the same outstanding human
   task Phase 2.1 already identified, not new work created by Phase 2.2.
5. This has not been run against a real MariaDB in this session — no staging/production database
   was available. Confirm the migration applies cleanly and the first canonical upload behaves as
   this document describes before relying on it for real data.

Phase 3 remains locked. Nothing in this phase touches SMTP/IMAP, Fawtara, AI/LLM, suspension, or
any other Phase 3+ scope.
