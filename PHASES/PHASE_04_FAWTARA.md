# Phase 4 — Manual-first Invoice & Jordan JoFotara Integration

## Current scope and sequencing

Phase 4 is split into safe sub-phases. By owner decision, real Mail/AI end-to-end acceptance is
deferred and invoice work for existing ACTIVE subscriptions is the current business priority.
Phase 3 behavior is not connected to invoices in Phase 4A.

### Phase 4A — Manual-first invoice foundation (implemented)

An ADMIN or ACCOUNTANT can now follow this human-controlled flow:

1. Open an ACTIVE Subscription and select **Create Invoice**.
2. Review/edit the persisted DRAFT snapshot and invoice lines.
3. Run **Validate / Preflight**.
4. Mark the invoice `READY_FOR_FAWTARA` only when every blocking check passes.
5. Issue/finalize the invoice manually outside the CRM in JoFotara.
6. Record the authoritative official number, UUID when available, official QR payload/image,
   acceptance time, and official totals when supplied.
7. View and print the locked final customer invoice using the recorded official values.

Invoice creation is deliberately manual and is permitted only from an ACTIVE Subscription, with a
second server-side status check. It is not triggered by a renewal case, customer email, AI intent,
scheduler, queue, or background worker.

## Snapshot and financial-record rules

- An Invoice is not a live Subscription view. Customer, issuer, service/package, identifier,
  commercial, currency, and service-period data are copied into persisted Invoice/InvoiceLine
  snapshot fields at creation.
- Later Customer, Subscription, Package, price, exchange-rate, or address changes cannot silently
  change an existing invoice.
- DRAFT line and invoice totals are recalculated deterministically on the server with decimal-safe
  arithmetic. Browser totals are never trusted.
- Tax category/rate is intentionally blank on initial creation unless reliable configured tax data
  exists. Phase 4A does not infer 0%; explicit human review is required before readiness.
- One Subscription may generate invoices over multiple service periods. A nullable unique active
  draft key prevents concurrent DRAFT/READY duplicates for the same Subscription and period without
  making `sourceSubscriptionId` globally unique.
- Source Customer, BillingEntity, and Subscription relations cannot be switched after creation.
- Financial history uses `ON DELETE RESTRICT`; application deletion flows also block Customer or
  Subscription deletion whenever invoice history exists. No Invoice delete API is exposed.

## Lifecycle and authorization

- `DRAFT`: editable snapshot/lines; never an official tax invoice.
- `READY_FOR_FAWTARA`: server preflight passed; a human considers it ready for external issuance.
- `FAWTARA_ACCEPTED`: a human recorded accepted official metadata; invoice is locked.
- `FAWTARA_REJECTED`: a rejection/message was recorded; an explicit audited action can return it to
  DRAFT for correction.

Every creation, draft update, readiness/correction transition, rejection, and officialization is
recorded as an AuditEvent with actor and old/new state. Invoice endpoints are restricted to
`ADMIN`/`ACCOUNTANT`; no AI or worker authority exists.

## Preflight

The server returns structured machine-readable and human-readable PASS/FAIL results for customer
information, issuer/Billing Entity, invoice date, currency, invoice lines, service period, explicit
tax treatment, persisted line arithmetic, invoice totals, and locally required JoFotara data.

This preflight validates CRM snapshot completeness and arithmetic. It explicitly does not claim
complete UBL 2.1 or JoFotara compliance. `READY_FOR_FAWTARA` is blocked while any check fails.

## Manual official JoFotara bridge

Phase 4A stores manual results using the official response vocabulary (`EINV_STATUS`, `EINV_NUM`,
`EINV_INV_UUID`, `EINV_QR`, message/result evidence). `SUBMITTED` or `ALREADY_SUBMITTED` is required
for manual acceptance; HTTP status alone is never treated as acceptance.

After acceptance, recorded official number/UUID/QR and any supplied official totals/taxes/currency
are authoritative. The final renderer uses them instead of recalculating from the current
Subscription. Any difference from the CRM draft is surfaced and audited rather than silently
reconciled. The CRM never manufactures or regenerates an official QR.

The A4 HTML/print renderer is canonical for this sub-phase. Before acceptance it displays
**DRAFT / NOT OFFICIAL**. After acceptance it renders the recorded official identity, totals, and QR
image when provided. Browser Print / Save PDF is used; no heavy PDF dependency was added.

## JoFotara integration boundary (non-sending)

Phase 4A defines `FawtaraInvoiceMapper`, `FawtaraGateway`, and `FawtaraSubmissionResult` boundaries,
with the local `InvoicePreflightService` kept separate from future UBL/API validation. It registers
no sending adapter and performs no network request. No JoFotara secret or credential is stored by
this implementation.

The future gateway must preserve BillingEntity isolation: each invoice's immutable issuer
relationship selects that BillingEntity's own configuration/credentials. A Future Foresight
invoice must never resolve New Serve credentials or vice versa.

## Phase 4B — deferred real API integration

Before any real submission is implemented:

1. Reconfirm the current official Jordan Income and Sales Tax Department specification from
   `istd.gov.jo`, including the complete UBL 2.1 mapping, authentication, response, QR/reference,
   correction, and cancellation rules. Do not invent XML fields.
2. Add encrypted, BillingEntity-scoped JoFotara configuration and test-connection support without
   logging `Secret-Key`, `Client-Id`, or raw auth headers.
3. Implement and fixture-test the proven UBL mapper.
4. Add an idempotent submission attempt/outbox model and bounded retry/error queue.
5. Implement a non-production adapter and acceptance tests for both BillingEntities, including
   credential-isolation and the rule that HTTP 200 is not success unless `EINV_STATUS` says so.
6. Only then enable a production adapter through an explicit owner-approved cutover.

Emailing invoices, renewal/AI-triggered invoice creation, collection, payment records/receipts, and
Telegram notifications remain later phases. A payment receipt domain is not part of Phase 4A.
