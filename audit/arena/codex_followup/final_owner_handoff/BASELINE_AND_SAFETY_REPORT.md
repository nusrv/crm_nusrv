# Baseline and safety report

## Repository and scope

Branch `main`, starting HEAD `32013c24488b6ea68c7e886a779f0801727aae54`. Git porcelain status with all untracked files was captured before work and after the six handoff files were created. Counts include untracked audit/source files present before this assignment.

| State | Modified tracked | Staged | Untracked |
| --- | ---: | ---: | ---: |
| Before | 15 | 0 | 60 |
| After | 15 | 0 | 66 |

The before/after status delta is the six files in this directory. All 75 pre-existing dirty/untracked file contents were checked by SHA-256. Prior audit reports, instructions, templates and application sources retain their starting content. Project phase and deployment records remain in [Project Status](../../../../PROJECT_STATUS.md). This handoff is documentation complete and P0 is the next independent package eligible for explicit implementation authorization.

### Pre-existing working changes

- Tracked configuration and frontend changes include `.env.example`, `apps/api/src/config/environment.ts` and `apps/web/lib/api.ts`.
- Tracked API changes include `apps/api/prisma/schema.prisma`, identity `auth.service.ts`, AI `ai-settings-resolver.service.ts`, invoice controller/module/service, `mail-outbound.service.ts`, renewal-cases controller/module/service, `renewal-engine.service.ts` and `renewal-transition-policy.ts`.
- Five application source files were already untracked. The invoice directory contains `payment-money.ts`, `payments.controller.ts` and `payments.service.ts`. The renewal-cases directory contains `manual-renewal.service.ts` and `renewal-period.ts`.
- The other 55 baseline untracked files were audit material and the frozen scope and company reference. Treat these as working inputs. No staging or cleanup was needed.

## What was verified

| Evidence | Verified in read-only inspection | Remaining verification |
| --- | --- | --- |
| Scope and review trail | Read the repository instructions, frozen scope, final master plan, owner reconciliation materials and five Codex follow-ups across the team. The reconciliation log records interrupted discussion. This handoff makes no Claude review or consensus claim. | Owner approval is recorded only for decisions supplied or previously approved. |
| Schema history | Dirty Prisma adds proposed renewal dates, renewal link/index, nullable invoice customer/subscription fields, shared review metadata, manual send marker and Payment/PaymentReceipt. Sixteen checked-in SQL migrations do not provision the payment tables or the added case link. An existing Phase 4 invoice hardening backfill derives provenance from accepted status, which by itself does not establish complete official evidence. | Inspect live migration history and deployed columns only with separate permission. Reports flag omitted Slice G, Phase 4 and branding groups in a live deployment path. Confirm actual drift and rollout path before runtime enablement. |
| Finance | Working-tree PaymentReceipt is one-to-one with Payment and has a JSON snapshot. The finance service reads original Payment totals with draft fallbacks, creates receipt separately, uses a reconciled-accepted gate for recording, and its controller permits ACCOUNTANT. No edit/void flow was found there. | Verify deployed records and existing official evidence, currency, legacy exceptions and source pairing. |
| Renewal and officialization | Current working-tree fulfillment checks proposed dates and uses a subscription date CAS, with no linked-official check in that path. Existing invoice service has manual acceptance from READY and QR validation. Preserve that evidence while designing one verified-official predicate. | Validate lifecycle, authoritative official fields and imported evidence on representative records. |
| Identity and AI | The browser helper has a bounded refresh retry and the auth controller issues a persistent refresh cookie. JWT strategy and roles guard use embedded role claims, and access payload has no session binding in that strategy. The resolver forces AI inactive. | Confirm browser bootstrap/cross-tab/logout behavior and every sensitive guard and AI execution entry point. |
| Mail | Both outbound services select stale PROCESSING rows. SMTP transport calls `sendMail` without returning its evidence to the caller. Inbound IMAP uses configuration cursor state and supports UIDVALIDITY detection. Manual reminder preview selects priority contacts, but current send accepts supplied email text without proving selected contact ownership. | Prove transport and provider capabilities, both retry paths and sync behavior with fault injection. Legacy uncertainty prevalence is unknown. |
| QR and templates | Manual QR validation recognizes PNG/JPEG/WebP with lightweight header/size checks. Issuer-type and snapshot fields exist. The invoice renderer has an issuer Tax/National line. `docs/templates/nusrv_invoice_latest_reference.pdf` exists in the worktree. | Rehearse bounded structural validation and compare company output visually to the reference. No approved individual reference was identified. |

## Migration and release safeguards

1. Inventory actual MariaDB version, schema, migration rows and deployment runner in an authorized environment. Compare with checked-in migration history and the dirty schema, including nullable foreign-key callers, indexes, enums and precision. Separate already-applied SQL, confirmed missing migrations, and new work. Never blindly replay or edit applied migrations.
2. Design additive schema first, with nullable fields and explicit compatibility where legacy evidence is incomplete. Stage constraints after duplicate/mismatch checks. Avoid destructive drops, cascade deletes and broad data rewrites. Preserve old snapshots, audit, original document bytes and payment facts. Plan for MariaDB DDL behavior, locks and interruption, including compatible binaries for each stage.
3. Back up and prove restore on a disposable copy. Run fresh and upgrade rehearsals, bounded repeatable backfills and read-only reconciliation before activating new writers. Verify row counts, amounts and associations by invoice, issuer and currency. Shadow effective balances before cutover. Keep ambiguous records visible for review and exclude them from guessed financial or workflow history.
4. Gate new finance/fulfillment paths until schema and integrity checks pass. Pause or drain unsafe old mail consumers before cutover, quarantine legacy uncertain work and preserve attempt/evidence rows. On rollback keep affected writes or sending disabled where the older application would violate these rules. Use retained history and guard compatibility as the rollback boundary.

## Delegation and verification limits

Confirmed by successful role-specific spawns and delivered child reports, `routine_low` extracted documentation, `design_medium` analyzed the roadmap, and `critical_high` handled the narrow payment/receipt integrity review. No more than two children were active at a time and no fallback was used. The role catalog assigns `gpt-6.2-sol` with low, medium and high reasoning respectively. The tools did not expose independent effective model or effort receipts or a coordinator effort setting.

No application, migration, configuration or data edits were made. No application tests, migration execution, database calls, delivery tests, dependency changes, deployments or external operations were performed. The historical invoice policy, financial exception disposition where needed, and Individual reference remain bounded as described in [Owner Approval Gates](OWNER_APPROVAL_GATES.md).
