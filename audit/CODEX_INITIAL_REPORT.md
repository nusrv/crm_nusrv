# Codex initial assessment

## Executive summary

Retain the modular monolith. It already has durable financial snapshots, scoped issuer configuration, transactional audit events, and delivery recovery mechanisms that would be expensive to reconstruct. The current working tree is a partial policy transition and is unsuitable for deployment. The most important actions are to build a coherent release around the human-only workflow, reject invalid official QR images, correct the tax number binding, and eliminate outbox starvation. The audit found concrete high-severity issues. It did not verify a critical compromise or a production incident.

## Product and architecture

The owner requires a control, communication, invoice, collection, and tracking system. Humans confirm sends and renewal decisions. An accepted renewal proposes dates and a separate human fulfillment action updates CRM tracking regardless of payment. Invoices may come from an accepted renewal or be entered manually. Official issue happens externally and the operator records the number and graphical QR. Payments and receipts are their own history. Technical service execution, AI decisions and JoFotara API submission are out of the current workflow. Older directions for automatic reminders, payment-gated fulfillment or technical suspension do not govern the target release.

The software is an npm workspace with a Next/React operator UI, Nest API, independently supervised Nest/BullMQ worker, and shared TypeScript contracts. MariaDB/Prisma holds authoritative state. Redis coordinates jobs. No separate financial or communication service is required by the observed architecture. Representative surfaces include:

| Capability | Committed baseline evidence | Current-tree delta |
| --- | --- | --- |
| Customer and subscription operations | CRUD, billing entity and stable customer/subscription codes, structured channels, service catalog, currency and staged legacy import. Technical connection endpoints manage metadata. | No replacement of core records. |
| Renewal and messaging | Renewal engine, holds, rules, internal escalation, renewal outbox and operator reply outbox. IMAP persists messages with UID and header correlation. AI classification and routing are available when configured. | Scheduler and worker start enforcing human approval for renewal customer messages. New compose and reply-review APIs and fulfillment logic are unfinished as an operator workflow. |
| Invoicing | Subscription-based draft snapshots, cancellation, separate official values, reconciliation, issuer branding versions, manual recording, and gated JoFotara API with history and explicit uncertain recovery. | API submission controller rejects requests. Preflight begins moving to manual-first. Free/manual or renewal-linked invoice creation paths are missing. Current screens still include API submission and assume a subscription. |
| Payments and receipts | No implemented ledger or receipt models at HEAD. | Draft schema and services contain append-only payment intent, exact units and a per-payment receipt concept. No migration, printable receipt renderer or complete operator path was identified. |
| Identity | Argon2, signed short access JWTs, hashed refresh sessions, HttpOnly token cookies, app-wide JWT and route-role guards. | Shared browser API client starts a single retry after refresh. Backend begins imposing an absolute ceiling. There is no audit run of the integrated session flow. |

The invoice and branding relationships retain immutable assets and restrict deletion of referenced issuers and submissions. Connection selection is issuer-scoped and a nullable unique key plus CHECK constrains the active default. Invoice money uses scaled integer arithmetic. These are favorable controls. Preserve them with the expected audit history, tenant/issuer boundaries already enforced, immutable invoice source values, customer/subscription code rules, IMAP deduplication, stable mail identity, and legal renewal transitions. The record shows internal role-based access. It does not establish that each billing entity constitutes a separate staff-access tenant.

API boot uses Helmet, credentials-enabled CORS with configured web origin and a DTO whitelist. Origin checks and cookie flags reduce exposure, but an origin-less request is permitted and bearer access is supported. Secret encryption uses AES-256-GCM, and audit redaction walks nested sensitive keys. Those controls do not replace redacted DTOs, careful free-text logging, key recovery procedures or end-to-end RBAC tests. Liveness/readiness probes check the API, MariaDB and Redis. Mail has health outcomes, cursor and lease recovery, and safe exception mapping in selected paths. No production effectiveness or full observability coverage is implied.

## Finding register

**Confirmed** means direct source proof or a local non-destructive check. **Probable** needs a test or operational observation. **Hypothesis** needs evidence before remediation is required. **Improvement** is optional. Severity refers to potential impact under the stated conditions and is independent of confidence. Paths and lines are relative to the audit-start working tree unless marked HEAD.

### A-01 · Release completeness and workflow authority · High · CONFIRMED

**Evidence.** The current `apps/api/prisma/schema.prisma:610–618,885–887,1062–1065,1480–1495,1692–1717` contains new fields and payment tables. Git shows no matching migration change. `apps/api/src/modules/invoices/invoices.service.ts:319–346,750–755,784` passes the newly nullable subscription ID to string-only helpers. This is a static mismatch under the generated nullable contract. The audit did not compile it. `apps/api/src/modules/invoices/invoices.controller.ts:32–54` defers API issuance and only creates from subscription, while `apps/web/components/invoice-detail.tsx:244,541–575` assumes a source subscription and offers API issuance. The renewals table has no compose or reply-review wiring at `apps/web/components/renewal-cases-manager.tsx:524–545`. HEAD still queues scheduled customer mail (`renewal-engine.service.ts:179–240`), permits configured AI behavior (`ai-settings-resolver.service.ts:58–63`), exposes the gated JoFotara submission path (`invoices.controller.ts:32–46`), and gates fulfillment on payment-confirmed state (`renewal-transition-policy.ts:68`).

**Impact and verification.** Deploying the local source against the committed schema would leave the new columns and tables absent. Releasing only the old build preserves incompatible policies if enabled. Neither statement establishes production flags. Compare `git diff`, tracked migration paths, and HEAD through `git show`. In authorized local verification, regenerate the client, check contracts, and exercise all entry points with fakes.

**Remediation and acceptance.** Ship coordinated API/worker/web controls with additive migration and explicit effective capability readouts. Rehearse old queued reminders, existing accepted cases, nullable invoice sources, and process transition order. Prove zero automatic customer sends, AI workflow calls and JoFotara calls using fake transports, while internal evaluations, authorized reminders and stored history continue. Prevent rollback from restoring forbidden automatic behavior.

### A-02 · Invalid raster accepted as official QR · High · CONFIRMED, locally reproduced

**Evidence.** `apps/api/src/modules/invoices/manual-qr.ts:3–23` checks signatures and selected fields, without decoding pixels or checking for a QR symbol. `invoices.service.ts:531–578,925–932` accepts this predicate during manual recording and later treats a nonempty stored image as part of final-print eligibility. Compared against HEAD, the QR helper is unchanged.

**Safe reproduction.** Run this synthetic, dependency-free Node check from the repository root. It returns `true`. The data contains no PNG chunk structure or image pixels.

```js
const { isManualQrImage } = require('./apps/api/src/modules/invoices/manual-qr.ts')
const b = Buffer.alloc(24)
Buffer.from('89504e470d0a1a0a', 'hex').copy(b)
b.writeUInt32BE(1, 16)
b.writeUInt32BE(1, 20)
console.log(isManualQrImage('data:image/png;base64,' + b.toString('base64')))
```

**Impact and remediation.** An input can satisfy the official QR gate but produce a broken final document. Dimensions and pixel count should be bounded before decoding. Reject malformed, truncated and unsupported formats, validate a decodable QR to the extent the business approves, and let the operator visually verify provenance. Decodability cannot authenticate a tax document. Preserve existing accepted invoice records. Provide a controlled correction path if historical images fail validation. Test valid and invalid image families, decompression bounds, printable rendering and historical compatibility.

### A-03 · Deferred renewal mail can starve eligible rows · High · CONFIRMED, static proof

**Evidence.** `apps/api/src/modules/mail/mail-outbound.service.ts:122,157–167` selects the oldest 50 due rows. At `:365–411,449–468`, temporary failures such as disabled mailbox or an active hold return rows to QUEUED without moving their scheduled time or setting a next eligible attempt. The scheduler can keep selecting the same 50 indefinitely.

**Impact and verification.** A backlog of 50 indefinitely deferred rows can prevent newer eligible customer reminders and internal notifications from progressing. No occurrence in production was observed. A safe acceptance fixture uses a fake transport, zero real networks, 50 older blocked rows, and one later eligible message. Tick batches before and after reconfiguration.

**Remediation and regression risks.** Implement a persisted, indexed next-attempt time with reason-specific delay or promote the existing scheduling field only if its historical meaning is preserved. Keep original schedule, cutover logic, identity pinning, lease ownership, retries and no-attempt-on-defer. Measure oldest eligible age per mailbox. Require progress for eligible work and bounded latency after unblock. See **A-11** for ambiguous send outcomes.

### A-04 · Access authorization stale until token expiry · High · CONFIRMED, static proof

**Evidence.** `apps/api/src/identity/jwt.strategy.ts:9–41` trusts signed user/role claims and does not consult session or user state. `roles.guard.ts:11–18` authorizes with those claims. `auth.service.ts:122–165` checks active/revoked state on refresh and revokes refresh on logout. `auth.controller.ts:53–63` clears cookies on the normal browser path. Already issued valid access tokens remain effective until expiry. This is the baseline design and the local work has not changed the strategy. HEAD has no silent browser refresh (`HEAD:apps/web/lib/api.ts:12`). Local changes add it at `apps/web/lib/api.ts:5–26`.

**Impact and remediation.** Revocation and role removal have a residual window for in-flight or retained credentials. No stolen token or bypass was observed. Decide whether high-impact writes require fresh session/role lookup and cap all access lifetimes. Prefer a session identifier and targeted revocation checks over a new identity provider. Test expiry, single refresh per concurrent browser burst, logout, user disable, role downgrade, multi-tab behavior, and absolute 24-hour expiry with a fake clock. If requiring immediate revocation, test server-side rejection even when an old access token is still cryptographically valid. Preserve authorized CLI integration only where supported.

### A-05 · Sales Tax No. displays buyer identifier · High · CONFIRMED, static proof

**Evidence.** `apps/web/components/invoice-renderer.tsx:60–65,102` renders the issuer identifier below the address and the customer identifier in the designated right-side Sales Tax No. slot. The owner specifies the issuer field in that slot. The latest reference has priority. This is a presentation defect independent of any tax-law interpretation.

**Impact and remediation.** An official-looking PDF can show a misleading identifier. Bind the slot to `issuerTaxNumberSnapshot`, preserve customer tax data in the invoice record, and remove the duplicate issuer line. Test two distinct synthetic IDs, legal visibility, official/draft, Future and personal issuers. Compare rendered browser print output to the reference. Preserve existing snapshot and QR gates.

### A-06 · Recipient override lacks recorded policy exception · High · CONFIRMED for behavior, policy decision open

**Evidence.** The working-tree preview selects active BILLING or PRIMARY contacts and falls back to existing address resolution (`apps/api/src/modules/renewal-cases/manual-renewal.service.ts:19–33`). Send requires that some default recipient exist, but persists any syntactically valid submitted recipient (`:10,39–60`). The mail worker uses the stored address for human-approved rows (`mail-outbound.service.ts:401–406`). This supports operator editing. It does not establish that the address belongs to the customer or that an override was separately reviewed. The working-tree subject marker is required in outbound mail, but the committed inbound correlator does not parse it (`mail-inbound-correlation.service.ts:33–74,209–265`).

**Impact and remediation.** An accidental cross-customer address can disclose service details. Define the acceptable override boundary with the owner and document how an operator confirms it. Reconcile normalized email channels and structured contacts when correlating replies. Preserve mailbox and sender checks. A readable subject token can be a constrained hint, never sole authorization. Test customer boundaries, removed contacts, any permitted exception, exact reviewed payload, duplicate requests and wrong or missing header fallback. No evidence of actual misdelivery.

### A-07 · Retry races in draft human workflows · Medium · PROBABLE

**Evidence.** Manual reminder send reads the idempotency key before acquiring the case lock (`manual-renewal.service.ts:39–61`). Receipt creation reads the existing receipt and then inserts under the unique `paymentId` (`apps/api/src/modules/invoices/payments.service.ts:45–60`, `schema.prisma:1709–1715`). Neither path shows conflict recovery. By contrast `apps/api/src/modules/communications/operator-reply.service.ts:154–166` distinguishes unique races and retriable transaction conflicts. The constraints protect uniqueness, but the loser may get an uncaught Prisma error rather than the same result. Actual MariaDB interleaving was not run.

**Remediation and acceptance.** Define replay equivalence and recover by bounded, targeted retries or conflict lookup after rollback. Keep authorization and payload comparison. Verify two simultaneous identical reminders or receipt requests produce one record with stable results. Different payloads with the same key should receive a clear conflict.

### A-08 · Local Compose publishes infrastructure ports · Medium · CONFIRMED configuration, exposure unverified

**Evidence.** `compose.yaml:2–22` publishes DB and Redis ports without a loopback bind. Redis has no auth configured in this manifest. This file is for local development. Actual interface reachability depends on runtime and firewall.

**Remediation and acceptance.** Bind dev ports to loopback or omit host publishing when callers are in the project network. Keep production infrastructure isolated. Verify resolution with disposable local Compose and document overrides for legitimate local tooling. No network scan was conducted.

### A-09 · Modal behavior and operational vocabulary remain inconsistent · Medium · CONFIRMED, static evidence

**Evidence.** `apps/web/components/modal.tsx:10–50` lacks dialog semantics, focus management and stack coordination. Customer, currency and billing entity save handlers close forms (`customers-manager.tsx:179–180`, `currencies-manager.tsx:60–61`, `billing-entities-manager.tsx:65–66`). `app-shell.tsx:16–80` treats administrative pages as peers of daily work. The renewal row displays raw status codes (`renewal-cases-manager.tsx:524–534)).

**Remediation and acceptance.** Introduce an accessible shared dialog and preserve parent state with explicit nested behavior. Use friendly labels in the workspace and an authorized settings hub. Verify keyboard interaction, focus return, save and repeat behavior, parent filters/scroll, and direct unauthorized route/API access. A browser audit is still needed.

### A-10 · Release verification and operating evidence are incomplete · Medium · CONFIRMED audit gap

**Evidence.** Root `package.json` defines lint/typecheck/build/tests and `apps/api/package.json` defines Jest and a separate MariaDB run. The latest checked-in verification files are historical. No tracked repo-local CI workflow was found. `docs/deployment/PHASE_02_PLESK_STAGING_RUNBOOK.md:4–8,232–249` describes staging through older phases and code rollback conditional on compatible schema. No tested current release manifest, restore result, SCA result, or worker SLO evidence was in audit scope.

**Remediation and acceptance.** Bind required checks and migration rehearsal to a revision and artifact. Review current vulnerabilities against deployed package paths in an authorized environment. Test DB and secret restoration, worker start and liveness, and compatible rollback. No severity assertion about individual current advisories without verification.

### A-11 · Ambiguous SMTP success may cause duplicate delivery · Medium · CONFIRMED design limit

**Evidence.** `apps/api/src/modules/mail/mail-outbound.service.ts:107–118,249–282` documents and implements separate transport and commit boundaries. Stable Message-ID and claims reduce duplicates without eliminating the crash window. `renewal-case-detail.tsx:93` labels the queue date as the send date. New manual compose writes `lastCustomerContactAt` when queued (`manual-renewal.service.ts:51`).

**Remediation and acceptance.** Distinguish queued, accepted by SMTP, failed and uncertain states. Treat duplicate prevention as one logical send per key and use a deliberate policy for ambiguous transport outcomes. Add delivery-event timing. Test crash after SMTP acceptance and lost final state using fakes. No claim of mailbox delivery or exactly-once SMTP.

### A-12 · Upcoming renewal scan may grow poorly at peak · Medium · HYPOTHESIS

**Evidence and next check.** `renewal-engine.service.ts:95–150,320–355` loads the upcoming set and processes rows serially while overdue enrollment is batched. The cost depends on volume, indexes and predicates. Use synthetic skew, query plans and runtime metrics before choosing a batching/index change. Require stable date boundaries, complete evaluation and no duplicate escalation after interruption.

### A-13 · Stored capability flags can diverge from effective mode · Medium · CONFIRMED configuration gap

**Evidence.** The local `ai-settings-resolver.service.ts:58–63` makes operational AI flags false. `ai-settings.service.ts:106–137,177–203` still persists enablement and allows test transport independent of runtime classification. `ai-settings.controller.ts:33–42` exposes test and discovery to ADMIN. The existing UI also displays issuance settings even though local invoice submission is blocked. No provider was called.

**Remediation and acceptance.** Represent deferred operational capabilities explicitly in settings and worker state. Keep retained settings and history. Separate a policy decision about diagnostic access from operational enablement. Run spies across public and worker entry points and demonstrate deferred status is clear to all roles.

### A-14 · Invoice list payload is broader than the table needs · Low · IMPROVEMENT

At `apps/api/src/modules/invoices/invoices.service.ts:34–42,77–87,907–923`, list reads hydrate lines and spread the invoice record into its output, including fields intended for detailed finance work. Use an explicit list projection if profiling or access review justifies it. Confirm field needs of existing clients and preserve restricted details. A list/detail contract test should demonstrate omitted blobs and correct totals and status.

[Baseline and limitations](PROJECT_BASELINE.md) · [Plan and acceptance gates](CODEX_IMPLEMENTATION_PLAN.md)
