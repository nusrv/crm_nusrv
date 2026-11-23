I agree that the missing-access-cookie redirect is a **Medium–High §4 defect** and belongs in P0-b. A valid refresh session cannot recover a direct dashboard visit when `cp_access` is absent because the proxy redirects before the app can refresh. Browser restart is one way to reach that state. The branch is statically confirmed, and browser behavior remains untested. `apps/web/proxy.ts:3–11`, `auth.controller.ts:27–32,43–46,75–76`, `apps/web/lib/api.ts:5–26`.

This round was read-only. I modified no files and ran no application, browser, or database tests.

### D1 — MODIFIED

**Adopt:** “Recommend PNG-only for new manual QR uploads, subject to owner approval and a check of representative official QR exports. Reuse `pngjs` for CRC-checked raster decoding. Bound encoded bytes, decoded file bytes, width, height, total pixels, and decompression resource use. Require the operator to compare the image with the externally issued document. Inventory suspect historical records read-only and preserve the original evidence and current access pending an approved correction policy.”

The 45,000-byte cap limits compressed input. It gives no bound on expanded pixels or memory use. The branding validator is a reuse precedent, but its dimension limits are not automatically appropriate for QR uploads. Also align the API limits. At the nominal binary maximum, Base64 alone consumes 60,000 characters before the data-URL prefix, so the DTO rejects that boundary first. If the owner needs JPEG or WebP, use a bounded decoder for those formats. Structural headers and visual confirmation alone leave malformed image data admissible. QR-symbol scanning is a separate decision. `manual-qr.ts:3–23`, `invoices.dto.ts:155–158`, `invoice-branding.service.ts:14–32`.

### D2 — MODIFIED

**Adopt:** “Add nullable, indexed `CommunicationOutbox.nextAttemptAt`. Preserve `scheduledAt` and the lease token. Use the same due predicate in candidate selection and in the atomic claim, with the claim also matching `id`.”

```text
scheduledAt <= now
AND (
  (status = QUEUED AND (nextAttemptAt IS NULL OR nextAttemptAt <= now))
  OR (status = PROCESSING AND lastAttemptAt < staleBefore)
)
```

Order queued candidates by `COALESCE(nextAttemptAt, scheduledAt)`, stale candidates by lease expiry, and break ties by `id`. Defer under the existing lease, set a future `nextAttemptAt`, and consume zero SMTP attempts. Define the timestamp on every return to `QUEUED`, including bounded SMTP retries. This gives retry time a single meaning. Ordering by effective due time also lets waiting work progress after a late poll when all 50 deferred rows are due again. Copying the operator-reply worker’s 60-second delay alone would be insufficient because renewal mail itself polls every 60 seconds. `mail-outbound.service.ts:157–167,314–324,463–468,696–715`, `mail-queue.service.ts:21–26`, `operator-reply-outbound.service.ts:304–310`.

**Acceptance fixture:** Seed 50 older, human-approved customer reminders on active holds and one newer eligible row. Batch 1 defers all 50 with zero SMTP calls. Advance the clock past their retry time so all 51 are eligible for selection. Batch 2 must process the newer row. Also assert that a direct claim before `nextAttemptAt` loses, stale `PROCESSING` work remains reclaimable, and releasing a hold allows delivery when due. Use fake SMTP and a disposable MariaDB for the claim and concurrency checks.

### D3 — AGREED

| Severity | Findings |
|---|---|
| High | A-01, A-02, A-05, SC-02 |
| Medium–High | A-03, dashboard session recovery |
| Medium | A-04 and A-06 with owner decisions, A-07, SC-01, payment replay, A-08 through A-13 |
| Low–Medium | Mark Read truthfulness |
| Low | A-14 |

Keep confidence labels independent of severity. A-07’s concurrent failure remains probable, and A-12 remains a performance hypothesis. A-03 stays in P0-b, and SC-01 stays in P0-c. A-04 covers stale signed authority. Required logout and refresh behavior stays in P0-b regardless of the owner’s revocation decision. `CODEX_INITIAL_REPORT.md:62–66,74–122`, `auth.service.ts:156–169`.

### D4 — MODIFIED

Keep OD-1 through OD-8 with these amendments and additions.

| ID | Text to publish |
|---|---|
| OD-1 | Which recipient overrides are allowed, who can approve them, and what happens if an approved contact changes before delivery? |
| OD-2 | Which privileged actions require fresh authorization, and how quickly must revocation take effect? |
| OD-3 | Does fulfillment require an invoice to exist or to be officially recorded? Payment status cannot gate fulfillment. |
| OD-4 | At which invoice stages may payments be recorded, and which receipt numbering, correction, or void rules apply if needed in this release? |
| OD-5 | How does Needs Clarification move through review and human send? Is unread shared or per operator, and does Keep in Review clear it? |
| OD-6 | Do customer-reminder holds block human sends, and who may override a hold if overrides are allowed? |
| OD-7 | What evidence may an operator use to reconstruct a legacy proposal when the term or original tracking date is missing or has changed? |
| OD-8 | Which QR formats must new uploads support, is machine-readable verification required, and how may historical evidence be corrected? |
| OD-9 | Should closing the browser end the session even when the refresh session is valid? Default to §4 recovery while refresh remains valid. Keep access-cookie persistence a technical choice within the short access-token lifetime. |
| OD-10 | Should deferred AI diagnostics be hidden, inert, or separately authorized? This plan uses no live provider calls. |
| OD-11 | Confirm missing tax inputs and the approved print variants for company and personal issuers. Preserve current billing-entity isolation unless the owner explicitly changes it. |
| OD-12 | Who can authorize resend after an uncertain SMTP outcome, and what evidence is required? |

OD-10 through OD-12 preserve open decisions already in the matrix. OD-9 should not hold up the missing-cookie fix. A dashboard entry can attempt the existing refresh flow before redirecting, with protected data still behind API authentication. A persistent access cookie alone would leave the missing-cookie branch unresolved. `SCOPE_COMPLIANCE_MATRIX.md:130–137`, `CURRENT_IMPLEMENTATION_SCOPE.md:179–211,1263–1291`.

### D5 — MODIFIED

**Adopt this sequence.**

- **P0-a — Schema and verification baseline.** Add and rehearse migrations on fresh and populated disposable MariaDB, regenerate Prisma, and repair nullable-field types and affected callers. Add existing Slice G, Phase 4, and branding live specs to the guarded runner. Maintain `PROJECT_STATUS.md` as each slice lands. `run-mariadb-integration.mjs:9–24`, `schema.prisma:1480–1516,1692–1715`.
- **P0-b — Independent fixes.** Correct the issuer tax slot and remove the extra issuer tax line. Implement the QR gate and mail fairness. Remove the payment gate from the Fulfill UI and align it with server eligibility. Fix dashboard session recovery and verify durable logout, expiry, disabled-user rejection, and updated roles on refresh. These changes can proceed in parallel. `CURRENT_IMPLEMENTATION_SCOPE.md:179–211,461–473,803–851`.
- **P0-c — Cutover proof.** Block AI routing at scan and direct execution, with an audited disposition for historical work. Prove human-only customer renewal mail, continued internal notification eligibility, manual-only JoFotara recording, and no external technical actions. Verify mixed-version API and worker rollout and rollback with fake transports. `CURRENT_IMPLEMENTATION_SCOPE.md:47–55,135–171,265–307,631–667,1299–1319`.
- **P1 — Complete the operator flows.** In Renewals, deliver deterministic preview, contact priority and missing-contact link, explicit send with hold feedback, Waiting for Customer, repeat reminders, sent history/count/date, and reply linkage, unread alert, and direct open. Provide all four human decisions and truthful Mark Read. Verify the proposed period across standard and custom terms, the audited legacy proposal action, and the human-only tracking-date commit. `CURRENT_IMPLEMENTATION_SCOPE.md:219–519`.
- **P1 — Complete finance end to end.** Create invoices from accepted renewals with `sourceRenewalCaseId`, the approved proposal, and known customer, issuer, subscription, service or domain, price, currency, tax, and branding snapshots. Make repeated creation requests safe. Provide both §12 entry points. Prove a one-time customer invoice with null `customerId` and `sourceSubscriptionId` through list, detail, edit, official recording, and print. Complete manual officialization, reconciliation, draft and official PDFs, and payment replay without invoice revision churn. Keep payment state and history in operational views. Provide a separate receipt based on the existing template, without the original stamp, with the action visible but disabled before an invoice exists. Enable the action once an invoice exists and require a recorded payment to finalize each receipt. `CURRENT_IMPLEMENTATION_SCOPE.md:481–967`, `invoices.controller.ts:48–58`, `payments.service.ts:41–62`, `payment_receipt_template.html:141`.
- **P2 — Finish mandatory UX before scope sign-off.** Apply §20 modal behavior to the P1 screens as they are built, then verify it across existing screens. Complete §21 progressive disclosure, §22 simpler RBAC-preserving navigation and grouped Settings, §23 human-readable statuses, and §24 short helper text for retained fields such as Billing Entity, Renewal Interval, and Technical Mapping. Verify actual A4 output against the latest NUSRV reference and receipt fixtures. Finish CI, Compose loopback, recovery evidence, and measured performance checks. P3 remains deferred pending explicit owner authorization. `CURRENT_IMPLEMENTATION_SCOPE.md:743–795,975–1255,1299–1319`.

### New findings

- **Nullable customer and subscription IDs are insufficient for a free invoice.** Invoice-level service periods are required by the schema, editor, and preflight. The editor also serializes blank optional line dates as empty strings, which the date DTO cannot accept. Include a one-time invoice with no applicable service period in acceptance, and handle date pairs consistently across storage, editing, preflight, and print. `schema.prisma:1498–1500`, `invoice-detail.tsx:135–150,403–415`, `invoices.dto.ts:65–71`, `invoice-preflight.service.ts:136–149`.
- **Renewal-mail SMTP retries have the same ordering weakness for a bounded interval.** A retryable SMTP failure returns the row to `QUEUED` with its old schedule, allowing old failing messages to consume several batches before exhausting their attempts. The D2 design covers this path as well as holds and unusable mailboxes. `mail-outbound.service.ts:157–167,696–715`.

### Sign-off and unresolved items

**Ready for joint engineering sign-off with these amendments.** The owner retains the policy decisions in OD-1 through OD-12, approval of official document examples and historical correction policy, and authorization to push or deploy. Release acceptance still requires the migration rehearsal, concurrent claim and payment checks, browser session recovery, and actual invoice and receipt print verification.