# CLAUDE INDEPENDENT REVIEW (written BEFORE reading the Codex audit packet)

Baseline: HEAD `32013c2`, 22 tracked/untracked non-audit changed paths (hashes in `.baseline_file_hashes.txt`).
Method: **static analysis only**. `node_modules` and the generated Prisma client are absent, so NO test, build or typecheck was run. Every finding below is VERIFIED-BY-READING, not by execution.
Scope doc `docs/CURRENT_IMPLEMENTATION_SCOPE.md` read in full (29 numbered sections, 1432 lines).

## 1. Scope digest
Mandatory now: human-sent reminders (§6), contact resolution BILLING>PRIMARY>primary-email (§7), reply linking + unread notification (§8), human decisions Accept / Do Not Renew / Needs Clarification / **Keep in Review** (§9), proposed period computed on accept but committed only on human *Mark Renewal Fulfilled*, payment never blocks fulfilment (§2,§10), Create Invoice from accepted renewal (§11), free/manual invoice (§12), manual-first official recording (§14), Sales Tax No. = issuer tax (§17), no extra "Tax / National No." line (§17), payments ledger w/ exact decimals (§18), receipts button visible-but-disabled before invoice (§19), 24h session via refresh (§4).
Prohibited/deferred: AI operations (§3), JoFotara real calls (§14,§26), Plesk/SmarterMail (§26), auto suspension/renewal.
Ambiguous: see §6 of this file.

## 2. Findings (my own, independent)

| ID | Finding | Class | Evidence |
|----|---------|-------|----------|
| I-01 | Schema.prisma adds `Payment`, `PaymentReceipt`, `Invoice.sourceRenewalCaseId`, nullable `customerId/sourceSubscriptionId`, `RenewalCase.proposed*`, `CommunicationOutbox.manualApprovedBy`, `EmailMessage.reviewedAt/By` — **none have a migration** (grep of `prisma/migrations` finds only an unrelated `reviewed_at` in phase3_slice_a). Code reading these columns fails on any DB built from migrations. | VERIFIED | `git diff apps/api/prisma/schema.prisma`; latest migration `20261118020000_multi_issuer_invoice_branding` |
| I-02 | `isManualQrImage` PNG branch accepts any ≥24-byte buffer with PNG signature + non-zero 4-byte values at offsets 16/20. No IHDR chunk-type check, no IDAT/IEND, no decode. A 24-byte synthetic header passes. JPEG checks only SOI+EOI bytes; WebP only RIFF/WEBP tags. | VERIFIED (static) | `apps/api/src/modules/invoices/manual-qr.ts` |
| I-03 | Mail worker starvation: `findMany` orders by `scheduledAt asc, id asc`, `take 50`; `deferToQueued` leaves `scheduledAt` unchanged and only sets `lastError`. 50 persistently-deferred rows (hold, bad mail config, no recipient) permanently occupy the window. | VERIFIED (static) | `mail-outbound.service.ts` ~L160-170, L463-470 |
| I-04 | Renderer prints `Sales Tax No.: {customerTaxNumberSnapshot}` (L102) – contradicts scope §17. Same file L60 prints `Tax / National No. {issuerTaxNumberSnapshot}` under issuer — expressly prohibited by §17 too (conditional on `visible.taxNumber`). | VERIFIED | `apps/web/components/invoice-renderer.tsx:60,102` |
| I-05 | UI still gates `mark-fulfilled` to `PAYMENT_CONFIRMED` while backend now allows ACCEPTED/INVOICE_DRAFT/COLLECTING/PAYMENT_CONFIRMED→FULFILLED. Nothing sets PAYMENT_CONFIRMED any more → button can never enable. | VERIFIED | `apps/web/components/renewal-case-detail.tsx:119-122` vs `renewal-transition-policy.ts` |
| I-06 | **No web UI at all** for the new backend capabilities: grep of `apps/web` finds no caller of `reminder-preview`, `send-reminder`, `needs-clarification`, `/replies/:id/read`, payments, receipts. §6 Prepare Reminder / Send Email, §8 notification, §9 decisions, §18-19 payments/receipt buttons are backend-only. | VERIFIED (absence by grep) | grep over `apps/web` |
| I-07 | **"Keep in Review" has no implementation anywhere** (no endpoint, no UI, no grep hit for keep-in-review). Also `HUMAN_REVIEW → HUMAN_REVIEW` is not a legal transition (HUMAN_REVIEW predecessors = UPCOMING/REMINDER_CYCLE/AWAITING_CUSTOMER), so `needs-clarification` called from a case already in HUMAN_REVIEW is rejected. §9 requires Keep in Review. | VERIFIED | `renewal-transition-policy.ts`, grep |
| I-08 | **"Create Invoice from accepted renewal" (§11) is not implemented server-side**: `Invoice.sourceRenewalCaseId` exists in schema and `RenewalCase.invoices` is included in reads, but no non-spec code writes `sourceRenewalCaseId`. | STRONGLY SUPPORTED (grep for writer = none) | grep `sourceRenewalCaseId` |
| I-09 | Fulfilment hazard for legacy ACCEPTED cases: `markFulfilled` requires `proposed*` columns; cases accepted before the change have them null → 409 "Accept and review the proposed period first", with no recompute action and ACCEPTED→ACCEPTED illegal. | STRONGLY SUPPORTED | `renewal-cases.service.ts` markFulfilled |
| I-10 | Reminder engine hardcodes `customerReminderAutomationEnabled()` = false (compliant with §6). Worker also cancels any customer-audience outbox lacking `manualApprovedBy` (`human_approval_required`) — good: legacy queued automated reminders cannot go out. But cancellation is permanent for legacy rows (no operator-visible reason beyond lastError). | VERIFIED (positive) | engine diff, `mail-outbound.service.ts` |
| I-11 | Human-approved sends bypass `resolvePrimaryRecipient` (`row.manualApprovedBy ? {email: row.recipient}`) and `send()` accepts any syntactically valid `recipient` from the request body — not required to equal the §7-resolved contact. Bounce/suppression/hold logic on that path is not verified by me. | HYPOTHESIS (policy: recipient override is owner decision) | `manual-renewal.service.ts`, mail diff |
| I-12 | AI: resolver forces `enabled:false` and `autoRouteAcceptEnabled:false`; classification, drafting, enqueue all check `enabled`. BUT `AiRoutingService.processBatch` still selects PENDING/stale-PROCESSING **HUMAN_REVIEW** routing decisions regardless of `enabled`, and `executeHumanReviewRouting` writes `classificationStatus=HUMAN_REVIEW` on messages and `status=HUMAN_REVIEW` on threads. Historic AI-originated rows can still mutate state while AI is "disabled". Impact is low (flags towards human review, never accepts/rejects). | VERIFIED (static); severity Low-Medium | `ai-routing.service.ts` L79-90, L361-382 |
| I-13 | Auth: `JwtStrategy.validate` trusts token claims; no DB check per request. Access TTL capped at min(config,900s,remaining session) — so role removal/disable takes ≤15 min to bite, refresh is blocked immediately for disabled users and re-reads roles. Scope §4 requires only: silent refresh, logout revocation, disabled-cannot-refresh, expired-requires-login, roles re-evaluated *during refresh*. **All five are met in code; immediate access-token revocation is NOT a scope requirement.** Absolute 24h cap now enforced (not sliding). | VERIFIED; classification: owner-decision/hardening, not scope violation | `auth.service.ts`, `jwt.strategy.ts` |
| I-14 | Payments only recordable when invoice is `FAWTARA_ACCEPTED`, reconciled and not locked (`payments.service.ts record`). Scope §19 says receipt action becomes available once "an invoice exists" and §18 describes payments as independent. Draft invoices can never take payments. Interpretation gap → owner decision (see §6). Also every payment bumps `invoice.revision`, which can spuriously fail concurrent revision-guarded invoice operations. | HYPOTHESIS / owner decision | `payments.service.ts` |
| I-15 | Test harness: `scripts/run-mariadb-integration.mjs` lists 10 live specs (phase 0–3 slice e); later phases (3 slice f/g, 3.1, 4a/4b, multi-issuer) not included. | VERIFIED | script |
| I-16 | Cosmetic/encoding: reminder subject literal `Renewal confirmation ? name` (a `?` where a dash was intended; likely encoding loss). Subject is the primary fallback correlation text. | VERIFIED, Low | `manual-renewal.service.ts` |
| I-17 | Reminder history/count/last-sent (§6) is not exposed by `ManualRenewalService` (only `lastCustomerContactAt` touched); status does not visibly transition to AWAITING_CUSTOMER on send within this service. Could be in worker; not traced. | HYPOTHESIS | `manual-renewal.service.ts` |

## 3. Things verified as GOOD
- Fulfilment transaction compare-and-set on `subscription.renewalDate = dueDate` and audited with `trackingOnly:true`.
- Payment idempotency key, exact BigInt millis arithmetic, overpayment rejected, append-only, `onDelete: Restrict`.
- Manual official invoice path exists; `submit-official` explicitly refuses real JoFotara.
- `Invoice.customerId` made nullable supports free/manual invoice (§12) but needs a manual-customer snapshot check (not traced).

## 4. Not examined / limits
Frontend modal-stack (§20), navigation (§22), status labels (§23); receipts renderer; Plesk/SmarterMail adapters; RBAC matrix; no runtime execution of anything.

## 5. Coverage honesty
Files actually read by me: ~20 (scope doc, schema diff, 12 changed API files, renderer lines, migrations list, mail service sections, AI routing/classification sections). Behaviors traced across components: reminder send→outbox→worker eligibility; accept→fulfil; refresh/session. Behaviors tested: none.

## 6. Ambiguities needing owner decision
1. Recipient override on manual reminder (I-11).
2. Whether payments / receipts may be recorded against non-official (draft/ready) invoices (I-14).
3. Immediate access-token revocation (I-13) – not required by §4.
4. Whether `Needs Clarification` should be a distinct state vs. HUMAN_REVIEW alias (I-07).
5. Whether fulfilment requires an invoice to exist (policy now permits fulfilment from ACCEPTED directly).
