# Phase 3.1 — Administration & Integration Settings

## Objective

Phase 3 delivered the backend communication/AI engine (SMTP/IMAP, Microsoft OAuth2, AI
classification, AI routing, suggested replies). It did not deliver an owner/admin operational
control plane: every routine Mail/AI operational change required environment variables, SSH/Plesk
access, or an application restart. Phase 3.1 completes that control plane — an ADMIN can now
configure, test, enable/disable, and change Mail and AI operational settings entirely from the CRM
UI, with no restart, for routine changes.

This phase does not change renewal business rules (only replaces static env-var config lookup with
dynamic DB-backed lookup at the exact same decision points), does not add AUTO REJECT, does not
start Phase 4, and does not touch Invoice/Fawtara/payment/technical-suspension/MCP.

## Correction pass (2026-09-23) — "effective truth" fix

The initial Phase 3.1 implementation kept several env vars runtime-authoritative
(`MAIL_SEND_ENABLED`, `MAIL_SEND_CUTOVER_AT`, `IMAP_SYNC_ENABLED`) without stopping to explain the
exception, as AGENTS.md/the Phase 3.1 brief required — and, more seriously, left a real bug: the
worker's actual `LLM_GATEWAY`/`MAIL_TRANSPORT` DI selection still keyed off `AI_PROVIDER`/
`MAIL_SEND_ENABLED` at process boot, so Settings could display "AI enabled, provider OpenAI, Test AI
succeeds" or "Outbound sending ON" while the real runtime silently used a mock gateway/transport —
the exact contradiction Phase 3.1 exists to prevent. This correction pass:

- Removed `AI_PROVIDER`-based (and any env-based) mock/real selection from the AI DI graph entirely.
  `DynamicLlmGateway` (`llm-provider.module.ts`) resolves provider/model purely from
  `AiSettingsResolverService` on every call and has no `ConfigService` dependency at all — it is
  architecturally incapable of reading an env var. `AiSettingsService.test()` resolves through the
  exact same `AiSettingsResolverService`, so a successful Test AI is proof the runtime would use
  that same configuration, not a coincidentally similar check.
- Removed `MAIL_SEND_ENABLED`/`MAIL_SEND_CUTOVER_AT` from `MailOutboundService`/
  `OperatorReplyOutboundService` entirely, and removed `IMAP_SYNC_ENABLED` from
  `MailInboundIngestService.syncAll()`. The per-mailbox DB switches
  (`outboundSendEnabled`/`outboundSendCutoverAt`/`inboundSyncEnabled`) are now the ONLY operational
  authority for mail sending/syncing — exactly as AGENTS.md's "DB state is authoritative" principle
  requires, with no second, env-based gate layered invisibly on top.
- Found and fixed the same class of bug one layer deeper: `worker-app.module.ts`'s `MAIL_TRANSPORT`
  factory-provider ALSO consulted `MAIL_SEND_ENABLED` (in addition to `SMTP_MODE`) to choose between
  the mock and real SMTP transport at boot — meaning even after the service-level fix above, an
  unset/`false` `MAIL_SEND_ENABLED` would still have silently forced every send through the mock
  transport regardless of `MailConfiguration.outboundSendEnabled`. Fixed by extracting the
  adapter-selection logic into `deployment-mail-capability.ts`
  (`resolveSmtpAdapterCapability`/`resolveImapAdapterCapability`), which reads `SMTP_MODE`/
  `IMAP_MODE` ONLY, and using it both for the worker's real DI selection and for the CRM's read-only
  effective-status reporting (`IntegrationHealthService`) — so the two can never disagree.
- See the "Infrastructure vs. operational settings boundary" and "Legacy env vars" sections below
  for the corrected, final state.

## Infrastructure vs. operational settings boundary

Two categories of configuration now exist, and this boundary is intentional and load-bearing:

**INFRASTRUCTURE (remains environment-based — a one-time deployment decision, never a routine
admin action):**

- `NODE_ENV`, `DATABASE_URL`, Redis connection, JWT secrets, `ENCRYPTION_KEY_BASE64`, ports/URLs,
  CAPTCHA infra secrets.
- `SMTP_MODE` / `IMAP_MODE` — the ONE retained infrastructure-capability concept, after the
  correction pass above. These decide which ADAPTER CLASS is wired into the DI container at process
  boot (mock vs. real `SmtpMailTransport`/`ImapMailboxReader`), exactly mirroring the existing
  `FAWTARA_MODE`/`PLESK_MODE`/`SMARTERMAIL_MODE` precedent for every other external integration in
  this codebase (AGENTS.md §6: "use mock/sandbox adapters until explicit production credentials are
  configured"). This is a structural safety rail, not an operational toggle: it must survive even a
  Settings-UI bug or a misconfigured admin session, so a brand-new/staging/demo environment can
  never be flipped into attempting real Outlook network calls by anything short of a deliberate
  deployment change. Unlike the pre-correction design, this is the ONLY infra-level mail gate, it is
  never combined with any other env var to decide adapter selection, and its EFFECTIVE state is
  surfaced read-only in Settings → Integration Health (`IntegrationHealthService`,
  `deployment-mail-capability.ts`) rather than kept invisible — an ADMIN can always see whether a
  DB-enabled mailbox will actually be able to send/sync for real.
- AI has **no equivalent infra-level gate at all** — `DynamicLlmGateway` always resolves against
  `AiSettingsResolverService`; there is no mock/real DI switch for AI to expose.

**OPERATIONAL (now fully DB-backed, admin-managed, restart-free — and, after the correction pass,
the ONLY authority of any kind for these decisions):**

- MAIL: per-mailbox authentication type/credentials, SMTP/IMAP host/port/secure, inbound
  sync enable/disable, outbound send enable/disable, outbound send cutover, connection tests,
  health. `MAIL_SEND_ENABLED`/`MAIL_SEND_CUTOVER_AT`/`IMAP_SYNC_ENABLED` are deprecated/parsed-only
  (see Legacy env vars below) and are never read by `MailOutboundService`,
  `OperatorReplyOutboundService`, `MailInboundIngestService`, or the worker's DI wiring.
- AI: enable/disable, model, API key, confidence threshold, automatic-ACCEPT enable/disable,
  automatic-ACCEPT cutover, connection test, health. `AI_ENABLED`/`AI_PROVIDER`/`AI_MODEL`/
  `AI_API_KEY`/`AI_CONFIDENCE_THRESHOLD`/`AI_AUTO_ROUTE_ACCEPT`/`AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT` are
  all deprecated/parsed-only. These seven legacy env vars are no longer read anywhere in the runtime
  AI pipeline; the DB row (`AiSettings`) is the sole and complete source of truth.

## Schema (additive only — see migration `20260923000000_phase3_1_admin_settings`)

- `MailConfiguration` gained three columns, all defaulted OFF: `inbound_sync_enabled BOOLEAN
  DEFAULT false`, `outbound_send_enabled BOOLEAN DEFAULT false`, `outbound_send_cutover_at
  DATETIME NULL`.
- New table `ai_settings`: one admin-managed GLOBAL row (`singleton BOOLEAN UNIQUE DEFAULT true` —
  a DB-enforced at-most-one-row constraint), `enabled`, `provider` (fixed to `'OPENAI'` for V1),
  `model`, `confidence_threshold`, `api_key_ciphertext`, `auto_route_accept`,
  `auto_route_accept_cutover_at`, timestamps.
- No historical data touched. No existing MailConfiguration/AiClassification/AiRoutingDecision row
  reinterpreted. Empty `ai_settings` table = AI fully disabled (never inferred, never an error).

## Mail settings

- `MailSettingsService`/`MailSettingsController` (`GET/POST /settings/mail`, `PATCH
  /settings/mail/:id`) — CRUD over `MailConfiguration`, GLOBAL or `BILLING_ENTITY:<id>` scope only
  (matches the existing resolver's supported scopes; no invented multi-mailbox behavior).
- BASIC and MICROSOFT_OAUTH2 authentication, named form controls (mailbox address, password /
  tenant+client+secret) — no raw JSON credential box. Blank secret on edit = keep existing; explicit
  `clearCredentials` flag required to remove it; switching auth mode requires the matching new
  credential material.
- `POST /settings/mail/:id/test-imap` opens a real IMAP connection (via the same
  `ImapMailboxReaderFactory`/`MicrosoftOAuthTokenProvider` production code uses) and reads only
  `getMailboxState()` (UIDVALIDITY/UIDNEXT) — never advances a sync cursor, never creates an
  EmailMessage.
- `POST /settings/mail/:id/test-smtp` calls nodemailer's `verify()` through
  `SmtpMailTransport.verify()` (new method, reusing the exact same auth-resolution code as `send()`)
  — authenticates without transmitting any message.
- `GET /settings/health` (`IntegrationHealthService`) aggregates SMTP/IMAP/AI latest health from the
  existing `IntegrationHealthEvent` log — no competing health model introduced. Corrected by §3: it
  also reports, per mailbox per channel, `configured` / `operationallyEnabled` (the DB switch) /
  `deploymentAdapter` (`REAL`/`MOCK`, via `SMTP_MODE`/`IMAP_MODE`) / `effective`
  (`READY`/`NOT_CONFIGURED`/`DISABLED`/`BLOCKED_BY_DEPLOYMENT`) — computed from, and never
  independent of, the same three inputs, and read via the identical
  `resolveSmtpAdapterCapability()`/`resolveImapAdapterCapability()` helpers the worker's real DI
  selection uses, so Settings can never display a readiness state the worker cannot actually
  deliver.

## Dynamic mail runtime (§D, corrected by §2A/§2B)

`MailConfigurationResolverService.resolveForOutbound()`/`resolvePinned()` require
`outboundSendEnabled === true` and (for ordinary reminder sends only) `outboundSendCutoverAt` to be
set and reached, resolved fresh on every call. `OperatorReplyOutboundService` requires
`outboundSendEnabled` but explicitly opts out of the cutover check (`{ checkCutover: false }`),
preserving its own pre-existing, already-tested contract that a cutover must never strand a
human-authored reply. `MailInboundIngestService.syncAll()` filters candidate configs on
`inboundSyncEnabled: true`. These DB flags are the ONLY operational authority — `MailOutboundService`
no longer has any global env-level enablement/cutover gate at all (no `ConfigService` dependency),
and `MailInboundIngestService.syncAll()` no longer checks `IMAP_SYNC_ENABLED`. Turning a mailbox's
sync/send on or off, or changing its cutover, takes effect on the very next scheduled cycle — no
restart, and with no env var anywhere that could override or duplicate it.

Separately, `worker-app.module.ts`'s `MAIL_TRANSPORT`/`MAILBOX_READER_FACTORY` DI factories decide
which ADAPTER CLASS (mock vs. real) the worker uses at all, via `SMTP_MODE`/`IMAP_MODE` only (see
`deployment-mail-capability.ts`) — this is the one remaining infrastructure-capability layer, and it
is now the ONLY thing `MAIL_SEND_ENABLED` used to also (wrongly) gate.

## AI settings

- `AiSettingsService`/`AiSettingsController` (`GET/PATCH /settings/ai`, `POST /settings/ai/test`) —
  upsert semantics onto the one singleton row.
- API key is write-only; the API only ever returns `apiKeyConfigured: boolean`. Blank on update =
  keep existing; explicit `clearApiKey` required to remove it.
- Server-side, independent of the browser: AI cannot be enabled without a configured model and API
  key; Auto Accept cannot be enabled without AI enabled and a valid cutover — enforced in
  `AiSettingsService.update()` regardless of what the UI already checked.
- `POST /settings/ai/test` makes exactly one minimal raw OpenAI request (never through
  `AiClassificationService`/`LlmGateway.classifyIntent()`/`draftReply()`) — creates no
  AiClassification, no AiRoutingDecision, sends no email, mutates no RenewalCase. It resolves
  model/API key through the exact same `AiSettingsResolverService` `DynamicLlmGateway` uses at real
  classification time, so a successful Test AI is a direct proof that "the runtime would use this
  same OpenAI configuration" — there is no separate mock/real DI wiring for AI to be independent of.

## Dynamic AI runtime (§J)

`AiSettingsResolverService` is the one place every AI-side consumer resolves current settings, fresh
per call: `AiClassificationService`, `AiClassificationEnqueueService`,
`AiClassificationWorker`'s recovery scan, `AiRoutingService`, `OpenAiLlmGateway` (which now
reconstructs its OpenAI client per call instead of caching it forever, so a rotated API key or
changed model takes effect immediately). The Slice G execution kill switch, cutover protections, and
historical-message protections are all preserved exactly — `AiRoutingService.processOne()`'s
pre-claim peek still checks the switch before claiming a PENDING `AUTO_ACCEPT` decision, and the
frozen `AiRoutingDecision.action` snapshot is never reinterpreted when settings change. One
correctness fix made necessary by the threshold becoming mutable at runtime:
`AiRoutingService.executeAutoAccept()`'s defensive invariant check no longer re-compares
`AiClassification.confidence` against the *current* threshold (that comparison already happened,
correctly, at classification time and is frozen into `finalStatus`); it now checks only the
genuinely immutable fields (`direction`, `requiresHumanReview`, `intent`).

## Security

Every credential (SMTP/IMAP password, Microsoft client secret, OpenAI API key) uses the existing
`SecretEncryptionService` — no second cryptography system. None of them, nor their ciphertext, is
ever returned from an API response, logged, or included in an audit `oldState`/`newState`/
`metadata` — `AuditService.record()`'s existing `sanitizeAuditValue()` redacts any key matching
`/password|secret|token|credential|api.?key/i` recursively as defense in depth, on top of the
settings services never assembling such a payload in the first place. `authMode`/
`credentialsConfigured` are derived by decrypting only long enough to read the non-secret
discriminant, immediately discarding the rest.

## RBAC

ADMIN: full read/write on both Settings surfaces (create/update Mail configuration, replace/clear
credentials, enable/disable inbound/outbound, test IMAP/SMTP, configure/enable/disable AI, configure
Auto Accept, test AI). IT: read-only on both (`GET` only), matching the existing
`TechnicalConnectionsController` ADMIN+IT viewing precedent — never write/test access. Every other
role: no access. Enforced via the existing `@Roles()`/`RolesGuard` mechanism; see
`settings-rbac.spec.ts`.

## Audit

`settings.mail.created` / `settings.mail.updated` / `settings.ai.created` / `settings.ai.updated`,
each with `oldState`/`newState` (both from the same secret-free serialized view returned to the
browser) and safe `metadata` (`credentialsChanged`, `authModeChanged`, `autoRouteAcceptChanged`).
Connection-test outcomes are recorded as `IntegrationHealthEvent` rows (SMTP/IMAP via the existing
`MailHealthService`/`MailImapHealthService` anti-flood dedup pattern; AI via the existing
`AiHealthService`), not as a separate audit event type.

## Startup/worker safety

No `MailConfiguration` row, no `AiSettings` row, missing credentials, AI disabled, inbound disabled,
outbound disabled — every one of these is an ordinary, already-handled "nothing to do" path, not a
startup dependency. `AiSettingsResolverService.getSettings()` returns safe all-disabled defaults
when no row exists; `MailInboundIngestService`/`MailOutboundService`/`OperatorReplyOutboundService`
already treated "no usable configuration" as a normal, non-fatal outcome before this phase, and
continue to.

## Legacy env vars — complete list and status (corrected)

| Env var | Status |
|---|---|
| `MAIL_SEND_ENABLED` | **Deprecated / parsed-only.** No longer read by `MailOutboundService`, `OperatorReplyOutboundService`, or the worker's `MAIL_TRANSPORT` DI factory. `MailConfiguration.outboundSendEnabled` (DB) is the sole operational authority. |
| `MAIL_SEND_CUTOVER_AT` | **Deprecated / parsed-only.** No longer read anywhere. `MailConfiguration.outboundSendCutoverAt` (DB) is the sole cutover authority for reminder sends. |
| `SMTP_MODE` | **Infrastructure capability — retained**, and now the ONLY thing that decides SMTP adapter selection (`deployment-mail-capability.ts`). Its effective state is surfaced read-only via `GET /settings/health`. |
| `IMAP_SYNC_ENABLED` | **Deprecated / parsed-only.** No longer read by `MailInboundIngestService.syncAll()`. `MailConfiguration.inboundSyncEnabled` (DB) is the sole operational authority. |
| `IMAP_MODE` | **Infrastructure capability — retained**, and now the ONLY thing that decides IMAP adapter selection (`deployment-mail-capability.ts`). Its effective state is surfaced read-only via `GET /settings/health`. |
| `AI_ENABLED` | **Fully replaced.** No longer read anywhere in the runtime AI pipeline; `AiSettings.enabled` is authoritative. |
| `AI_PROVIDER` | **Fully replaced.** `DynamicLlmGateway` has no `ConfigService` dependency and cannot read this var under any circumstance; `AiSettings.provider` is authoritative. There is no AI adapter-selection env var of any kind any more. |
| `AI_MODEL` | **Fully replaced** by `AiSettings.model`. |
| `AI_API_KEY` | **Fully replaced** by `AiSettings.apiKeyCiphertext` (encrypted, admin-managed). |
| `AI_CONFIDENCE_THRESHOLD` | **Fully replaced** by `AiSettings.confidenceThreshold`. |
| `AI_AUTO_ROUTE_ACCEPT` | **Fully replaced** by `AiSettings.autoRouteAccept`. |
| `AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT` | **Fully replaced** by `AiSettings.autoRouteAcceptCutoverAt`. |

No contradictory-state situation exists: the ten deprecated/fully-replaced env vars are simply never
read by any runtime pipeline any more (Zod validation in `environment.ts` still parses them for
backward compatibility with existing `.env` files, but nothing acts on the parsed values). The two
retained infra-level vars (`SMTP_MODE`/`IMAP_MODE`) are the ONLY infrastructure-capability concept
left, they never combine with any other env var to make that decision, and their effective state is
never hidden — it is read by the exact same helper the worker's real DI selection uses, and surfaced
read-only in Settings → Integration Health, so a DB-enabled mailbox's true readiness is always
visible to an ADMIN.

## Test/health behavior

Targeted coverage: `ai-settings-resolver.service.spec.ts` (safe defaults, fresh-per-call resolution,
decrypt-on-demand), `ai-settings.service.spec.ts` (secret handling, independent enablement
validation, connection-test isolation, shared resolver with runtime), `dynamic-llm-gateway.spec.ts`
(regression: DB AI enabled + OpenAI configured never silently uses mock because of `AI_PROVIDER`;
re-resolves settings on every call), `mail-settings.service.spec.ts` (secret handling,
blank-means-keep, auth-mode switching, connection-test isolation), `deployment-mail-capability.spec.ts`
/ `integration-health.service.spec.ts` (effective-status computation, regression: never READY when
the deployment adapter is mock, regardless of DB config; `MAIL_SEND_ENABLED`/`IMAP_SYNC_ENABLED` have
no effect), `settings-rbac.spec.ts` (both controllers), plus `mail-configuration-resolver.service.spec.ts`,
`mail-outbound.service.spec.ts`, `operator-reply-outbound.service.spec.ts`, and
`mail-inbound-ingest.service.spec.ts` extensions proving the DB switches are the sole operational
authority. All pre-existing AI/mail unit and RBAC suites continue to pass unmodified in behavior
(only their fake collaborators were updated to the new constructor shapes).

## Acceptance criteria

- [x] Mail and AI operational settings are fully manageable from the CRM UI (`/dashboard/settings`).
- [x] No raw JSON credential textarea anywhere in the new UI — named fields only.
- [x] Secrets are write-only, never returned, never logged, never audited in plaintext/ciphertext.
- [x] ADMIN full access; IT read-only; every other role denied — enforced server-side.
- [x] Every configuration mutation is audited with safe metadata.
- [x] Test IMAP/SMTP/AI cause zero production mutation (no cursor advance, no EmailMessage, no send,
      no AiClassification/AiRoutingDecision/RenewalCase change).
- [x] A successful Test AI resolves through the identical runtime provider/config semantics
      (`AiSettingsResolverService`) — never a separately duplicated check.
- [x] Routine Mail changes (enable/disable inbound/outbound, cutover, auth mode/credentials) take
      effect on the next worker cycle with no restart and with NO env var of any kind able to
      override or duplicate that DB state.
- [x] Routine AI changes take effect on the next call with no restart and with NO env var of any
      kind able to override or duplicate that DB state; there is no AI adapter-selection env var at
      all any more.
- [x] The one remaining infrastructure-capability concept (`SMTP_MODE`/`IMAP_MODE`) is surfaced
      read-only in Settings → Integration Health as an explicit Effective Status
      (Configured / Operationally enabled / Deployment adapter / Effective), computed via the same
      helper the worker's real adapter-selection DI uses — Settings can never display a readiness
      state the worker cannot actually deliver.
- [x] DB defaults are OFF everywhere; the migration cannot itself enable any live behavior.
- [x] Slice G safety rules (kill switch, cutover, historical-message protection, no AUTO REJECT)
      preserved exactly.
- [x] API/Web typecheck, lint, build, and full non-live Jest suite green.
- [ ] MariaDB live-suite re-run against this exact code: **deferred pre-production verification** —
      no disposable MariaDB credentials were available in the verification session; see the final
      implementation report.
