# Phase 2.1 package and legacy-classification rules

Status: owner-approved implementation policy. Phase 3 remains locked.

## Authoritative sources

- `dont_push_to_git/Project20report20Filled.xlsx` is the untouched legacy source. It is never edited in place or committed.
- `dont_push_to_git/Packages.docx` is the authoritative list of offered packages and catalog prices.
- Catalog prices are reference prices. A subscription's actual selling price and supplier cost remain independent historical facts.

## Evidence precedence

Classification is deterministic and evidence-based:

1. Explicit technical facts in the row's Information field.
2. Exact official package name and a compatible technical specification.
3. Source package label.
4. Source Registration Type as a hint only.
5. Price and term as supporting evidence only; neither changes package identity by itself.

A conflicting registration value never overrides stronger technical evidence. The original registration value and every rule result are preserved.

## Outcomes

- `MATCHED_OFFICIAL`: one catalog package is supported without contradictory evidence.
- `CUSTOM`: the record is demonstrably outside an official offer and a human selects the matching service-specific Custom template.
- `MANUAL_REVIEW`: evidence conflicts, multiple services appear bundled, a required value is missing, or more than one package remains plausible.
- `UNCLASSIFIED`: no review decision has been recorded.

Automated staging may suggest an outcome. It must not silently reclassify, split, merge, attach, or approve a subscription. Only an authorized human review can create live records.

## Dates and terms

- The workbook column labelled `Renewal / date (-15days)` is retained as source evidence and is not silently promoted to the normalized renewal date.
- Start date, confirmed renewal date, and incomplete financial values require human confirmation.
- Supported standard term choices are 12, 24, 36, and 60 months.
- An explicit custom interval from 1 through 120 months is allowed and stored as `renewalIntervalMonths`.
- Package and term snapshots preserve what was sold even if the catalog later changes.

## Structured contacts and identifiers

Multiple customer contacts may be retained with PRIMARY, BILLING, TECHNICAL, MANAGEMENT, or OTHER roles. Subscription identifiers are typed as DOMAIN, HOSTNAME, MAIL_DOMAIN, SERVER_ACCOUNT, or OTHER. Source text remains traceable.

## Audit and approval

Package changes, subscription classification changes, contact/identifier changes, legacy corrections, duplicate resolutions, and approvals are audited. Review metadata includes source registration, evidence, warnings, selected package, and the acting user. Migration and import approval are idempotent.
