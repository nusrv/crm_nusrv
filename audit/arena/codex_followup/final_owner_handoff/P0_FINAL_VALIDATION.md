# P0 final validation and hardening

**Verdict B · P0 partially verified.** The locally available regression and worker startup checks passed. Disposable MariaDB rehearsal is blocked by runtime availability. The full Chrome restart failed at its independent persistent-cookie control. Production activation remains gated.

## Baseline and preservation

Started at `32013c24488b6ea68c7e886a779f0801727aae54` on `main` with 57 modified tracked paths, one prior tracked deletion, and 83 untracked paths. No index changes. Captured Git porcelain status and SHA-256 hashes of all readable dirty paths before editing. The prior P0.1 baseline comparison confirmed all 81 recorded paths still exist. Seven source paths changed between that baseline and the P0 implementation, as previously reported. The eighth overlap, `PROJECT_STATUS.md`, had no entry in that earlier hash snapshot. Its diff preserves the earlier phase statuses.

The overlap review traced the existing invoice/link and renewal metadata, disabled-session revocation and absolute cap, inactive AI settings, manual invoice preflight and draft behavior, manual reminder approval, browser single-flight refresh, and the original payment routes with ADMIN constraints. Earlier uncommitted versions of the seven changed files cannot be reconstructed from hashes. The 16 historical SQL files and migration lock match their recorded hashes. [P0.1 migration history and baseline](P0_1_MIGRATION_SAFETY.md)

## Disposable MariaDB rehearsal

No disposable hostname, TCP port, database identity, test-only credentials, or volume isolation could be verified. No database connection or write was attempted. The installed Docker CLI's default context is the local Windows named pipe. The Windows Docker service was stopped, and neither `docker_engine` nor `dockerDesktopLinuxEngine` existed. `docker --host npipe:////./pipe/docker_engine image ls --filter reference=mariadb` failed at the local pipe and produced no image inventory. WSL enumeration returned `Wsl/E_ACCESSDENIED`. No standalone MariaDB or MySQL executable, service, or dedicated database configuration was found. No services were installed, started, or pulled.

| Required operation | Outcome |
| --- | --- |
| Fresh database and all migrations | Skipped. No verified disposable runtime. |
| Pre-P0 synthetic fixture and upgrade | Skipped for the same prerequisite. |
| Live constraints, row/ID/money preservation, null defaults and repeat deploy | Skipped. Static P0 checks passed. |
| Disposable backup and restore | Skipped. No disposable instance to back up. |
| Prisma schema validation | Passed locally with a dummy loopback URL. This verifies the schema definition. |
| MariaDB version and target schema | Unverified. |

Expected migration order is the 16 checked-in predecessors, then `20261122000000_p01_nullable_renewal_and_communication_metadata`, `20261122001000_p01_optional_invoice_renewal_source`, `20261122002000_p02_outbound_replay_safety`, and `20261122003000_p05_notification_attempt_eligibility`. Exact repository drift remains in the intentionally deferred `payments` and `payment_receipts` tables and relaxed invoice customer/subscription nullability. The dirty renewal aggregate still selects nested payments. Review those API paths and the binary/schema contract before operational rollout. The P0 migration sequence grants no approval to add P1 payment tables.

## Browser restart investigation

The controller sets a host-only HttpOnly refresh cookie at `/api/v1/auth`, with Max-Age and Expires derived from the authorized session deadline, SameSite=Lax, and Secure in production. Logout clears the same name and path and revokes authority server-side. The access cookie is session-only at `/`. Server-side refresh is bounded by the stored expiry and 24-hour absolute lifetime. Changing the browser clock or retaining a stale cookie cannot establish a new session.

The earlier fixture served a placeholder dashboard and invoked login through a script. Its full-process branch also required an on-disk cookie row before graceful shutdown. The corrected browser fixture separates fresh-document and real Next UI modes, uses the actual CRM sign-in form and dashboard with loopback Nest and in-memory session state, and issues a nonsecret persistent control cookie for comparison. The full-process branch deletes only the access cookie, closes the dedicated browser through the browser-level DevTools endpoint, and opens the same profile. Cookie values and JWTs are excluded from diagnostics. No cookie flags or production credential storage semantics changed.

Independent evidence points to the managed Windows profile as a persistence constraint. A synthetic Windows DPAPI CurrentUser round trip failed because the user's profile data protection was unavailable. A prior isolated browser profile had a readable cookie database with zero rows and no OS encryption key state. No cookie encryption bypass is used for acceptance. A new document, new tab, or replacement browser context cannot prove a full-process restart. The full-process result is recorded separately below.

### Isolation and observed results

- Chrome launches with a unique temporary `--user-data-dir`. Its `Default` subprofile belongs to that directory. Debugger connections are pinned to the spawned browser's loopback host and port. The dedicated profile is held through shutdown and reopen. Shutdown uses the browser-level DevTools endpoint, waits for the process launched by the fixture, and checks that all process IDs reported for that browser have exited. Failure cleanup can terminate the child process owned by the fixture. It does not enumerate or terminate unrelated Chrome processes.
- Both Next and Nest bind to `127.0.0.1` on ephemeral ports. Child environments contain only an allowlist of local process and Windows profile variables plus fixture settings. Test identities and session storage are synthetic and in memory. Chrome routes external traffic away from reachable endpoints, while browser, API, and Next requests use loopback. Cleanup targets only the generated profile and dedicated Next build directory with path containment checks.
- `P0_TEST_CHROME` plus `P0_TEST_NEXT_UI=1` passed one actual CRM browser integration test. It submitted the rendered sign-in form, verified the dashboard, removed the access cookie and recovered on a fresh dashboard document. The same fixture covered 24-hour expiry, disabled/revoked sessions, permission changes, concurrent refresh, and the late-refresh/logout race. Production Secure, HttpOnly, host-only scoping, expiry and clearing were also checked through the controller contract.
- With `P0_TEST_PROCESS_RESTART=1` added, the fixture logged in through Next, shut down the dedicated profile processes, reopened the same directory, and navigated the real dashboard. The dashboard redirected to login. The independent persistent control cookie had been accepted as persistent by Chrome before closure but was absent from both post-close SQLite and the reopened browser. The test reported one failed process-restart case. This leaves full-process CRM recovery unverified in the managed environment.

## Worker startup hardening

Worker initialization previously used automatic BullMQ processor registration. The worker now uses a manual registrar. `register-p0-workers.ts` performs four read-only, zero-row projections for both outboxes, email review metadata, and proposed renewal dates. A failed query stops startup before consumer registration and yields a sanitized failure. The API retains its existing configuration. Tests exercise actual BullMQ manual registration without named queues and inject each projection failure.

This gate checks readable table and column presence. Migration checksums, indexes, FK definitions, column types and defaults, actual write permissions, and operational data compatibility remain separate release checks. The gate cannot stop old binaries.

## Regression and changes

| Check | Final result |
| --- | --- |
| Relevant API Jest suites | 848 passed in 77 suites. Includes six startup gate cases and the production cookie contract. |
| Node fixture and structural checks | 22 passed. |
| Invoice renderer | Seven cases passed via in-memory esbuild. |
| Actual Next and Nest browser fixture | Fresh document, one passed. Full-process restart, one failed at the independent profile control. |
| Workspace typecheck | Passed for API, web and shared. The earlier failures included stale browser fixture call arguments and `TS18048` on the optional DevTools process list. The corrected code asserts the list exists before mapping it. |
| Prisma, focused ESLint and Git whitespace | Passed. |

Changed worker files are `worker-main.ts`, `worker-app.module.ts`, and `queue-foundation.module.ts`, plus new `register-p0-workers.ts` and its spec. Identity additions are the corrected `auth-browser.integration.spec.ts` and the production `auth.controller.spec.ts`. The implementation report and project status record the results. No existing SQL migration was edited.

The final worktree comparison retained all 141 pre-existing dirty entries. Three were intentionally edited and 138 matched the baseline. Restored the declaration lines generated by Next and removed its two generated workspace instruction artifacts, which were absent from the baseline. Dedicated browser and Next output directories were cleaned by the fixtures. The index and HEAD remained unchanged.

## Deployment and rollback checklist

- Verify instance identity, connection isolation, credentials, empty mounts, and synthetic-only inputs before rehearsing on a disposable instance. Rehearse fresh install, seeded upgrade, valid and invalid FK references, older rows and exact amounts, repeat deployment bookkeeping, and backup/restore. Capture the server version and exact commands.
- Obtain separately authorized target schema and migration evidence. Compare history checksums, grants, storage engine, indexes, constraints, nullability and table sizes. Reconcile drift before applying the recorded order. Preserve snapshots and audit evidence.
- Pause both outbound queues and disable mailbox sending. Stop every old outbound consumer and prevent supervisors or replicas from restarting them. Allow for any in-flight SMTP calls before collecting legacy evidence. Expired leases alone are insufficient.
- Validate upgraded workers with the startup gate and isolated synthetic queues. Using a mock transport on a live queue can still consume and record mock delivery for operational messages. Verify versions and quarantine state before requesting approval to re-enable operational sending.
- Keep outbound queues paused and mailbox sending disabled during rollback. Preserve additive metadata and audit events. A rollback to an old worker requires an explicit compatible procedure and renewed review of every uncertain or in-flight message. The previous binary can ignore the quarantine flags.

Production-target schema evidence, operational migration approval, and deployment approval are outstanding.

| Release gate | Status |
| --- | --- |
| Disposable database rehearsal | Blocked. No verified isolated server. |
| Full browser restart | Failed independent profile persistence control in the managed Chrome run. |
| Production-target schema | Unverified. |
| Operational migration authorization | Outstanding. |
| Outbound worker cutover | Startup gate checked locally. Operational compatibility evidence and successful old-worker shutdown are outstanding. |
| Deployment authorization | Outstanding. |
