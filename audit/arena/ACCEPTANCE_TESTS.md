# ACCEPTANCE TESTS (none executed during this audit)

## P0-a Schema
- Fresh migration chain on disposable `_test` MariaDB succeeds; populated upgrade (historical invoices, messages, accepted renewals, branding) succeeds; `prisma generate` + strict typecheck pass incl. nullable `customerId/sourceSubscriptionId` callers.
- Live runner includes Slice G, Phase 4a/4b, multi-issuer specs.
## P0-b
- Tax: two distinct synthetic issuer/customer tax numbers → slot shows issuer only; no "Tax / National No." line; draft/official; Company/Personal issuers; A4 compare to `nusrv_invoice_latest_reference.pdf`.
- QR: 24-byte header, truncated, bad CRC, oversize dims/pixels, decompression bomb, wrong MIME → rejected at API; valid QR PNG accepted; DTO and validator limits aligned; read-only scan lists suspect historical rows without mutating.
- Mail fairness: 50 older human-approved rows under active hold + 1 newer eligible; batch 1 defers all (0 SMTP calls); clock past nextAttemptAt so all 51 are due after a late poll; batch 2 sends the newer row; claim before nextAttemptAt loses; stale PROCESSING reclaimable; SMTP retry also sets nextAttemptAt. Release a hold and verify delivery when the row becomes due.
- UI: Fulfil follows server eligibility and the approved OD-3 invoice prerequisite, if any. Unpaid, partially paid and paid cases are equally eligible when the other conditions are met. Only an explicit human action commits the tracking date.
- Session: a direct dashboard visit with missing access cookie and valid refresh recovers. Verify durable logout revocation and the revocation-write failure path, disabled-user refresh rejection, role reload, and required login at the earlier of configured expiry or the absolute 24-hour cap (fake clock).
## P0-c
- Seeded pending and abandoned-processing AI decisions: zero message/thread writes and zero live provider calls, with audited disposition on cutover; exercise scan and direct execution.
- No renewal reminder sends without recorded human approval; internal notification eligibility continues; JoFotara submission refused; renewal/payment paths trigger no external technical action (spies).
- Mixed-version rollout/rollback rehearsal with fake transports.
## P1
- Reminder: contact priority BILLING>PRIMARY>fallback, no TECHNICAL/MANAGEMENT; missing-contact warning+link; send idempotent under two concurrent identical requests (one row, same result); history/count/last sent; hold feedback.
- Replies: header, thread and case correlation, plus an unambiguous subject fallback only if separately approved, unread alert, open; markRead 404/409 for wrong case/outbound; four decisions from every legal source state incl. HUMAN_REVIEW; Keep in Review audited, no state change.
- Period: 12/24/36/60/custom months, month-end/leap clamp; acceptance does not touch renewalDate; fulfil CAS conflict path; legacy ACCEPTED recovery action audited.
- Invoices: create from accepted renewal (sourceRenewalCaseId set, idempotent); free invoice with null customer/subscription and no service period through list/detail/edit/official/print; empty-string line dates handled. BillingEntity is the issuer for Company and Individual types; internal codes generated or in Advanced settings; draft output exportable with no fabricated official number or QR.
- Payments: exact decimals, partial/multiple/full, overpayment rejected, concurrent payments, replay returns same payment with no revision change; PDF has no payment info. Records carry amount, currency, date, method, reference, notes, recorder, timestamp; operational views show UNPAID/PARTIALLY PAID/PAID.
- Receipts: disabled before invoice, enabled after, finalize requires payment, one per payment, concurrent create returns same receipt, no stamp. Action visible but disabled before an invoice exists.
## P2
- Modal: Save keeps open, X + Close, success feedback, nested stack restores parent; nav/labels/helper text; RBAC route+API checks; browser a11y keyboard/focus.
