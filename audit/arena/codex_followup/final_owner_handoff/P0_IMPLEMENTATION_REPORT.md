# P0 implementation report

**Final validation update** · P0 remains partially verified. New workers withhold BullMQ consumer registration until four P0 schema projections succeed. Actual Next sign-in and fresh-document recovery passed. A full Chrome restart of the same dedicated profile failed the independent persistent-cookie control. Disposable MariaDB rehearsal was skipped because no isolated runtime was available. Workspace typecheck passed after the browser fixture fixes. [Validation evidence and release gates](P0_FINAL_VALIDATION.md)

The starting HEAD on `main` was `32013c24488b6ea68c7e886a779f0801727aae54`. The working tree already contained 16 modified tracked files and 70 untracked files. This assignment used local fixtures, pinned dependencies from the offline npm cache, and the local Prisma engine. No operational database, live SMTP, AI provider, or deployment was used.

## P0.1 · Migration baseline

**Status** · Existing local work retained and statically verified. The two P0.1 migrations, their test and the historical migration files were preserved. All four original static checks passed again. Pinned Prisma client generation and schema validation used a dummy loopback URL and did not connect to a database. The deployed-schema inventory, historical data reconciliation, and disposable MariaDB fresh/upgrade/restore rehearsal remain pending. Finance DDL and relaxed invoice relationships remain outside these migrations. [P0.1 migration safety report](P0_1_MIGRATION_SAFETY.md)

## P0.2 · Outbound replay containment

**Status** · Implemented and verified with isolated worker/adapter tests. Both outboxes claim eligible QUEUED rows with a compare-and-set. The lease-guarded attempt counter and immutable audit start event commit together before SMTP. The event records attempt ID, Message-ID, recipient, mailbox and the persisted operator where applicable. The outcome event records structured acceptance, nonacceptance or uncertainty, with SMTP/mock provenance and a bounded queue ID where available. An outcome arriving after quarantine is retained as evidence and cannot change the row's quarantine state.

- Queue replay requires either zero prior attempts or positive evidence that the preceding attempt could be retried. Transport initialization failures and qualifying SMTP rejections can be distinguished from missing final replies, socket failure, timeout, and process failure. A Nodemailer `CONN` error can follow DATA and is treated as uncertain. The targeted concurrency review identified this case and regression tests exercise it.
- Stale or unowned legacy processing rows and legacy queued rows with unproven earlier attempts are quarantined. An explicit marker separates this from older FAILED statuses and retains any prior error text. Current uncertain rows are terminal for automatic processing. Quarantine records never grant a resend.
- Existing scheduling still disables automatic customer renewal reminder generation. Dispatch additionally requires the recorded human authorization and a current ADMIN. Manual renewal reminders validate the selected registered address and bypass automation Holds. Existing operator replies require an active ADMIN actor and maintain pinned mailbox, thread and recipient controls.
- Core files are `mail-outbound.service.ts`, `operator-reply-outbound.service.ts`, `smtp-attempt-policy.ts`, the SMTP classifier and transport adapters, their regression tests, `schema.prisma`, and `20261122002000_p02_outbound_replay_safety`. The existing append-only audit table stores attempt evidence. Persisted flags default closed and require no data backfill.

## P0.3 · Fresh authorization and sessions

**Status** · Implemented. Bound access credentials carry the session identifier and cap lifetime at 15 minutes. The JWT strategy reads current user roles, account state, session ownership, revocation and expiry. Protected writes require ADMIN as well as their route permissions. Payment reads and the dormant human submission service also require ADMIN. Public login, refresh and logout retain their existing origin policy and secure cookie attributes. Legacy access credentials require refresh or reauthentication. Roles and account data were preserved.

Refresh is bounded by the stored session and a 24-hour absolute cap. Browser startup can reach the API without an access cookie, shares concurrent refresh and rejects completion from a pre-logout request. Logout revokes on the server, and even a late browser cookie cannot restore authority. Individual actors remain attributable to their actions.

Touched files include identity controller/service, JWT strategy, roles guard, session policy and tests, payment controller role metadata, `web/lib/api.ts`, AppShell, the removed access-cookie-only proxy, and an opt-in Chrome fixture exercising actual Nest auth routes through the browser API helper and an in-memory session store. The fixture uses a temporary profile and loopback-only networking. This test does not boot the entire Next application. Browser mode and test results are recorded below.

The endpoint inventory covered renewal decisions, Holds, manual reminders, shared read marking, communication thread resolve/send/draft, invoicing and collection, user/role management, and integration and AI settings. Nest applies the fresh identity and ADMIN write gates centrally, including handlers without an explicit role decorator. Tests also check the current role on a protected browser-to-API write.

## P0.4 · Invoice tax, QR and inactive AI

**Status** · Implemented and isolated verification passed. The invoice renderer uses the saved issuer tax snapshot in Sales Tax No. and removes the duplicate label. Historical issuer snapshot inputs and official invoice financial amounts remain in use. The existing draft edit/return code now explicitly refuses a missing source subscription until the approved unattached draft flow is implemented. The existing mock-covered Fawtara submission path uses the current preflight signature, retains the issuer and recovery connection checks at reservation, and requires a human ADMIN.

Manual QR uploads validate canonical bounded data URLs, image signatures, container or marker structure and dimensions for PNG, JPEG and WebP. PNG decoding of scanline data is bounded. Animated WebP frames share an aggregate pixel budget. The code does not decode QR semantics and leaves existing stored image data intact. Legacy QR correction belongs to the later scope.

AI settings remain visible and labeled inactive. Existing enablement flags and credentials cannot activate AI. Server gates cover scheduler registration, enqueue and recovery, classification and routing, the provider registry/gateway, and diagnostic/model-discovery paths. Historical AI and human-review data remain available. Core changes are in the invoice renderer and its check, `manual-qr.ts` and fixtures, AI policy/settings/queues/worker/routing/provider files and tests, and the Advanced Settings panel.

## P0.5 · Due-time fairness

**Status** · Implemented after initial replay invariants passed. Both paths reuse the same due-time and replay predicate for scanning and claiming. Reminder/internal notification scheduling gained a separate nullable `nextAttemptAt` and index. Deferral and bounded retries use the new due time while retaining the original schedule. Holds consume zero SMTP attempts. Stale and ambiguous records do not occupy the send batch. Tests in both worker suites show that 50 earlier deferred rows do not block an eligible newer message.

The migration is `20261122003000_p05_notification_attempt_eligibility`. The transport, services, common policy and tests listed under P0.2 implement the runtime behavior.

## Final verification

| Check | Actual result |
| --- | --- |
| Relevant API Jest regression | 841 passed across 75 suites for identity, mail, communications, AI and invoices. |
| Dependency-free Node checks | 22 passed across the P0.1/P0.2/P0.5 migration and replay contracts, session policy and browser helper, and QR. |
| Invoice React renderer | Seven rendering cases passed via in-memory esbuild and Node, including legal fields and historical snapshots. |
| Loopback Chrome to Nest | One integration test passed in fresh-document mode. It verifies persistent HttpOnly cookie attributes, bootstrap with no access cookie, current role/disablement and a late refresh after logout. |
| Full browser-process restart | Attempted in Chrome and Edge. Both temporary profiles failed to write the refresh cookie to disk, including a bounded wait for Chromium's cookie store. This acceptance condition remains unverified. The fixture exposes `P0_TEST_PROCESS_RESTART=1` for a controlled follow-up run. |
| Static and tooling checks | Workspace TypeScript typechecks, Prisma client generation and validation, focused backend ESLint, and Git whitespace checks passed. No MariaDB execution or live provider/transport call took place. |

The initial broad API run exposed an outdated Fawtara preflight expectation and subsequent tests exposed the legacy ACCOUNTANT fixture. The recovery assertion now verifies the persisted connection at reservation, and ADMIN is the positive actor with an explicit legacy ACCOUNTANT denial test. The final broad run is green.

The P0.1 baseline migrations, all 16 historical SQL files and the migration lock were verified against their recorded hashes. All 86 pre-existing dirty paths remain present, with 78 byte-for-byte unchanged. The eight in-scope edits are the project status, Prisma schema, auth service, AI settings resolver, invoice draft compatibility handling, payment role declaration, outbound reminder worker and browser API helper. Final Git status shows 57 modified tracked paths, one deliberate tracked deletion of the access-cookie-only Next proxy, and 83 untracked paths. Nothing was staged or committed.

## Rollout gates

1. Obtain the target version, migration checksums, outbox/communication definitions and MariaDB lock and upgrade evidence independently. Run the complete migration chain on disposable test-only MariaDB and rehearse upgrade, backup/restore and old-row handling. Static checks do not prove SQL execution.
2. Before any future operational cutover, positively stop all old consumers of both outbound queues and prevent their supervisors or replicas from restarting. Disable real outbound mail during migration, snapshot and inspect queued and processing states, and verify every active worker version before enabling traffic. The old binaries do not honor the new database flags. A per-mailbox switch by itself cannot stop a delivery already in flight.
3. Rehearse the new workers against quarantined legacy and active synthetic rows, keeping outbound paused on any rollback to an old worker. Review pre-existing invoice schema and incomplete application paths before activating any affected runtime routes. No production deployment, automatic resend UI, or P1 implementation is included.
