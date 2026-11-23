# Project Arena baseline

## Executive summary

The audit covers the NUSRV subscription lifecycle control panel at committed revision `32013c24488b6ea68c7e886a779f0801727aae54` and the interrupted operational-workflow changes present at audit entry. The two states have different behavior and release readiness. The committed revision contains the Phase 4 invoicing and branding foundation. The working tree changes customer communication, authentication, and the financial schema but lacks an accompanying migration and complete UI paths. **A-01** records that release gap.

## Evidence boundary

| Item | Observation |
| --- | --- |
| Workspace | `G:\Projects\Customer_Renewal_CP_Codex_Pack_NODEJS`, Windows PowerShell |
| Inspection date | 2026-11-18, Asia/Amman workspace time |
| Branch and revision | `main` at `32013c24488b6ea68c7e886a779f0801727aae54` |
| Tracking reference | Local `origin/main` resolved to the same SHA. No fetch or deployment inspection occurred. The owner identified this SHA as the production baseline. The deployed processes and configuration were not independently checked. |
| Recent history | `32013c2` issuer branding, `3021264` JoFotara and invoice hardening, `fe2f217` references, `c148794` invoice foundation, `ae374db` AI provider handling |
| Original working tree | 15 modified tracked paths and seven untracked paths at the first complete inventory. No staged changes were shown. |
| Local tools | Node 26.13.0 and npm 11.1.0. `.nvmrc` pins 22.23.2 and `package.json` declares Node >=22.12.0. No root `node_modules` or generated Prisma client in the audited checkout. |
| Database and test inventory | 16 tracked SQL migration files and 142 tracked `*.spec.ts` files. The latter counts files, not test cases or suites executed. |

The original edits covered the sample environment and runtime config, auth service and browser API client, AI resolver, Prisma schema, invoice API, SMTP worker, and renewal API and engine. Untracked files were the payment arithmetic, controller and service, the manual renewal service and period helper, the current-scope document, and the latest NUSRV PDF. The scope document and PDF were already present when this audit began. See [findings](CODEX_INITIAL_REPORT.md) for the boundaries of each identified issue.

## Coverage and exclusions

| Domain | Evidence inspected | Limit |
| --- | --- | --- |
| Product and requirements | Owner's frozen workflow, `AGENTS.md`, current-scope headings and rules, `PROJECT_STATUS.md`, earlier phase and verification references | Older phase descriptions are historical context where they conflict with the frozen scope. No new statutory, accounting or access-control policy was inferred. |
| Architecture and dependencies | Workspace manifests, selected exact lockfile versions, API and worker modules, route inventory, compose and staging runbook | No registry advisory query, SBOM export, dependency installation or vendor traversal. |
| Data | Prisma relations and schema deltas, migration inventory, Phase 4 integration and branding DDL constraints, money and audit paths | No database connection, migration execution, seed, query-plan capture or production data inspection. |
| Security | JWT and role/origin guards, refresh and logout, envelope encryption, audit sanitizer, integration permission checks, mail identity and configuration | No credentials or ignored environment files opened. No browser or hosting security configuration verified. No offensive testing. |
| Workflow and UX | Reminder enqueue/claim, inbound correlation, AI settings gates, invoice and payment paths, renewal view, settings/navigation and modal samples | Representative code review, with most time on side effects and finance. No new browser, print, accessibility or visual acceptance certification. |
| Operability and tests | Health probes, worker configuration, outbox recovery and retry behavior, Jest setup, script and test inventory, staging deployment and rollback instructions | No CI run history or worker heartbeat evidence. No repo-local CI workflow found in the tracked path search. External CI may exist. |

Excluded generated outputs, dependency folders, Git objects outside targeted Git commands, workbook content, binary template extraction, production accounts and infrastructure. A previous invoice implementation session inspected the supplied visual references, including the latest untracked PDF. For this audit the renderer field binding is direct source evidence, independent of image comparison. No visual pass is claimed.

## Verification performed

- Captured Git status, history, committed and tracking SHAs, diff statistics, and file fingerprints for pre-existing changes. Ran `git diff --check`, which found no whitespace errors in the pre-existing tracked diff. That is a formatting check only.
- Rechecked the 22 pre-existing changed and untracked paths after writing the reports. All 22 content fingerprints matched. Git still reported the same branch and SHAs, with six additional untracked Markdown files under `audit/`.
- Compared relevant `HEAD` files with working-tree counterparts. Read package manifests and lockfile JSON locally. Lockfile v3 contained 1,177 package entries including workspace links. Selected resolutions include Nest core 11.2.1, Next 16.3.2, React 19.2.8, Prisma 7.9.1, BullMQ 5.81.3, MariaDB driver 3.4.5, and Nodemailer 10.0.10.
- Ran the actual manual QR validator using Node with an in-memory synthetic PNG header. The validator returned true despite absence of image data. See **A-02** for the exact check.
- Inspected the existing reports at `docs/phase4-verification.md` and `docs/multi-issuer-branding-verification.md`. The latter records 1,201 passed and 120 skipped in its historical run, successful builds and two opt-in Phase 4 MariaDB suites. It also records an advisory baseline of 80. These are time-bound historical results, not audit outcomes or proof of the current advisory count.

## Verification skipped

The full Jest suite, Prisma generate and validate, typecheck, lint, app boot, builds, mail, AI, invoice provider calls, and database integration tests did not run. This checkout lacked prerequisites. A previously used verification directory exists outside the repository but was not used because its installed and generated inputs were not bound to this working tree and the audit allows writes only under `audit/`. Fresh and populated migration rehearsals, browser and PDF acceptance, load benchmarks, current advisory triage, deployment/proxy review, and production health checks remain follow-ups. No service was started or contacted.

[Current assessment](CODEX_INITIAL_REPORT.md) · [Implementation plan](CODEX_IMPLEMENTATION_PLAN.md) · [Independent review questions](CODEX_CHALLENGE_READINESS.md)
