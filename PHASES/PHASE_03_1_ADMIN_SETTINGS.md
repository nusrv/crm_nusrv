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

## Infrastructure vs. operational settings boundary

Two categories of configuration now exist, and this boundary is intentional and load-bearing:

**INFRASTRUCTURE (remains environment-based — a one-time deployment decision, never a routine
admin action):**

- `NODE_ENV`, `DATABASE_URL`, Redis connection, JWT secrets, `ENCRYPTION_KEY_BASE64`, ports/URLs,
  CAPTCHA infra secrets.
- `SMTP_MODE` / `IMAP_MODE` / `AI_PROVIDER` — these decide which ADAPTER CLASS is wired into the DI
  container at process boot (mock vs. real SmtpMailTransport/ImapMailboxReader/OpenAiLlmGateway),
  exactly mirroring the existing `FAWTARA_MODE`/`PLESK_MODE`/`SMARTERMAIL_MODE` precedent for every
  other external integration in this codebase (AGENTS.md §6: "use mock/sandbox adapters until
  explicit production credentials are configured"). This is a structural safety rail, not an
  operational toggle: it must survive even a Settings-UI bug or a misconfigured admin session, so a
  brand-new/staging/demo environment can never be flipped into attempting real Outlook/OpenAI
  network calls by anything short of a deliberate deployment change.
- `MAIL_SEND_ENABLED` / `IMAP_SYNC_ENABLED` — kept as a coarser, one-time, deployment-level gate
  layered ABOVE the new per-mailbox DB flags (see below), for the same reason. **This is the one
  documented exception to "operational DB state is authoritative" (AGENTS.md/Phase 3.1 §Q)**: these
  two env vars are the deployment's one-time declaration that "this environment is allowed to
  attempt real mail I/O at all." Set once during initial environment setup (`true`), all ROUTINE
  day-to-day changes (turn a specific mailbox's sync/send on or off, change its cutover, switch its
  auth mode, test its connections) happen exclusively through Settings, with zero further env/.env
  involvement. Left at their default (`false`), the DB-backed toggles below can never cause any
  mail I/O regardless of their own state — a genuine double-lock, not a redundant one.

**OPERATIONAL (now fully DB-backed, admin-managed, restart-free):**

- MAIL: per-mailbox authentication type/credentials, SMTP/IMAP host/port/secure, inbound
  sync enable/disable, outbound send enable/disable, outbound send cutover, connection tests,
  health.
- AI: enable/disable, model, API key, confidence threshold, automatic-ACCEPT enable/disable,
  automatic-ACCEPT cutover, connection test, health. `AI_ENABLED`/`AI_MODEL`/`AI_API_KEY`/
  `AI_CONFIDENCE_THRESHOLD`/`AI_AUTO_ROUTE_ACCEPT`/`AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT` env vars have
  **no equivalent infra-level gate** — AI's only infra-level concern (`AI_PROVIDER`, mock-vs-real
  gateway wiring) is already fully separate. These six legacy env vars are no longer read anywhere
  in the runtime AI pipeline; the DB row (`AiSettings`) is the sole and complete source of truth.

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
  existing `IntegrationHealthEvent` log — no competing health model introduced.

## Dynamic mail runtime (§D)

`MailConfigurationResolverService.resolveForOutbound()`/`resolvePinned()` now additionally require
`outboundSendEnabled === true` and (for ordinary reminder sends only) `outboundSendCutoverAt` to be
set and reached, resolved fresh on every call. `OperatorReplyOutboundService` requires
`outboundSendEnabled` but explicitly opts out of the cutover check (`{ checkCutover: false }`),
preserving its own pre-existing, already-tested contract that a cutover must never strand a
human-authored reply. `MailInboundIngestService.syncAll()` additionally filters candidate configs on
`inboundSyncEnabled: true`. Turning a mailbox's sync/send on or off, or changing its cutover, takes
effect on the very next scheduled cycle — no restart.

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
  AiClassification, no AiRoutingDecision, sends no email, mutates no RenewalCase, independent of
  `AI_PROVIDER`'s mock/real DI wiring (it always calls the real API to prove the stored credentials).

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

## Legacy env vars — complete list and status

| Env var | Status |
|---|---|
| `MAIL_SEND_ENABLED` | **Retained as an infrastructure-level emergency/deployment gate** (see boundary section above) — set once, never the routine control plane. |
| `MAIL_SEND_CUTOVER_AT` | Retained, same infra role as `MAIL_SEND_ENABLED`. |
| `SMTP_MODE` | Retained — infra-level mock/real adapter selection, unchanged, unrelated to this phase. |
| `IMAP_SYNC_ENABLED` | **Retained as an infrastructure-level emergency/deployment gate**, same role as `MAIL_SEND_ENABLED`. |
| `IMAP_MODE` | Retained — infra-level mock/real adapter selection, unchanged. |
| `AI_ENABLED` | **Fully replaced.** No longer read anywhere in the runtime AI pipeline; `AiSettings.enabled` is authoritative. |
| `AI_PROVIDER` | Retained — infra-level mock/real gateway selection (`llm-provider.module.ts`), unrelated to `AiSettings`. |
| `AI_MODEL` | **Fully replaced** by `AiSettings.model`. |
| `AI_API_KEY` | **Fully replaced** by `AiSettings.apiKeyCiphertext` (encrypted, admin-managed). |
| `AI_CONFIDENCE_THRESHOLD` | **Fully replaced** by `AiSettings.confidenceThreshold`. |
| `AI_AUTO_ROUTE_ACCEPT` | **Fully replaced** by `AiSettings.autoRouteAccept`. |
| `AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT` | **Fully replaced** by `AiSettings.autoRouteAcceptCutoverAt`. |

No contradictory-state situation exists: the six fully-replaced AI env vars are simply never read by
the runtime pipeline any more (Zod validation in `environment.ts` still parses them for backward
compatibility with existing `.env` files, but nothing acts on the parsed values), and the four
retained infra-level vars operate one layer above the DB state they gate, never in conflict with it
(they can only ever narrow, never expand, what the DB allows).

## Test/health behavior

Targeted new coverage: `ai-settings-resolver.service.spec.ts` (safe defaults, fresh-per-call
resolution, decrypt-on-demand), `ai-settings.service.spec.ts` (secret handling, independent
enablement validation, connection-test isolation), `mail-settings.service.spec.ts` (secret handling,
blank-means-keep, auth-mode switching, connection-test isolation), `settings-rbac.spec.ts` (both
controllers), plus a `mail-configuration-resolver.service.spec.ts` extension for the new
outbound-enablement/cutover gate and a `mail-inbound-ingest.service.spec.ts` extension for the new
`inboundSyncEnabled` filter. All pre-existing AI/mail unit and RBAC suites continue to pass
unmodified in behavior (only their fake collaborators were updated to the new constructor shapes).

## Acceptance criteria

- [x] Mail and AI operational settings are fully manageable from the CRM UI (`/dashboard/settings`).
- [x] No raw JSON credential textarea anywhere in the new UI — named fields only.
- [x] Secrets are write-only, never returned, never logged, never audited in plaintext/ciphertext.
- [x] ADMIN full access; IT read-only; every other role denied — enforced server-side.
- [x] Every configuration mutation is audited with safe metadata.
- [x] Test IMAP/SMTP/AI cause zero production mutation (no cursor advance, no EmailMessage, no send,
      no AiClassification/AiRoutingDecision/RenewalCase change).
- [x] Routine Mail/AI changes take effect on the next worker/action cycle with no restart, once the
      one-time infra-level gates are set.
- [x] DB defaults are OFF everywhere; the migration cannot itself enable any live behavior.
- [x] Slice G safety rules (kill switch, cutover, historical-message protection, no AUTO REJECT)
      preserved exactly.
- [x] API/Web typecheck, lint, build, and full non-live Jest suite green.
- [ ] MariaDB live-suite re-run against this exact code: **deferred pre-production verification** —
      no disposable MariaDB credentials were available in the verification session; see the final
      implementation report.
